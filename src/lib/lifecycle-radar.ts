/**
 * Lifecycle radar — detection rules for the daily API-key lifecycle alert.
 *
 * Pure, side-effect-free logic (account classification, event detection,
 * anti-repetition state diffing and French Telegram formatting) so it can be
 * unit-tested under `npm run check`. All I/O (state persistence, Telegram
 * send, scheduling) lives in lifecycle-radar-server.ts, which runs inside the
 * API process — deliberately NOT in CI, so the customer ledger never transits
 * an external runner.
 *
 * Mirrors the JSON shapes of GET /v1/admin/keys and /v1/admin/client-activity
 * (see src/routes/api-keys.ts).
 */
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// API payload shapes
// ---------------------------------------------------------------------------

export interface AdminKey {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  active: number; // 0 | 1
  created_at: string; // ISO timestamp
  credits_total: number | null; // non-null => bought a credit pack (paid)
  credits_remaining: number | null;
  paid: number; // 0 | 1 (stripe_session_id present)
  used: number; // calls this calendar month
  used_prev: number; // calls the previous calendar month
  used_all_time: number;
  last_active_month: string | null;
  series?: number[];
}

export interface KeysResponse {
  month: string;
  prev_month: string;
  months: string[];
  keys: AdminKey[];
}

export interface ClientActivity {
  endpoints: Array<{ path: string; count: number }>;
  days: Array<{ day: string; count: number }>;
}

