import { enrichEmail } from '@/lib/company-enrichment';
import { threadIsUnread } from '@/lib/thread-unread';
import { signedUpRecently } from './new-signup';
import type { BusinessInfo, Contact, Message, Outcome, ProspectSourcing, ReadyMail } from './types';
// One definition of our mailboxes: the send path validates against this list,
// so a second copy here could drift and make a contact unsendable.
import { COLD_ACCOUNT, WARM_ACCOUNT } from './sending-account';

/** The outcome values the UI knows how to draw. Anything else reads as none. */
const OUTCOMES: readonly string[] = ['en_discussion', 'pas_maintenant', 'pas_interesse', 'mauvaise_personne'];



/**
 * Internal, test and founder-owned addresses never appear in the CRM. Lifted
 * verbatim from the Clients page so that exactly the same people show up.
 * Note it also swallows example.com, which is why fixtures use example.net.
 *
 * Two additions on 29/07/2026, both found by the "Nouveaux clients" chip: probe
 * keys minted and revoked during a session live on @ibanforge.internal, and the
 * founder's own throwaway tests are plus-addressed on his personal Gmail. Both
 * were sitting in the new-customer list beside genuine signups, which is
 * exactly where a false positive costs the most. The plus term is deliberately
 * narrow: his bare address is not a test account.
 */
export const INTERNAL_RE =
  /(@ibanforge\.com|@ibanforge\.internal|@ibf-internal\.dev|-probe@|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|cam@ogens\.ch|ptibootch@|gpt-store@|claudealainmartin06\+)/i;

/**
 * The outreach keys minted at launch, one per company we meant to approach.
 * None was ever called.
 *
 * They are not the same thing as `isPilot()` below, which reads a quota and
 * asks "is this key an evaluation?". These are recognised by their address
 * because that is the only thing that distinguishes them: a key we created
 * *for* someone, that they never received or never used, from one someone
 * created for themselves. No quota can tell those apart.
 *
 * The dashboard listed a dozen of them as "silent pilots to chase" for 111
 * days, which reads as a backlog of opportunities going cold. They are neither
 * opportunities nor going cold, and the number sat in a KPI card the owner
 * reads daily.
 *
 * The hyphen is load-bearing: it keeps `copilot@` and a `pilot-` domain out,
 * and it leaves any real signup from one of those companies alone, since a
 * genuine account is never created on this address shape.
 */
export const SEEDED_PILOT_RE = /-pilot@/i;

/**
 * Monthly quota from which an unpaid key is an evaluation pilot rather than a
 * customer. Same threshold as the Clients page, which hid pilots entirely.
 */
const PILOT_LIMIT = 5000;

export interface KeyRow {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  active: number;
  created_at: string;
  used: number;
  used_prev: number;
  used_all_time: number;
  last_active_month: string | null;
  credits_total: number | null;
  credits_remaining: number | null;
  paid: number;
  series: number[];
}

export interface ProspectRow {
  id: string;
  company: string;
  segment: string | null;
  website: string | null;
  country: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  buying_signal: string | null;
  signal_source_url: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  email_source_url: string | null;
  personalization_hook: string | null;
  confidence: string | null;
  status: string;
  /**
   * Optional on the wire, required in ProspectSourcing. The frontend and the
   * API deploy independently (Vercel and Railway), so between the two pushes
   * this page runs against an API that does not return these columns yet. An
   * optional field degrades to "no outcome recorded"; a required one would
   * make the whole CRM fail to type against its own live backend.
   */
  outcome?: string | null;
  outcome_note?: string | null;
  wake_up_at?: string | null;
  outcome_at?: string | null;
  created_at?: string | null;
  mail_subject_en: string | null;
  mail_body_en: string | null;
  mail_subject_fr: string | null;
  mail_body_fr: string | null;
  recommended_lang: string | null;
  source: string | null;
}

export interface MessageRow extends Message {
  customer_email: string;
}

export interface ActivityRow {
  endpoints: Array<{ path: string; count: number }>;
  days: Array<{ day: string; count: number }>;
}

/** One row of /v1/admin/activation's clients block, as the CRM consumes it. */
export interface ActivationClientRow {
  email: string;
  status: BusinessInfo['status'];
  source: string;
  credits_total: number;
  credits_remaining: number;
  packs: number;
  first_call_at: string | null;
  calls_90d: number;
}

