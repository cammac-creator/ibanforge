/**
 * The measure of a one-off written offer to existing key holders: what left,
 * what came back, what was bought, who called again.
 *
 * WHY THIS EXISTS
 *
 * A single message sent once to people who already hold a key is judged a
 * month later on four figures: messages sent, replies (and among them the
 * requests to stop writing), subscriptions taken in the window, and recipients
 * who called the API again within thirty days of their message. Each already
 * lives in this database, spread over four tables; no existing route adds them
 * up for a window, so this module reads them in one pass.
 *
 * WHAT IT NEVER RETURNS
 *
 * An address. Counts, and at most key prefixes. The repository is public and
 * the output of an admin route is pasted into reports.
 *
 * HOW A SENT MESSAGE IS RECOGNISED
 *
 * By its subject. The outbound row written when a scheduled draft leaves does
 * not keep the draft's id, so the exact subject (one per language, the same for
 * every recipient) is the one stable mark. The subjects are a query parameter:
 * the campaign text stays out of this repository. Compared whole, case folded
 * and whitespace collapsed, never as a prefix: a later "Re: ..." from our side
 * is an answer, not a second send.
 *
 * THE SUBSCRIPTION WINDOW
 *
 * From the first message that left (or `since` when none has) to the reading.
 * A subscription counts whether it minted a new key or was attached to a key
 * the customer already held (`attached`): the offer is precisely to take Pro
 * on the existing key, and a count of new keys would read zero even if every
 * recipient said yes. Subscriptions taken before the window are out by their
 * date. Renewals are not new subscriptions: they live in
 * `subscription_payments`, never in the purchase register read here.
 *
 * BOUNCES
 *
 * Not measured here. The mail sync keeps delivery-status notices
 * (mailer-daemon, postmaster) out of the CRM on purpose, so the undelivered
 * count is read on the mail server. `not_measured` says so rather than
 * answering zero.
 */
import { getStatsDB } from './db.js';
import { loadAliasMap, toCanonical } from './email-aliases.js';
import { isInternalEmail } from './internal-accounts.js';

type Db = ReturnType<typeof getStatsDB>;

export const OUTREACH_TEST_VERSION = 1;
const DAY_MS = 86_400_000;
const CALLBACK_WINDOW_DAYS = 30;

/** Outcomes of the purchase register that mean a subscription was taken and paid. */
const SUBSCRIPTION_TAKEN = new Set(['minted', 'minted_fallback', 'attached']);

/**
 * The words the message itself offers for stopping (French, English, German)
 * and their usual forms. Matched on the recipient's own words only: see
 * `ownWords`.
 */
const OPT_OUT_RE =
  /(unsubscribe|d[ée]sinscri|ne plus recevoir|\bretrait\b|abmelden|austragen|\bstop\b|remove me)/i;

/** Out-of-office replies and similar: an answer from a machine, not from the person. */
const AUTOMATIC_RE =
  /(automatic reply|auto-?reply|out of (the )?office|abwesenheit|automatische antwort|r[ée]ponse automatique|absence du bureau|message automatique|risposta automatica|respuesta autom[áa]tica)/i;

/**
 * Where the quoted original starts in a reply. Our own message contains the
 * stop words, so a reply that quotes it would otherwise always read as a
 * request to stop.
 */
