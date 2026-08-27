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
/**
 * What the product IS, in the words a draft is allowed to use.
 *
 * One constant because two readers need it and they must not drift: a customer
 * mail cites it to be concrete, and a letter to an institution cites it to say
 * who is writing. The commercial road reaches it through the usage facts below;
 * the institutional road has no usage to speak of and reaches it directly.
 */
const PRODUCT_FACTS =
  'Product facts you may cite, nothing else: free tier 200 requests/month; batch endpoint up to 100 IBANs per call; prepaid credit packs from $5 per 1,000 calls, credits never expire; German BICs come straight from the Bundesbank register (11 characters, branch included); code examples: ibanforge.com/docs/recipes';

/**
 * The writer guessed a first name off a domain on the first live control of
 * this route. A guessed name that lands wrong opens the mail on an insult, and
 * it is worse in a letter to a desk than in a mail to a lead.
 */
const ADDRESS_RULE =
  'Address rule: unless a personal name appears in the brief above, do not guess one (never from the email domain); open with a plain Hi.';

/** The operator's private notes on one address, newest first, best-effort. */
async function operatorNotesFor(to: string, apiUrl: string, adminSecret: string): Promise<string[]> {
  if (!apiUrl || !adminSecret) return [];
  try {
    const res = await fetch(`${apiUrl}/v1/admin/contact-notes?email=${encodeURIComponent(to)}`, {
      headers: { 'X-Admin-Secret': adminSecret },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const notes = ((await res.json()) as { notes?: Array<{ note: string; created_at: string }> }).notes ?? [];
    return notes.slice(0, 6).map((n) => `${n.created_at.slice(0, 10)}: ${n.note}`);
  } catch {
    return [];
  }
}

/**
 * Ground a letter to an institution in what IBANforge is and what we are asking
 * that institution for.
 *
 * It exists because the usage enrichment below cannot serve this case at all:
 * that one is keyed on API keys, and `if (mine.length === 0) return body` means
 * an address holding no key receives NOTHING. An authority holds no key by
 * definition, so without this branch the single most consequential mail the CRM
 * writes — a request for permission to redistribute somebody's register — would
 * be generated with no idea who is writing or why.
 *
 * The facts are the identity, the file line and the operator's own notes. No
 * numbers are invented and no register is named here: what we are asking for
 * comes from `dossier`, which the operator wrote.
 *
 * `institutional: true` is added to the body HERE rather than in the composer.
 * The upstream VPS reads it to pick its own writing mode, and a flag the client
 * has to remember is a flag one send path forgets. The server sets it exactly
 * when it has treated the request as institutional, so the two cannot disagree.
 */
async function enrichInstitutional(
  b: Record<string, unknown>,
  to: string,
  apiUrl: string,
  adminSecret: string,
): Promise<unknown> {
  const inst = (typeof b.institution === 'object' && b.institution !== null ? b.institution : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const org = str(inst.org);
  const category = str(inst.category);
  const country = str(inst.country);
  const dossier = str(inst.dossier);

  // Best-effort and never fatal: a notes endpoint that is down costs
  // personalisation, not the letter. The identity block below is written either
  // way, which is the whole difference with the commercial road.
  const notes = await operatorNotesFor(to, apiUrl, adminSecret);

  const lines = [
    'You are writing WRITTEN CORRESPONDENCE on behalf of IBANforge to an institution. Ground the letter in the facts below, use ONLY these facts, and never invent a legal basis, a reference number or a deadline:',
    '- Who is writing: IBANforge, a Swiss commercial API that validates IBANs and looks up BIC/SWIFT codes for software companies and payment providers.',
    '- How IBANforge treats public data: registers are cited with attribution and with the date of the extract, and permission is asked IN WRITING before any datum from a source is served to customers. That is why this letter exists; say so plainly rather than apologising for it.',
    org ? `- Institution addressed: ${org}${category ? ` (${category})` : ''}${country ? `, ${country}` : ''}` : '',
    dossier ? `- Our file with them, in the operator's own words: ${dossier}` : '',
    notes.length
      ? `- Operator notes on this correspondent (private ground truth, use them to be precise, never quote them verbatim): ${notes.join(' | ')}`
      : '',
    PRODUCT_FACTS,
    ADDRESS_RULE,
  ].filter(Boolean);

  return {
    ...b,
    context: `${String(b.context)}\n\n${lines.join('\n')}`,
    institutional: true,
  };
}

async function enrichWithUsageFacts(body: unknown): Promise<unknown> {
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (typeof body !== 'object' || body === null) return body;
  const b = body as Record<string, unknown>;
  const to = typeof b.to === 'string' ? b.to.trim().toLowerCase() : '';
  if (!to || typeof b.context !== 'string') return body;
  // Before the admin credentials are required, and before anything reads a
  // key: the institutional facts are mostly static, so this branch works on a
  // deployment where the admin API is unreachable, and it must — that letter
  // has no second source of context to fall back on.
  if (b.contact_kind === 'institution') return enrichInstitutional(b, to, apiUrl, adminSecret);
  if (!apiUrl || !adminSecret) return body;
  try {
    const headers = { 'X-Admin-Secret': adminSecret };
    const [keysRes, profRes, notesRes] = await Promise.all([
      fetch(`${apiUrl}/v1/admin/keys`, { headers, signal: AbortSignal.timeout(6000) }),
      fetch(`${apiUrl}/v1/admin/client-profiles?days=90`, { headers, signal: AbortSignal.timeout(6000) }),
      fetch(`${apiUrl}/v1/admin/contact-notes?email=${encodeURIComponent(to)}`, {
        headers,
        signal: AbortSignal.timeout(6000),
      }).catch(() => null),
    ]);
    if (!keysRes.ok || !profRes.ok) return body;
    const operatorNotes =
      notesRes?.ok === true
        ? ((((await notesRes.json()) as { notes?: Array<{ note: string; created_at: string }> }).notes ?? [])
            .slice(0, 6)
            .map((n) => `${n.created_at.slice(0, 10)}: ${n.note}`))
        : [];
    const keys = (((await keysRes.json()) as { keys?: unknown }).keys ?? []) as Array<Record<string, unknown>>;
    const profiles = (((await profRes.json()) as { profiles?: unknown }).profiles ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const mine = keys.filter((k) => String(k.email ?? '').toLowerCase() === to);
    if (mine.length === 0) return body;

    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    // Paid keys live outside the free monthly counter: their calls burn
    // prepaid credits, so `used` stays at 0 and a free-tier-only reading
    // produces the exact wrong mail (upselling the pack they already bought —
    // which is what happened on the first live control of this route).
    const freeKeys = mine.filter((k) => !num(k.paid));
    const paidKeys = mine.filter((k) => num(k.paid));
    const usedMonth = freeKeys.reduce((a, k) => a + num(k.used), 0);
    const quota = freeKeys.reduce((a, k) => a + (num(k.monthly_limit) || 200), 0);
    const creditsTotal = paidKeys.reduce((a, k) => a + num(k.credits_total), 0);
    const creditsLeft = paidKeys.reduce((a, k) => a + num(k.credits_remaining), 0);
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
      paidKeys.length
        ? `- PAYING CUSTOMER: bought a prepaid credit pack of ${creditsTotal} calls; ${creditsLeft} credits remaining (${creditsTotal - creditsLeft} already consumed). Do not sell them what they already own; thank them and help them get value from it.`
        : '',
      freeKeys.length
        ? `- free tier this month: ${usedMonth} of ${quota} calls used${usedMonth >= quota ? ' (quota reached)' : ''}${paywall ? `, ${paywall} refused at the paywall` : ''}${paidKeys.length ? ' (before they bought the pack)' : ''}`
        : '',
      total90 ? `- last 90 days: ${total90} successful calls; endpoints: ${top(byEndpoint, 4).map(([p, n]) => `${p} (${n})`).join(', ')}` : '- no successful call yet',
      byCountry.size ? `- countries checked: ${top(byCountry, 6).map(([c, n]) => `${c} (${n})`).join(', ')}` : '',
      agents.size ? `- stack: ${top(agents, 2).map(([u]) => u).join(', ')}` : '',
      operatorNotes.length
        ? `- Operator notes on this contact (private ground truth, use them to personalize, never quote them verbatim): ${operatorNotes.join(' | ')}`
        : '',
      PRODUCT_FACTS,
      ADDRESS_RULE,
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
