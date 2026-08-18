import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

/**
 * Draft generator for the Forums tab.
 *
 * The doctrine is "solutionneur, pas vendeur", distilled from the hand-written
 * answers that were validated on 18/08/2026: answer the actual problem first
 * (the reply must be useful even if the product did not exist), disclose the
 * affiliation once, cite at least one honest alternative, keep the product
 * mention to one verifiable fact. A reply that reads like an ad gets deleted
 * by moderators AND poisons the account for every future post, so the system
 * prompt treats the sales tone as a hard failure, not a style preference.
 *
 * Product claims are whitelisted below; the model is told anything outside
 * the list is forbidden. Every draft is still human-reviewed before posting —
 * this generates a starting point, not a publication.
 */

const PRODUCT_FACTS = [
  'Free tier: 200 requests/month, no card required.',
  'POST /v1/iban/validate returns bic, bank_code_check (does the national bank code exist in its register, with institution name/address where the register provides them), sepa.schemes (SCT/SDD reachability) and sepa.vop_participant (is the resolved institution listed VoP-ready in the EPC register).',
  'National registers refreshed monthly: SIX BankMaster (CH/LI, includes QR-IID 30000-31999 and merger redirects), Bundesbank (DE), OeNB (AT), NBB (BE), plus GLEIF BIC-to-LEI open data.',
  'OpenAPI spec: https://api.ibanforge.com/openapi.json · MCP server on npm: ibanforge-mcp.',
  'Honest alternatives you may cite: schwifty (Python, offline snapshots), the paid SWIFT IBAN Plus directory, free national files (Bundesbank BLZ, SIX BankMaster), iban.com / ibanapi.com (commercial).',
].join('\n');

const SYSTEM = `You draft forum/issue replies for the maintainer of ibanforge.com (IBAN/BIC validation API). The reader must experience a peer solving their problem, never a vendor.

Hard rules, in order:
1. FIRST solve or clearly explain the actual problem in the thread, in concrete technical terms. The reply must stand on its own even with every product mention deleted.
2. Disclose the affiliation exactly once, plainly: "disclosure: I built ibanforge.com" (or run/maintain). Never hide it, never repeat it.
3. Cite at least one honest alternative from the whitelist (a library, a free national file, a competitor). No strawmen.
4. At most ONE product mention, tied to a verifiable fact from the whitelist below. No superlatives, no "best", no feature lists, no call to action, no "feel free to", no links other than documentation-grade ones.
5. Use ONLY these product facts, never invent numbers or capabilities:
${PRODUCT_FACTS}
6. Write in the thread's language (given as "lang"). Sober markdown fitting the platform (GitHub issue or Stack Overflow answer). 120 to 250 words.
7. Typography: NEVER use em dashes or en dashes anywhere. Use commas, colons or parentheses. Short sentences.
8. Never criticise a person; correcting a factual claim is fine.
9. If the thread is not actually a problem the API solves, say so in the summary and produce a draft that is pure expertise with zero product mention.

Return STRICT JSON, nothing else:
{"draft": "<the reply in the thread's language>", "summary_fr": "<2-3 French sentences for the operator: what the thread asks, and the angle of this reply>"}`;

function extractJson(text: string): { draft?: unknown; summary_fr?: unknown } | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  // Walk to the balanced closing brace so a chatty preamble cannot break parsing.
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as { draft?: unknown; summary_fr?: unknown };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Defensive: the ban is prompt-enforced, this catches any slip. */
function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ');
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'not_configured',
        message:
          "ANTHROPIC_API_KEY absente côté Vercel : la génération IA est débranchée. Demande les brouillons à Claude en session, ou pose la clé (vercel env add).",
      },
      { status: 503 },
    );
  }
  let body: { title?: unknown; excerpt?: unknown; url?: unknown; lang?: unknown; source?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.slice(0, 300) : '';
  if (!title) return NextResponse.json({ error: 'invalid_input', message: 'title requis' }, { status: 400 });
  const excerpt = typeof body.excerpt === 'string' ? body.excerpt.slice(0, 1500) : '';
  const lang = typeof body.lang === 'string' && ['en', 'de', 'fr'].includes(body.lang) ? body.lang : 'en';
  const source = typeof body.source === 'string' ? body.source.slice(0, 40) : 'forum';
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : '';

  const user = [
    `Platform: ${source}`,
    `Thread URL: ${typeof body.url === 'string' ? body.url.slice(0, 300) : '(none)'}`,
    `lang: ${lang}`,
    `Title: ${title}`,
    excerpt ? `Thread excerpt:\n${excerpt}` : 'Thread excerpt: (none, judge from the title)',
    notes ? `Operator notes (private context, never quote them): ${notes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1400,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return NextResponse.json(
        { error: 'anthropic_error', message: `Anthropic HTTP ${r.status}`, detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }
    const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? []).map((c) => c.text ?? '').join('');
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.draft !== 'string' || typeof parsed.summary_fr !== 'string') {
      return NextResponse.json({ error: 'bad_generation', raw: text.slice(0, 500) }, { status: 502 });
    }
    return NextResponse.json({
      draft: stripDashes(parsed.draft.trim()),
      summary_fr: stripDashes(parsed.summary_fr.trim()),
      lang,
    });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Anthropic injoignable' }, { status: 502 });
  }
}
