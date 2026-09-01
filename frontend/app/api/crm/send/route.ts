import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { isAuthenticated } from '@/lib/auth';
import type { MessageRow } from '@/lib/crm/build-contacts';
import { checkDraft } from '@/lib/crm/guardrails';
import type { Intent } from '@/lib/crm/intent';
import { countSentToday } from '@/lib/crm/sent-today';

/**
 * Read per call, never captured at module load. A constant frozen at import
 * time is read once for the life of the server process, which makes a variable
 * added later invisible until a redeploy, and makes this route untestable: the
 * value would be fixed before any test could set it. Same shape as
 * generate-draft/route.ts beside it.
 */
function env() {
  return {
    upstream: process.env.TABORNIO_CRM_URL || 'https://tabornio.ch',
    secret: process.env.CRM_DRAFT_SECRET || '',
    apiUrl: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '',
    adminSecret: process.env.ADMIN_SECRET || '',
  };
}

/**
 * Record the just-sent message into the CRM immediately so it shows in the
 * timeline on the next refresh — no waiting for the IMAP "Sent" sync. The id
 * matches sync-sent.py's scheme (md5 of email|out|date|subject) so the later
 * IMAP sync upserts the same row instead of creating a duplicate.
 */
async function recordSent(to: string, subject: string, body: string, account: string) {
  const { apiUrl, adminSecret } = env();
  if (!apiUrl || !adminSecret) return;
  /**
   * Seconds in the DATE, minutes in the ID (audit finding TABS-19, 2026-09-01).
   *
   * TABS-19 is real: the id is md5(to|out|stamp|subject), so two mails sent to
   * one address inside the same minute hash to one id and the second silently
   * overwrites the first, leaving one timeline line where two mails left.
   *
   * 🚨 And it CANNOT be closed from this side alone. This scheme is shared with
   * `sync-sent.py` on the VPS, which rebuilds the same md5 from the Sent copy's
   * own Date header at minute granularity; matching ids is the entire reason a
   * mail recorded here is not duplicated by the IMAP sync fifteen minutes
   * later. Putting seconds in the id here would make every single mail sent
   * from the dashboard appear twice, which is a far worse defect than the rare
   * same-minute collision it fixes. The two schemes have to move together.
   *
   * So the id keeps the minute, and only the stored date gains the seconds:
   * that costs nothing (the sync's upsert simply writes its own stamp back, and
   * every reader of this column compares the leading YYYY-MM-DD), and it is
   * what orders two mails of the same minute in a thread that received both.
   */
  const stamp = new Date().toISOString();
  const date = stamp.slice(0, 19); // YYYY-MM-DDTHH:MM:SS
  const idDate = stamp.slice(0, 16); // YYYY-MM-DDTHH:MM, sync-sent.py's grain
  const id = createHash('md5').update(`${to}|out|${idDate}|${subject}`).digest('hex');
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 280);
  const msg = {
    id,
    customer_email: to,
    direction: 'out',
    msg_date: date,
    subject,
    snippet,
    // 50k, not 6k. The cap existed to keep the row small, but it silently
    // amputated the longest mails ever sent from here: measured 29/07/2026,
    // several were stored at exactly 6000 characters, cut mid-sentence. The
    // send itself was never truncated, so the loss was invisible until the
    // record was read back. A mail past 50k is a different problem.
    body: body.slice(0, 50_000),
    counterparty: account,
  };
  try {
    await fetch(`${apiUrl}/v1/admin/email-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ messages: [msg] }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // best-effort: the IMAP sync will pick it up later anyway
  }
}

/**
 * How many mails already left today, counted from the stored rows rather than
 * from the page that is asking.
 *
 * Only today's rows are fetched, and without their bodies: the day filter and
 * `fields=summary` were added to the admin endpoint for exactly this call, so
 * arming a cap costs a few rows instead of the whole mailbox.
 *
 * Returns null when the count cannot be established — no admin credentials, an
 * unreachable API, a malformed answer. Null means "do not judge the cap", not
 * "zero": a daily cap is domain hygiene, and a missing environment variable
 * must never be what stops the founder from answering a customer.
 */
async function serverSentToday(now: Date): Promise<number | null> {
  const { apiUrl, adminSecret } = env();
  if (!apiUrl || !adminSecret) return null;
  const day = now.toISOString().slice(0, 10);
  try {
    const r = await fetch(
      `${apiUrl}/v1/admin/email-messages?fields=summary&since=${day}`,
      {
        headers: { 'X-Admin-Secret': adminSecret },
        cache: 'no-store',
        /**
         * Three seconds, not ten. This call sits IN FRONT of the send's own 40s
         * budget, and the 03/07/2026 incident is what a budget overrun looks
         * like here: the proxy cut while SMTP had already delivered, the UI
         * reported a failure, and re-clicking sent the mail twice. A count over
         * one day of rows is milliseconds; a deadline this short costs nothing
         * and cannot push the send past the proxy's ceiling. Failing open on
         * timeout is what makes it safe to be impatient.
         */
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { messages?: MessageRow[] } | null;
    if (!j || !Array.isArray(j.messages)) return null;
    return countSentToday(j.messages, now);
  } catch {
    return null;
  }
}

interface SendBody {
  account?: unknown;
  to?: unknown;
  subject?: unknown;
  body?: unknown;
  /**
   * Which rule set the composer armed. Declared by the caller because only the
   * caller knows the thread: intent is derived from the situation and the
   * contact kind (see intent.ts), neither of which this route holds.
   *
   * Absent falls to 'outbound', the STRICT road, on purpose. A surface that
   * forgets to declare it loses no guard; the opposite default would let a
   * forgotten field silently disarm the daily cap, which is the whole defect
   * this check exists to close.
   */
  intent?: unknown;
  /**
   * The blocking codes the operator explicitly passed over in the composer,
   * with the two clicks the override costs.
   *
   * This is not a hole in the check, it is the check's other half. The
   * guardrails have always been overridable by design — an em dash in a quoted
   * line, an eleventh mail that genuinely has to leave today — and a server
   * that refused what the operator deliberately allowed would simply teach him
   * that the dashboard is broken. What the server adds is the count he cannot
   * see: a page left open since yesterday, or a second tab, reports a stale
   * `sentToday`, and no override was ever given for the cap that count hides.
   */
  override?: unknown;
}

/** The rule codes that stop a send. Everything else in a report is advisory. */
function uncoveredBlockers(
  body: string,
  subject: string,
  sentToday: number,
  intent: Intent,
  override: string[],
): string[] {
  const report = checkDraft({
    body,
    subject,
    sentToday,
    // Only ever loosens two warnings, and warnings do not block: leaving it
    // false here cannot make the server refuse something the browser passed.
    isFirstTouch: false,
    intent,
  });
  return report.issues
    .filter((i) => i.level === 'blocking')
    .map((i) => i.code)
    .filter((code) => !override.includes(code));
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Authenticated proxy: send the email from the CRM via the tabornio SMTP
 * endpoint, after replaying the composer's blocking rules on the server.
 *
 * Why replay them at all (audit finding TABS-03, 2026-09-01): the caller is
 * always an authenticated session, so this is not a door held open for a third
 * party. It is reliability. The three blocking rules lived only in the browser,
 * which is the one place that can be out of date — a tab left open across
 * midnight, a second tab, a page rendered before ten mails went out from
 * somewhere else. This is the only irreversible gesture the dashboard makes,
 * and it was the only one with no test and no server-side check.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { upstream, secret } = env();
  if (!secret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid_payload', message: 'Corps de requête inattendu.' }, { status: 400 });
  }
  const b = raw as SendBody;
  const to = typeof b.to === 'string' ? b.to.trim() : '';
  const subject = typeof b.subject === 'string' ? b.subject : '';
  const text = typeof b.body === 'string' ? b.body : '';
  if (!to.includes('@')) {
    return NextResponse.json(
      { error: 'invalid_recipient', message: 'Destinataire manquant ou invalide.' },
      { status: 400 },
    );
  }

  const now = new Date();
  const intent: Intent = b.intent === 'reply' ? 'reply' : 'outbound';
  const override = asStringArray(b.override);
  // Null keeps the cap unjudged rather than judged at zero: see serverSentToday.
  const counted = intent === 'outbound' ? await serverSentToday(now) : null;
  const blockers = uncoveredBlockers(text, subject, counted ?? 0, intent, override);
  if (blockers.length > 0) {
    // 429 only when the cap is the whole story. A mail refused for its text is
    // a 400 whatever the counter says, and mixing the two would make the status
    // depend on the order the rules happen to fire in.
    const capOnly = blockers.length === 1 && blockers[0] === 'daily_cap';
    return NextResponse.json(
      {
        error: capOnly ? 'daily_cap' : 'guardrail_blocked',
        codes: blockers,
        sentToday: counted,
        message: capOnly
          ? `Plafond du jour atteint (${counted}). Ce mail n’est pas parti.`
          : 'Ce mail enfreint une règle bloquante du projet. Il n’est pas parti.',
      },
      { status: capOnly ? 429 : 400 },
    );
  }

  try {
    // Only the four fields the VPS knows are relayed. `intent` and `override`
    // are this route's own vocabulary and have no business downstream.
    const account = typeof b.account === 'string' ? b.account : '';
    const r = await fetch(`${upstream}/api/crm/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': secret },
      body: JSON.stringify({ account, to, subject, body: text }),
      signal: AbortSignal.timeout(40_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    // On a confirmed send, record it into the timeline immediately.
    if (r.ok && data && (data as { sent?: boolean }).sent && subject) {
      await recordSent(to, subject, text, account);
    }
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Endpoint VPS injoignable' }, { status: 502 });
  }
}