export interface ClientActivityResponse {
  by_key: Record<string, ClientActivity>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type RadarEventKind =
  | 'QUOTA_FULL'
  | 'QUOTA_80'
  | 'PAID_IDLE'
  | 'NEW_CORPORATE'
  | 'GONE_QUIET';

export interface RadarEvent {
  kind: RadarEventKind;
  keyPrefix: string;
  email: string;
  domain: string;
  company: string;
  /** French, one-line usage detail for the Telegram bullet. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Persisted state (anti-repetition)
// ---------------------------------------------------------------------------

export interface RadarKeyState {
  event: RadarEventKind;
  at: string; // ISO of the first time this exact event was signalled
}

export interface RadarState {
  last_run_at?: string;
  keys: Record<string, RadarKeyState>;
}

/** Default monthly quota when monthly_limit is null (mirrors scripts/admin-keys.ts). */
export const DEFAULT_MONTHLY_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Account classifiers
// ---------------------------------------------------------------------------

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

const INTERNAL_DOMAINS = ['ibanforge.com', 'example.com', 'example.org'];
// Operator accounts, held as sha256 prefixes: this repo is public and must
// not carry a personal address in the clear (the class that keeps coming
// back). Extend privately via RADAR_INTERNAL_EMAILS (comma-separated, env).
const INTERNAL_EMAIL_HASHES = new Set(['63a1239cff05c15f', 'db87e93d31614006', 'dff4e83bc451606b']);
const INTERNAL_SUBSTRINGS = [
  'playground',
  'workflow-test',
  'test-',
  '-test',
  'smoke',
  'audit',
  'gpt-store',
];
const INTERNAL_PROTON_RE = /^ca-[a-z]+-?\d*@proton\.me$/;

function sha16(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

const ENV_INTERNAL = (process.env.RADAR_INTERNAL_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Internal / test accounts we must never surface as commercial leads. */
export function isInternal(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return true; // no address => not an actionable lead
  if (INTERNAL_EMAIL_HASHES.has(sha16(e))) return true;
  if (ENV_INTERNAL.includes(e)) return true;
  if (INTERNAL_DOMAINS.includes(emailDomain(e))) return true;
  if (INTERNAL_PROTON_RE.test(e)) return true;
  if (INTERNAL_SUBSTRINGS.some((s) => e.includes(s))) return true;
  return false;
}

// Freemail providers: matched on the leftmost domain label (so outlook.fr,
// yahoo.co.uk, gmx.net … all resolve) plus a handful of full-domain providers.
const FREEMAIL_LABELS = new Set([
  'gmail',
  'qq',
  'proton',
  'protonmail',
  'outlook',
  'hotmail',
  'yahoo',
  'gmx',
  'icloud',
]);
const FREEMAIL_DOMAINS = new Set(['web.de', 'mail.ru', '163.com', '126.com']);

export function isFreemail(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (!d) return false;
  if (FREEMAIL_DOMAINS.has(d)) return true;
  return FREEMAIL_LABELS.has(d.split('.')[0] ?? '');
}

const DISPOSABLE_RE =
  /(^|\.)(mailinator|guerrillamail|yopmail|10minutemail|tempmail|temp-mail|trashmail|throwaway|sharklasers|getnada|dispostable|maildrop|mailnesia|fakeinbox|discard|spam4|grr|mailcatch|mohmal|mintemail)(\.|$)/;

export function isDisposable(domain: string): boolean {
  return DISPOSABLE_RE.test(domain.trim().toLowerCase());
}

/** A corporate lead = a real address whose domain is neither freemail nor disposable. */
export function isCorporate(email: string): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return !isFreemail(domain) && !isDisposable(domain);
}

const TWO_PART_SUFFIX = new Set([
  'co.uk',
  'org.uk',
  'com.au',
  'co.jp',
  'co.nz',
  'com.br',
  'co.za',
  'com.sg',
  'co.in',
  'com.mx',
]);

/** Best-effort company label from a domain (display hint only): acme.com → "Acme". */
export function guessCompany(domain: string): string {
  const d = domain.trim().toLowerCase().replace(/^www\./, '');
  if (!d) return '';
  const parts = d.split('.');
  let idx = parts.length - 2; // registrable label for a single-part TLD
  if (parts.length >= 3 && TWO_PART_SUFFIX.has(parts.slice(-2).join('.'))) {
    idx = parts.length - 3;
  }
  const label = parts[idx] ?? parts[0] ?? '';
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectOptions {
  now: Date;
  /** last_run_at from persisted state — anchors NEW_CORPORATE "created since last run". */
  lastRunAt?: Date;
  /** Bootstrap window (days) used when lastRunAt is missing, to avoid a first-run flood. */
  newWindowDays?: number;
  /**
   * Earliest day-of-month at which GONE_QUIET may fire (default 8). Guard against
   * the month-boundary false positive: on the 2nd of a month every corporate key
   * that was active last month but hasn't called *yet* would otherwise look
   * "gone quiet". Silence only becomes a churn signal once the month is under way.
   */
  goneQuietMinDayOfMonth?: number;
}

/**
 * One event per key, chosen by precedence:
 *   QUOTA_FULL > QUOTA_80 > PAID_IDLE > NEW_CORPORATE > GONE_QUIET.
 * Quota exhaustion is the most time-sensitive commercial trigger, so it wins
 * over a "hello" greeting when a brand-new key already burns its free tier.
 * Internal/test accounts and deactivated keys are excluded entirely.
 */
export function detectEvents(keys: AdminKey[], opts: DetectOptions): RadarEvent[] {
  const { now } = opts;
  const windowMs = (opts.newWindowDays ?? 2) * DAY_MS;
  const sinceMs = opts.lastRunAt ? opts.lastRunAt.getTime() : now.getTime() - windowMs;

  const goneQuietMinDom = opts.goneQuietMinDayOfMonth ?? 8;

  const events: RadarEvent[] = [];
  for (const k of keys) {
    if (!k.active) continue; // deactivated key: nothing to act on
    if (isInternal(k.email)) continue;

    const classified = classifyKey(k, now, sinceMs, goneQuietMinDom);
    if (!classified) continue;

    const domain = emailDomain(k.email);
    events.push({
      ...classified,
      keyPrefix: k.key_prefix,
      email: k.email,
      domain,
      company: guessCompany(domain),
    });
  }
  return events;
}

function classifyKey(
  k: AdminKey,
  now: Date,
  sinceMs: number,
  goneQuietMinDom: number,
): Pick<RadarEvent, 'kind' | 'detail'> | null {
  const isPaid = k.credits_total != null;

  // (a) QUOTA — free keys only
  if (!isPaid) {
    const limit = k.monthly_limit ?? DEFAULT_MONTHLY_LIMIT;
    const used = k.used ?? 0;
    const pct = limit > 0 ? used / limit : 0;
    if (pct >= 1) {
      return {
        kind: 'QUOTA_FULL',
        detail: `quota gratuit épuisé (${used}/${limit}, ${Math.round(pct * 100)}%)`,
      };
    }
    if (pct >= 0.8) {
      return {
        kind: 'QUOTA_80',
        detail: `quota gratuit à ${Math.round(pct * 100)}% (${used}/${limit})`,
      };
    }
  }

  // (b) PAID_IDLE — bought a credit pack, <5% consumed, 7+ days after creation
  if (isPaid && (k.credits_total ?? 0) > 0) {
    const total = k.credits_total as number;
    const remaining = k.credits_remaining ?? total;
    const consumed = total - remaining;
    const consumedFrac = total > 0 ? consumed / total : 0;
    const ageDays = (now.getTime() - Date.parse(k.created_at)) / DAY_MS;
    if (consumedFrac < 0.05 && ageDays >= 7) {
      return {
        kind: 'PAID_IDLE',
        detail: `pack payé quasi inutilisé : ${consumed}/${total} crédits (${Math.round(
          consumedFrac * 100,
        )}%), créé il y a ${Math.floor(ageDays)} j`,
      };
    }
  }

  // (c) NEW_CORPORATE — corporate domain, created since the last run
  if (isCorporate(k.email)) {
    const createdMs = Date.parse(k.created_at);
    if (Number.isFinite(createdMs) && createdMs > sinceMs) {
      return {
        kind: 'NEW_CORPORATE',
        detail: `nouveau lead corporate (limite ${k.monthly_limit ?? DEFAULT_MONTHLY_LIMIT}/mois)`,
      };
    }
  }

  // (d) GONE_QUIET — corporate, active last month, silent this month (once the
  // month is under way; see goneQuietMinDayOfMonth).
  if (
    now.getUTCDate() >= goneQuietMinDom &&
    isCorporate(k.email) &&
    (k.used_prev ?? 0) > 0 &&
    (k.used ?? 0) === 0
  ) {
    return {
      kind: 'GONE_QUIET',
      detail: `silence radio : ${k.used_prev} appels le mois dernier, 0 ce mois-ci`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Anti-repetition: diff detected events against persisted state
// ---------------------------------------------------------------------------

export interface DiffResult {
  /** Events that are new since the last run (never signalled, or escalated). */
  fresh: RadarEvent[];
  /** State to persist: current events only, so cleared keys re-arm next time. */
  nextState: RadarState;
}

export function diffAgainstState(
  events: RadarEvent[],
  prev: RadarState,
  now: Date,
): DiffResult {
  const nowIso = now.toISOString();
  const fresh: RadarEvent[] = [];
  const nextKeys: Record<string, RadarKeyState> = {};

  for (const ev of events) {
    const before = prev.keys[ev.keyPrefix];
    const isNew = !before || before.event !== ev.kind;
    if (isNew) fresh.push(ev);
    nextKeys[ev.keyPrefix] = { event: ev.kind, at: isNew ? nowIso : before.at };
  }

  return { fresh, nextState: { last_run_at: nowIso, keys: nextKeys } };
}

// ---------------------------------------------------------------------------
// French Telegram formatting
// ---------------------------------------------------------------------------

const KIND_META: Record<RadarEventKind, { emoji: string; title: string; action: string }> = {
  QUOTA_FULL: {
    emoji: '🔴',
    title: 'QUOTA GRATUIT ÉPUISÉ',
    action: 'proposer un pack crédits / le passage payant.',
  },
  QUOTA_80: {
    emoji: '🟠',
    title: 'QUOTA GRATUIT ≥ 80%',
    action: 'anticiper un upsell avant le blocage.',
  },
  PAID_IDLE: {
    emoji: '💤',
    title: 'PACK PAYÉ INACTIF',
    action: 'relancer avec un cas d’usage / aide à l’intégration.',
  },
  NEW_CORPORATE: {
    emoji: '🟢',
    title: 'NOUVEAU LEAD CORPORATE',
    action: 'saluer et se présenter (geste humain).',
  },
  GONE_QUIET: {
    emoji: '🔕',
    title: 'CLIENT CORPORATE SILENCIEUX',
    action: 'prendre des nouvelles avant le churn.',
  },
};

const ORDER: RadarEventKind[] = [
  'QUOTA_FULL',
  'QUOTA_80',
  'PAID_IDLE',
  'NEW_CORPORATE',
  'GONE_QUIET',
];

export function frDate(now: Date): string {
  return now.toLocaleDateString('fr-CH', { day: '2-digit', month: 'long', year: 'numeric' });
}

function activityHint(e: RadarEvent, activity?: ClientActivityResponse): string {
  const a = activity?.by_key?.[e.keyPrefix];
  if (!a) return '';
  const bits: string[] = [];
  const top = a.endpoints?.[0];
  if (top) bits.push(`surtout ${top.path}`);
  const lastDay = a.days?.length ? a.days[a.days.length - 1]?.day : undefined;
  if (lastDay) bits.push(`dernier appel ${lastDay}`);
  return bits.length ? ` · ${bits.join(', ')}` : '';
}

/**
 * Compact French report grouped by event kind. Plain text (no markdown), same
 * spirit as scripts/weekly-veille.ts. Returns the message body; the runner
 * decides whether to send it (only when there is at least one fresh event).
 */
export function formatReport(
  fresh: RadarEvent[],
  opts: { now: Date; activity?: ClientActivityResponse },
): string {
  const lines: string[] = [`🛰️ RADAR CLIENTS IBANFORGE — ${frDate(opts.now)}`, ''];
  for (const kind of ORDER) {
    const group = fresh.filter((e) => e.kind === kind);
    if (!group.length) continue;
    const meta = KIND_META[kind];
    lines.push(`${meta.emoji} ${meta.title}`);
    for (const e of group) {
      // Key prefix + company/domain, never the email address: this report
      // transits Telegram, which is not a declared processor — no personal
      // data may ride along. The dashboard resolves the identity.
      const who = `${e.keyPrefix}… (${e.company || e.domain})`;
      lines.push(`• ${who} — ${e.detail}${activityHint(e, opts.activity)}. Action : ${meta.action}`);
    }
    lines.push('');
  }
  lines.push('Identités : https://ibanforge.com/dashboard/clients');
  lines.push('— Dory · radar lifecycle quotidien');
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// HTTP helper (fetch injectable so it can be unit-tested with a mock)
// ---------------------------------------------------------------------------

export async function fetchAdmin<T>(
  base: string,
  secret: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${base}${path}`, {
    headers: { 'X-Admin-Secret': secret },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}
