import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { applyRedactionRules, parseRedactionRules } from '@/lib/crm/redaction-rules';

/**
 * Thin authenticated proxy: the dashboard button posts the contact brief here,
 * we add the shared secret and forward to the tabornio VPS endpoint that
 * generates the draft (Anthropic). Keeps the secret server-side.
 *
 * The body is forwarded as sent, `deposit` included, with one exception: the
 * confidentiality rules of `CRM_DRAFT_REDACTION_RULES` are appended to
 * `context` here rather than in the browser, so that neither the domains they
 * key on nor the names they protect reach the client bundle or this
 * repository. See lib/crm/redaction-rules.ts. With the variable unset the body
 * goes upstream untouched.
 *
 * The CRM composer always sends `deposit: false`, which makes the VPS generate
 * and return without writing anything to the mailbox's Drafts folder; the
 * draft is then stored as a CRM row through /api/crm/draft-message and
 * reviewed in the thread. The upstream default is still `true` for any other
 * caller.
 *
 * Note that `deposit: false` does not make the call independent of mail
 * configuration: the VPS resolves the active MailAccount and its password
 * before it looks at the flag, so an unconfigured mailbox is still a 404 or a
 * 400, with the reason in `detail`.
 */
export async function POST(req: NextRequest) {
  /*
   * Read per request, not once at module load. The values never change under a
   * running server, so this costs nothing in production, and it is what lets
   * the redaction matrix be exercised for real in route.test.ts: a constant
   * captured at import time cannot be varied afterwards.
   */
  const upstream = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
  const secret = process.env.CRM_DRAFT_SECRET || '';

  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!secret) {
    return NextResponse.json({ error: 'not_configured', message: 'CRM_DRAFT_SECRET manquant côté serveur' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const rawRules = process.env.CRM_DRAFT_REDACTION_RULES;
  /*
   * A value that parses to nothing is worth saying out loud. The parser is
   * forgiving on purpose, so one stray character makes a configured rule
   * silently inactive, and a rule that is silently inactive looks exactly like
   * a variable that was never set. For a confidentiality rule the silent
   * failure runs toward disclosure. The value itself is never logged.
   */
  if (rawRules && rawRules.trim() && parseRedactionRules(rawRules).length === 0) {
    console.warn('[crm] CRM_DRAFT_REDACTION_RULES is set but parses to no rule; expected domain=Name entries');
  }
  const redacted = applyRedactionRules(body, rawRules);
  if (!redacted.ok) {
    // A confidentiality rule applies and `context` is not a field it can be
    // attached to. Refusing is the only honest answer: generating anyway would
    // return a draft free to write the very name the rule exists to keep out.
    return NextResponse.json(
      { error: redacted.reason, message: 'Champ context inattendu, génération refusée' },
      { status: 400 },
    );
  }
  try {
    const r = await fetch(`${upstream}/api/crm/generate-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': secret },
      body: JSON.stringify(redacted.body),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Endpoint VPS injoignable (déployé ?)' }, { status: 502 });
  }
}
