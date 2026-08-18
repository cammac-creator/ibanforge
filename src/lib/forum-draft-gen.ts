/**
 * Draft generation for the community radar, backend-side.
 *
 * The operator's requirement (18/08/2026): every thread in the Forums tab
 * arrives with its reply draft and French summary ALREADY filled, no button.
 * So generation runs inside the radar tick, right after a thread is scored
 * in, and as a bounded backfill for rows still missing a draft.
 *
 * The doctrine is "solutionneur, pas vendeur", distilled from the replies
 * hand-validated on 18/08: solve the actual problem first (the reply must
 * stand without the product), disclose the affiliation once, cite an honest
 * alternative, one product mention max on whitelisted facts, thread's
 * language, no em dashes ever. A reply that reads like an ad gets deleted by
 * moderators AND poisons the account for every future post.
 *
 * Every draft is still reviewed by a human before posting; this produces the
 * starting point, not the publication.
 */

const PRODUCT_FACTS = [
  'Free tier: 200 requests/month, no card required.',
  'POST /v1/iban/validate returns bic, bank_code_check (does the national bank code exist in its register, with institution name/address where the register provides them), sepa.schemes (SCT/SDD reachability) and sepa.vop_participant (is the resolved institution listed VoP-ready in the EPC register).',
  'National registers refreshed monthly: SIX BankMaster (CH/LI, includes QR-IID 30000-31999 and merger redirects), Bundesbank (DE), OeNB (AT), NBB (BE), plus GLEIF BIC-to-LEI open data.',
  'OpenAPI spec: https://api.ibanforge.com/openapi.json · MCP server on npm: ibanforge-mcp.',
  'Honest alternatives you may cite: schwifty (Python, offline snapshots), the paid SWIFT IBAN Plus directory, free national files (Bundesbank BLZ, SIX BankMaster), iban.com / ibanapi.com (commercial).',
].join('\n');

export const DRAFT_SYSTEM = `You draft forum/issue replies for the maintainer of ibanforge.com (IBAN/BIC validation API). The reader must experience a peer solving their problem, never a vendor.

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
9. If the operator notes say "no product mention" (or the thread is not a problem the API solves), produce pure expertise with zero product mention and no disclosure line.

Return STRICT JSON, nothing else:
{"draft": "<the reply in the thread's language>", "summary_fr": "<2-3 French sentences for the operator: what the thread asks, and the angle of this reply>"}`;

export interface DraftInput {
  title: string;
  excerpt: string;
  url: string;
  lang: string;
  source: string;
  notes: string;
}

export interface GeneratedDraft {
  draft: string;
  summaryFr: string;
}

/** Walk to the balanced closing brace so a chatty preamble cannot break parsing. */
export function extractJson(text: string): { draft?: unknown; summary_fr?: unknown } | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === '{') depth++;
    if (ch === '}') depth--;
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

/** Defensive: the dash ban is prompt-enforced, this catches any slip. */
export function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ');
}

export function buildUserPrompt(t: DraftInput): string {
  return [
    `Platform: ${t.source}`,
    `Thread URL: ${t.url || '(none)'}`,
    `lang: ${t.lang}`,
    `Title: ${t.title}`,
    t.excerpt ? `Thread excerpt:\n${t.excerpt}` : 'Thread excerpt: (none, judge from the title)',
    t.notes ? `Operator notes (private context, never quote them): ${t.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One Anthropic call, one draft. Throws on any failure; the radar catches per
 * thread so a single bad generation never aborts the tick. Returns null only
 * when no API key is configured (the caller then skips generation entirely).
 */
export async function generateDraft(t: DraftInput): Promise<GeneratedDraft | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) return null;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
      system: DRAFT_SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(t) }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${detail.slice(0, 120)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).map((c) => c.text ?? '').join('');
  const parsed = extractJson(text);
  if (!parsed || typeof parsed.draft !== 'string' || typeof parsed.summary_fr !== 'string') {
    throw new Error(`generation returned no parseable JSON (${text.slice(0, 80)})`);
  }
  return { draft: stripDashes(parsed.draft.trim()), summaryFr: stripDashes(parsed.summary_fr.trim()) };
}