export interface BuildInput {
  keys: KeyRow[];
  prospects: ProspectRow[];
  messages: MessageRow[];
  activityByKey: Record<string, ActivityRow>;
  /** Last read instant per lowercased counterpart address. */
  reads: Record<string, string>;
  months: string[];
  /**
   * Optional: the page renders without it (badges and business filters simply
   * absent), which is also the deploy-order story — the frontend may ship
   * before the API serves the endpoint, and a fetch failure must not take the
   * whole CRM down with it.
   */
  activation?: ActivationClientRow[];
}

/**
 * Same parse as situation.ts. msg_date is free-form TEXT filled by the ingester,
 * so the format is not guaranteed and a raw string comparison is not an order.
 */
function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A row we could place in time, paired with the instant it was placed at. */
interface DatedRow {
  message: MessageRow;
  at: Date;
}

/** Order rows on the instant, dropping the ones that cannot be placed at all. */
function datedAscending(rows: MessageRow[]): MessageRow[] {
  return rows
    .map((message) => ({ message, at: parseDate(message.msg_date) }))
    .filter((r): r is DatedRow => r.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((r) => r.message);
}

/**
 * A large free quota is an evaluation, not a customer. Paid keys are never
 * pilots.
 *
 * A SECOND, different definition of "pilot" lives on the overview:
 * app/[locale]/dashboard/(protected)/page.tsx counts `monthly_limit > 200`,
 * with no credits term. Keys between the two thresholds are pilots there and
 * clients here, and a key at PILOT_LIMIT is a pilot there and absent from the
 * CRM cards this rule feeds. Both rules pre-date the page that shows them
 * together; the divergence is known, not a bug, and moving either threshold
 * moves figures the owner reads daily.
 */
function isPilot(row: KeyRow): boolean {
  return row.credits_total == null && (row.monthly_limit ?? 0) >= PILOT_LIMIT;
}

/**
 * Order two keys of one address by how well each represents it: a paid key
 * beats an unpaid one, then the most used, then the smaller prefix. The last
 * level is what makes the answer independent of the order the API returned the
 * rows in; compared by code unit rather than localeCompare, which would make
 * the choice depend on the runtime locale.
 */
function compareKeys(a: KeyRow, b: KeyRow): number {
  const paid = Number(b.credits_total != null) - Number(a.credits_total != null);
  if (paid !== 0) return paid;
  if (a.used_all_time !== b.used_all_time) return b.used_all_time - a.used_all_time;
  return a.key_prefix < b.key_prefix ? -1 : a.key_prefix > b.key_prefix ? 1 : 0;
}

/** The key that stands for an address when several share it. */
function representativeKey(rows: KeyRow[]): KeyRow {
  return rows.reduce((best, row) => (compareKeys(row, best) < 0 ? row : best));
}

function sourcingOf(r: ProspectRow): ProspectSourcing {
  return {
    prospectId: r.id,
    segment: r.segment,
    whatTheyDo: r.what_they_do,
    fitReason: r.fit_reason,
    buyingSignal: r.buying_signal,
    signalSourceUrl: r.signal_source_url,
    contactName: r.contact_name,
    contactRole: r.contact_role,
    emailSourceUrl: r.email_source_url,
    personalizationHook: r.personalization_hook,
    confidence: r.confidence,
    status: r.status,
    source: r.source,
    createdAt: r.created_at ?? null,
    // Validated on the way in rather than trusted: the column is free TEXT and
    // an unknown value reaching the UI would render a blank badge.
    outcome: OUTCOMES.includes(r.outcome as Outcome) ? (r.outcome as Outcome) : null,
    outcomeNote: r.outcome_note ?? null,
    wakeUpAt: r.wake_up_at ?? null,
    outcomeAt: r.outcome_at ?? null,
  };
}

function readyMailOf(r: ProspectRow): ReadyMail | null {
  if (!r.mail_body_en && !r.mail_body_fr) return null;
  return {
    subjectEn: r.mail_subject_en,
    bodyEn: r.mail_body_en,
    subjectFr: r.mail_subject_fr,
    bodyFr: r.mail_body_fr,
    recommendedLang: r.recommended_lang === 'fr' ? 'fr' : 'en',
  };
}

/** What one address holds: its correspondence, its pending draft, its raw size. */
interface Thread {
  messages: Message[];
  draft: Message | null;
  /** Every row on the address, drafts and undatable ones included. */
  rowCount: number;
}

/**
 * A fresh empty thread per call, never one shared instance: `contact.messages`
 * is a plain array a renderer may sort in place, and one shared instance would
 * let that corrupt every message-less contact at once. Freezing it instead would
 * turn the same mistake into a crash on some contacts and not others, depending
 * on the data, so a new array is both safer and uniform.
 */
function emptyThread(): Thread {
  return { messages: [], draft: null, rowCount: 0 };
}

/**
 * Turn the admin payloads into one contact list. Pure so it can be tested
 * without the network; the fetching lives in fetchCrmData below.
 */
export function buildContacts(input: BuildInput, now: Date = new Date()): Contact[] {
  const threads = new Map<string, MessageRow[]>();
  for (const m of input.messages) {
    const key = m.customer_email.toLowerCase();
    const arr = threads.get(key);
    if (arr) arr.push(m);
    else threads.set(key, [m]);
  }

  const threadOf = (email: string): Thread => {
    const rows = threads.get(email);
    if (!rows) return emptyThread();
    // Drafts are not correspondence: they decide neither who holds the ball nor
    // how long the silence has run, and they render as their own review card.
    const drafts = rows.filter((m) => m.direction === 'draft');
    const dated = datedAscending(drafts);
    return {
      messages: datedAscending(rows.filter((m) => m.direction !== 'draft')),
      // The freshest draft we can date. When none is datable we still surface
      // one: losing text the user wrote is worse than showing it out of order.
      draft: dated.at(-1) ?? drafts.at(-1) ?? null,
      rowCount: rows.length,
    };
  };

  const prospectByEmail = new Map<string, ProspectRow>();
  for (const p of input.prospects) {
    // Rejected here too, not only in the emit loop: a client must never wear the
    // identity of a row the operator killed, and skipping it on one side only
    // would make the company change at the moment the address converts.
    if (p.status === 'rejete') continue;
    // The schema allows two prospect rows on one address. The FIRST represents
    // it, here and in the emit loop below, for the same reason.
    const key = p.contact_email?.toLowerCase();
    if (key && !prospectByEmail.has(key)) prospectByEmail.set(key, p);
  }

  // One contact per address, not one per key: an address can hold several keys,
  // and the id below is the join key, the selection key and the React key.
  const keysByAddress = new Map<string, KeyRow[]>();
  for (const row of input.keys) {
    if (INTERNAL_RE.test(row.email)) continue;
    const id = row.email.toLowerCase();
    const group = keysByAddress.get(id);
    if (group) group.push(row);
    else keysByAddress.set(id, [row]);
  }

  const businessByEmail = new Map<string, BusinessInfo>();
  for (const a of input.activation ?? []) {
    businessByEmail.set(a.email.toLowerCase(), {
      status: a.status,
      source: a.source,
      creditsTotal: a.credits_total,
      creditsRemaining: a.credits_remaining,
      packs: a.packs,
      firstCallAt: a.first_call_at,
      calls90d: a.calls_90d,
    });
  }

  const out: Contact[] = [];
  const claimed = new Set<string>();

  for (const [id, group] of keysByAddress) {
    const { messages, draft, rowCount } = threadOf(id);
    // Pilots leave the candidate set BEFORE the ranking, never after: a pilot
    // that won an address and was then dropped would take an ordinary key on the
    // same address down with it, hiding someone the Clients page shows today.
    const ordinary = group.filter((row) => !isPilot(row));
    // Every key an evaluation: the address is a pilot and emits nothing. It is
    // left unclaimed, so a pilot that is also a prospect still shows up on the
    // prospect side, exactly as the two old pages did between them.
    //
    // Unless we are already writing to them. That hand-off assumes a prospect
    // row exists, and an unprompted signup has none: a real customer signed up
    // unprompted, spent its whole quota in short order and got a reply from
    // us, yet fell between the two sides and stayed invisible for days. Worse,
    // raising their quota after they hit the wall is what turned them into a
    // pilot and erased them. An open thread is the line, and it is also what
    // separates this case from the outreach pilots we minted ourselves,
    // which carry a couple of smoke-test calls and no correspondence at all.
    const candidates = ordinary.length > 0 ? ordinary : rowCount > 0 ? group : [];
    if (candidates.length === 0) continue;
    const row = representativeKey(candidates);
    const isPaid = row.credits_total != null;
    // Same rule as the previous Clients page: hide keys that never did anything.
    // It reads the raw row count, not the datable messages, so a thread we can
    // display only partially still keeps its owner on the list.
    //
    // The last term is the one that was missing. A signup that happened this
    // morning has no calls and no thread BY DEFINITION, so this rule hid the
    // single most valuable row in the CRM. A sizeable share of the customer
    // base was invisible on 29/07/2026. The window is what keeps that from
    // swinging the other way and burying them under every dead key back to May.
    const isNew = signedUpRecently(row.created_at, now);
    const meaningful = isPaid || row.used_all_time > 0 || rowCount > 0 || isNew;
    if (!meaningful) continue;

    claimed.add(id);
    const enriched = enrichEmail(row.email);
    const matching = prospectByEmail.get(id);

    out.push({
      kind: 'client',
      id,
      email: row.email,
      company: matching?.company ?? enriched.company,
      country: matching?.country ?? enriched.country,
      website: matching?.website ?? enriched.website,
      messages,
      draft,
      unread: threadIsUnread(messages, input.reads[id]),
      account: messages.length > 0 ? WARM_ACCOUNT : COLD_ACCOUNT,
      apiKey: {
        keyPrefix: row.key_prefix,
        paid: isPaid,
        creditsTotal: row.credits_total,
        creditsRemaining: row.credits_remaining,
        monthlyLimit: row.monthly_limit,
        usedAllTime: row.used_all_time,
        lastActiveMonth: row.last_active_month,
        createdAt: row.created_at ?? null,
        isNew,
      },
      usage: {
        series: row.series ?? [],
        months: input.months,
        days: input.activityByKey[row.key_prefix]?.days ?? [],
        endpoints: input.activityByKey[row.key_prefix]?.endpoints ?? [],
      },
      ...(matching ? { sourcing: sourcingOf(matching) } : {}),
      ...(businessByEmail.has(id) ? { business: businessByEmail.get(id) } : {}),
    });
  }

  const emitted = new Set<string>();

  for (const p of input.prospects) {
    if (p.status === 'rejete') continue;
    const id = p.contact_email ? p.contact_email.toLowerCase() : '';
    if (id && claimed.has(id)) continue; // already emitted as a client
    // Two prospect rows may share an address; the first one represents it. The
    // guard skips empty ids, or every address-less prospect but one would go.
    if (id && emitted.has(id)) continue;
    if (id) emitted.add(id);
    const { messages, draft } = id ? threadOf(id) : emptyThread();

    out.push({
      kind: 'prospect',
      // A prospect with no address has no join key, so it falls back to its row
      // id: two of them must not collapse into one contact.
      id: id || `prospect:${p.id}`,
      email: p.contact_email ?? '',
      company: p.company,
      country: p.country,
      website: p.website,
      messages,
      draft,
      unread: id ? threadIsUnread(messages, input.reads[id]) : false,
      account: COLD_ACCOUNT,
      sourcing: sourcingOf(p),
      readyMail: readyMailOf(p),
      ...(id && businessByEmail.has(id) ? { business: businessByEmail.get(id) } : {}),
    });
  }

  return out;
}

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** Fetch the five admin payloads. Returns null when the API is unreachable. */
export async function fetchCrmData(): Promise<BuildInput | null> {
  if (!ADMIN_SECRET) return null;
  const h = { headers: { 'X-Admin-Secret': ADMIN_SECRET }, cache: 'no-store' as const };
  const [k, p, m, a, tr, act] = await Promise.all([
    fetch(`${API_URL}/v1/admin/keys`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/prospects`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/email-messages`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/client-activity`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/thread-reads`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/activation?days=90`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!k && !p) return null;
  return {
    keys: (k?.keys ?? []) as KeyRow[],
    prospects: (p?.prospects ?? []) as ProspectRow[],
    messages: (m?.messages ?? []) as MessageRow[],
    activityByKey: (a?.by_key ?? {}) as Record<string, ActivityRow>,
    reads: (tr?.reads ?? {}) as Record<string, string>,
    months: (k?.months ?? []) as string[],
    ...(act?.clients ? { activation: act.clients as ActivationClientRow[] } : {}),
  };
}