const QUOTE_START_RE =
  /^(>|on .+ wrote:|le .+ a [ée]crit ?:|am .+ schrieb|-{2,} ?(original message|message d'origine|urspr[üu]ngliche nachricht)|_{5,}$|(from|de|von) ?: .+@)/i;

export interface OutreachTestQuery {
  /** First day of the window, YYYY-MM-DD (UTC). */
  since: string;
  /** Last day of the window, YYYY-MM-DD (UTC, inclusive); null: until `now`. */
  until: string | null;
  /** The exact subjects of the message, one per language. */
  subjects: string[];
  now?: Date;
}

export interface OutreachTestSummary {
  version: number;
  generated_at: string;
  window: {
    since: string;
    until: string;
    /** Where subscriptions start counting: the first message sent, or `since`. */
    subscriptions_from: string;
    subjects: number;
  };
  sent: {
    messages: number;
    recipients: number;
    first_at: string | null;
    last_at: string | null;
    by_day: Record<string, number>;
  };
  replies: {
    /** Recipients who answered in person after their message (automatic replies aside). */
    recipients: number;
    messages: number;
    /** Among them, those whose own words ask to stop. */
    optout_recipients: number;
    other_recipients: number;
    /** Recipients from whom only an automatic reply came back. */
    automatic_only_recipients: number;
  };
  subscriptions: {
    total: number;
    pro: number;
    other_plans: number;
    on_existing_key: number;
    on_new_key: number;
    among_recipients: number;
    keys: Array<{
      key_prefix: string;
      plan: string | null;
      at: string;
      on_existing_key: boolean;
      recipient: boolean;
    }>;
  };
  called_within_30d: {
    /** Recipients with at least one key on record. */
    recipients_with_key: number;
    /** Recipients with at least one successful call between their message and thirty days later. */
    recipients: number;
    /** False while some recipient's thirty days have not yet elapsed at `until`. */
    window_complete: boolean;
  };
  not_measured: Record<string, string>;
}

/** Milliseconds for any of the stamp shapes this database holds, or null. */
export function parseStamp(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || raw.length < 10) return null;
  let s = raw.trim().replace(' ', 'T');
  if (s.length === 10) s += 'T00:00:00';
  else if (s.length === 16) s += ':00';
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z';
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/** SQLite's `datetime('now')` shape, the one request_log and key_purchases store. */
function sqlStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function foldSubject(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The reply's own lines, before the quoted original. */
export function ownWords(body: string): string {
  const kept: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (QUOTE_START_RE.test(line.trim())) break;
    kept.push(line);
  }
  return kept.join('\n');
}

export function asksToStop(subject: string | null, body: string | null): boolean {
  return OPT_OUT_RE.test(`${subject ?? ''}\n${ownWords(body ?? '')}`);
}

export function isAutomaticReply(subject: string | null, body: string | null): boolean {
  return AUTOMATIC_RE.test(`${subject ?? ''}\n${(body ?? '').slice(0, 600)}`);
}

export function summarizeOutreachTest(
  q: OutreachTestQuery,
  db: Db = getStatsDB(),
): OutreachTestSummary {
  const now = q.now ?? new Date();
  const sinceMs = parseStamp(q.since) ?? 0;
  const untilMs = q.until ? (parseStamp(q.until) ?? now.getTime()) + DAY_MS - 1 : now.getTime();
  const aliases = loadAliasMap();
  const canonical = (e: string | null | undefined): string => toCanonical(e ?? '', aliases);
  const subjects = new Set(q.subjects.map(foldSubject).filter(Boolean));

  // ─── Sent ──────────────────────────────────────────────────────────────────
  const outRows = db
    .prepare(
      `SELECT customer_email, msg_date, subject FROM email_messages
        WHERE direction = 'out' AND msg_date >= ? ORDER BY msg_date ASC`,
    )
    .all(q.since) as Array<{ customer_email: string; msg_date: string; subject: string | null }>;
  const firstSend = new Map<string, number>();
  const seen = new Set<string>();
  const byDay: Record<string, number> = {};
  let messages = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const r of outRows) {
    const at = parseStamp(r.msg_date);
    if (at === null || at < sinceMs || at > untilMs) continue;
    if (!subjects.has(foldSubject(r.subject))) continue;
    const email = canonical(r.customer_email);
    if (!email.includes('@') || isInternalEmail(email)) continue;
    const once = `${email}|${foldSubject(r.subject)}|${new Date(at).toISOString().slice(0, 16)}`;
    if (seen.has(once)) continue;
    seen.add(once);
    messages++;
    const day = new Date(at).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
    if (!firstSend.has(email) || at < (firstSend.get(email) as number)) firstSend.set(email, at);
    firstAt = firstAt === null ? at : Math.min(firstAt, at);
    lastAt = lastAt === null ? at : Math.max(lastAt, at);
  }

  // ─── Replies ───────────────────────────────────────────────────────────────
  const inRows = db
    .prepare(
      `SELECT customer_email, msg_date, subject, snippet, body FROM email_messages
        WHERE direction = 'in' AND msg_date >= ?`,
    )
    .all(q.since) as Array<{
    customer_email: string;
    msg_date: string;
    subject: string | null;
    snippet: string | null;
    body: string | null;
  }>;
  const replied = new Map<string, { human: number; optout: boolean; automatic: number }>();
  for (const r of inRows) {
    const email = canonical(r.customer_email);
    const sentAt = firstSend.get(email);
    const at = parseStamp(r.msg_date);
    if (sentAt === undefined || at === null || at <= sentAt || at > untilMs) continue;
    const text = r.body ?? r.snippet;
    const entry = replied.get(email) ?? { human: 0, optout: false, automatic: 0 };
    if (isAutomaticReply(r.subject, text)) {
      entry.automatic++;
    } else {
      entry.human++;
      if (asksToStop(r.subject, text)) entry.optout = true;
    }
    replied.set(email, entry);
  }
  const human = [...replied.values()].filter((e) => e.human > 0);

  // ─── Subscriptions ─────────────────────────────────────────────────────────
  const fromMs = firstAt ?? sinceMs;
  const subRows = db
    .prepare(
      `SELECT kp.key_prefix, kp.bundle, kp.outcome, kp.created_at, kp.payer_email, k.email AS key_email
         FROM key_purchases kp LEFT JOIN api_keys k ON k.key_hash = kp.key_hash
        WHERE kp.kind = 'subscription' AND kp.issued_by_us = 0 AND kp.created_at >= ?
        ORDER BY kp.created_at ASC`,
    )
    .all(q.since) as Array<{
    key_prefix: string;
    bundle: string | null;
    outcome: string;
    created_at: string;
    payer_email: string | null;
    key_email: string | null;
  }>;
  const keys: OutreachTestSummary['subscriptions']['keys'] = [];
  for (const r of subRows) {
    const at = parseStamp(r.created_at);
    if (at === null || at < fromMs || at > untilMs) continue;
    if (!SUBSCRIPTION_TAKEN.has(r.outcome)) continue;
    if (isInternalEmail(r.key_email) || isInternalEmail(r.payer_email)) continue;
    const recipient =
      firstSend.has(canonical(r.key_email)) || firstSend.has(canonical(r.payer_email));
    keys.push({
      key_prefix: r.key_prefix,
      plan: r.bundle,
      at: new Date(at).toISOString(),
      on_existing_key: r.outcome === 'attached',
      recipient,
    });
  }

  // ─── Called again within thirty days ───────────────────────────────────────
  const prefixesOf = new Map<string, string[]>();
  const keyRows = db.prepare('SELECT key_prefix, email FROM api_keys').all() as Array<{
    key_prefix: string;
    email: string;
  }>;
  for (const k of keyRows) {
    const email = canonical(k.email);
    if (!firstSend.has(email)) continue;
    prefixesOf.set(email, [...(prefixesOf.get(email) ?? []), k.key_prefix]);
  }
  let calledBack = 0;
  let complete = true;
  for (const [email, sentAt] of firstSend) {
    const prefixes = prefixesOf.get(email);
    const end = sentAt + CALLBACK_WINDOW_DAYS * DAY_MS;
    if (end > untilMs) complete = false;
    if (!prefixes?.length) continue;
    const hit = db
      .prepare(
        `SELECT 1 FROM request_log
          WHERE key_prefix IN (${prefixes.map(() => '?').join(',')})
            AND status < 400 AND created_at > ? AND created_at <= ? LIMIT 1`,
      )
      .get(...prefixes, sqlStamp(sentAt), sqlStamp(Math.min(end, untilMs)));
    if (hit) calledBack++;
  }

  const iso = (ms: number | null): string | null =>
    ms === null ? null : new Date(ms).toISOString();
  return {
    version: OUTREACH_TEST_VERSION,
    generated_at: now.toISOString(),
    window: {
      since: q.since,
      until: new Date(untilMs).toISOString(),
      subscriptions_from: new Date(fromMs).toISOString(),
      subjects: subjects.size,
    },
    sent: {
      messages,
      recipients: firstSend.size,
      first_at: iso(firstAt),
      last_at: iso(lastAt),
      by_day: byDay,
    },
    replies: {
      recipients: human.length,
      messages: human.reduce((n, e) => n + e.human, 0),
      optout_recipients: human.filter((e) => e.optout).length,
      other_recipients: human.filter((e) => !e.optout).length,
      automatic_only_recipients: [...replied.values()].filter((e) => e.human === 0).length,
    },
    subscriptions: {
      total: keys.length,
      pro: keys.filter((k) => k.plan === 'pro').length,
      other_plans: keys.filter((k) => k.plan !== 'pro').length,
      on_existing_key: keys.filter((k) => k.on_existing_key).length,
      on_new_key: keys.filter((k) => !k.on_existing_key).length,
      among_recipients: keys.filter((k) => k.recipient).length,
      keys,
    },
    called_within_30d: {
      recipients_with_key: prefixesOf.size,
      recipients: calledBack,
      window_complete: complete,
    },
    not_measured: {
      bounced:
        'Delivery-status notices are kept out of the CRM by the mail sync; count them on the mail server.',
      delivered: 'Needs the bounce count above: delivered = sent minus bounced.',
    },
  };
}
