import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { applyRedactionRules, parseRedactionRules } from '@/lib/crm/redaction-rules';

/**
 * Ground the brief in what this contact actually did with the API.
 *
 * The operator's complaint, verbatim in intent: a generated draft must be
 * "adapted to the client's context", not a generic pitch. The composer cannot
 * know the live usage, so the facts are fetched here, server-side, and
 * appended to `context` after redaction: signup source, quota consumption,
 * paywall refusals, endpoints, countries, stack. The writer upstream is told
 * these are the ONLY usable facts, numbers copied exactly.
 *
 * Best-effort by design: any miss (no admin credentials, unknown email, API
 * down) returns the body untouched and the draft is merely less specific.
 */
async function enrichWithUsageFacts(body: unknown): Promise<unknown> {
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (!apiUrl || !adminSecret || typeof body !== 'object' || body === null) return body;
  const b = body as Record<string, unknown>;
  const to = typeof b.to === 'string' ? b.to.trim().toLowerCase() : '';
  if (!to || typeof b.context !== 'string') return body;
  try {
    const headers = { 'X-Admin-Secret': adminSecret };
    const [keysRes, profRes] = await Promise.all([
      fetch(`${apiUrl}/v1/admin/keys`, { headers, signal: AbortSignal.timeout(6000) }),
      fetch(`${apiUrl}/v1/admin/client-profiles?days=90`, { headers, signal: AbortSignal.timeout(6000) }),
    ]);
    if (!keysRes.ok || !profRes.ok) return body;
    const keys = (((await keysRes.json()) as { keys?: unknown }).keys ?? []) as Array<Record<string, unknown>>;
    const profiles = (((await profRes.json()) as { profiles?: unknown }).profiles ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const mine = keys.filter((k) => String(k.email ?? '').toLowerCase() === to);
    if (mine.length === 0) return body;

    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const usedMonth = mine.reduce((a, k) => a + num(k.used), 0);
    const quota = mine.reduce((a, k) => a + (num(k.monthly_limit) || 200), 0);
    const created = mine
      .map((k) => String(k.created_at ?? ''))
      .filter(Boolean)
      .sort()[0];
    const sources = [...new Set(mine.map((k) => String(k.source ?? '')).filter(Boolean))];

    const byCountry = new Map<string, number>();
    const byEndpoint = new Map<string, number>();
    const agents = new Map<string, number>();
    let total90 = 0;
    let paywall = 0;
    for (const k of mine) {
      const p = profiles[String(k.key_prefix ?? '')];
      if (!p) continue;
      total90 += num(p.total);
      paywall += num(p.paywall);
      for (const c of (p.countries as Array<{ code?: string; count?: number }>) ?? []) {
        if (c.code) byCountry.set(c.code, (byCountry.get(c.code) ?? 0) + num(c.count));
      }
      for (const e of (p.endpoints as Array<{ path?: string; count?: number }>) ?? []) {
        if (e.path) byEndpoint.set(e.path, (byEndpoint.get(e.path) ?? 0) + num(e.count));
      }
      for (const u of (p.user_agents as Array<{ ua?: string; count?: number }>) ?? []) {
        if (u.ua) agents.set(u.ua, (agents.get(u.ua) ?? 0) + num(u.count));
      }
    }
    const top = (m: Map<string, number>, n: number) =>
      [...m.entries()].sort((a, z) => z[1] - a[1]).slice(0, n);

    const lines = [
      "API usage facts for this contact, from live IBANforge data. Ground the mail in them, use ONLY these facts, copy numbers exactly, never infer beyond them:",
      `- keys: ${mine.length}${created ? ` (first created ${created})` : ''}${sources.length ? `, signup source: ${sources.join(', ')}` : ''}`,
      `- this month: ${usedMonth} of ${quota} free calls used${usedMonth >= quota ? ' (quota reached)' : ''}${paywall ? `, ${paywall} refused at the paywall` : ''}`,
      total90 ? `- last 90 days: ${total90} successful calls; endpoints: ${top(byEndpoint, 4).map(([p, n]) => `${p} (${n})`).join(', ')}` : '- no successful call yet',
      byCountry.size ? `- countries checked: ${top(byCountry, 6).map(([c, n]) => `${c} (${n})`).join(', ')}` : '',
      agents.size ? `- stack: ${top(agents, 2).map(([u]) => u).join(', ')}` : '',
      'Product facts you may cite, nothing else: free tier 200 requests/month; batch endpoint up to 100 IBANs per call; prepaid credit packs from $5 per 1,000 calls, credits never expire; German BICs come straight from the Bundesbank register (11 characters, branch included); code examples: ibanforge.com/docs/recipes',
    ].filter(Boolean);

    return { ...b, context: `${b.context}\n\n${lines.join('\n')}` };
  } catch {
    return body;
  }
}

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
  const enriched = await enrichWithUsageFacts(redacted.body);
  try {
    const r = await fetch(`${upstream}/api/crm/generate-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': secret },
      body: JSON.stringify(enriched),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Endpoint VPS injoignable (déployé ?)' }, { status: 502 });
  }
}
