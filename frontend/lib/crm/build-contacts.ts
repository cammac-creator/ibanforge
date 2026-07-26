import { enrichEmail } from '@/lib/company-enrichment';
import { threadIsUnread } from '@/lib/thread-unread';
import type { Contact, Message, ProspectSourcing, ReadyMail } from './types';

/** Mailbox used for a contact we have never emailed. */
const COLD_ACCOUNT = 'claude-alain@ibanforge.com';
/** Mailbox that carries the existing warm threads. */
const WARM_ACCOUNT = 'cammac@bluewin.ch';

/**
 * Internal, test and founder-owned addresses never appear in the CRM. Lifted
 * verbatim from the Clients page so that exactly the same people show up.
 * Note it also swallows example.com, which is why fixtures use example.net.
 */
export const INTERNAL_RE =
  /(@ibanforge\.com|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|cam@ogens\.ch|ptibootch@|gpt-store@)/i;

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

export interface BuildInput {
  keys: KeyRow[];
  prospects: ProspectRow[];
  messages: MessageRow[];
  activityByKey: Record<string, ActivityRow>;
  /** Last read instant per lowercased counterpart address. */
  reads: Record<string, string>;
  months: string[];
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

const EMPTY_THREAD: Thread = { messages: [], draft: null, rowCount: 0 };

/**
 * Turn the four admin payloads into one contact list. Pure so it can be tested
 * without the network; the fetching lives in fetchCrmData below.
 */
export function buildContacts(input: BuildInput): Contact[] {
  const threads = new Map<string, MessageRow[]>();
  for (const m of input.messages) {
    const key = m.customer_email.toLowerCase();
    const arr = threads.get(key);
    if (arr) arr.push(m);
    else threads.set(key, [m]);
  }

  const threadOf = (email: string): Thread => {
    const rows = threads.get(email);
    if (!rows) return EMPTY_THREAD;
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
    // Last row wins when two prospects share an address, which the schema allows.
    if (p.contact_email) prospectByEmail.set(p.contact_email.toLowerCase(), p);
  }

  const out: Contact[] = [];
  const claimed = new Set<string>();

  for (const row of input.keys) {
    if (INTERNAL_RE.test(row.email)) continue;
    const id = row.email.toLowerCase();
    const { messages, draft, rowCount } = threadOf(id);
    const isPaid = row.credits_total != null;
    // Same rule as the previous Clients page: hide keys that never did anything.
    // It reads the raw row count, not the datable messages, so a thread we can
    // display only partially still keeps its owner on the list.
    const meaningful = isPaid || row.used_all_time > 0 || rowCount > 0;
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
      },
      usage: {
        series: row.series ?? [],
        months: input.months,
        days: input.activityByKey[row.key_prefix]?.days ?? [],
        endpoints: input.activityByKey[row.key_prefix]?.endpoints ?? [],
      },
      ...(matching ? { sourcing: sourcingOf(matching) } : {}),
    });
  }

  for (const p of input.prospects) {
    if (p.status === 'rejete') continue;
    const id = p.contact_email ? p.contact_email.toLowerCase() : '';
    if (id && claimed.has(id)) continue; // already emitted as a client
    const { messages, draft } = id ? threadOf(id) : EMPTY_THREAD;

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
    });
  }

  return out;
}

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** Fetch the four admin payloads. Returns null when the API is unreachable. */
export async function fetchCrmData(): Promise<BuildInput | null> {
  if (!ADMIN_SECRET) return null;
  const h = { headers: { 'X-Admin-Secret': ADMIN_SECRET }, cache: 'no-store' as const };
  const [k, p, m, a, tr] = await Promise.all([
    fetch(`${API_URL}/v1/admin/keys`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/prospects`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/email-messages`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/client-activity`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/thread-reads`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!k && !p) return null;
  return {
    keys: (k?.keys ?? []) as KeyRow[],
    prospects: (p?.prospects ?? []) as ProspectRow[],
    messages: (m?.messages ?? []) as MessageRow[],
    activityByKey: (a?.by_key ?? {}) as Record<string, ActivityRow>,
    reads: (tr?.reads ?? {}) as Record<string, string>,
    months: (k?.months ?? []) as string[],
  };
}
