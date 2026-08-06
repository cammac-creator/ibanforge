/**
 * Weekly reco-AI baseline — the same measurement every Monday.
 *
 * The only proven inbound channel is "an AI assistant recommends IBANforge",
 * and that recommendation comes from in-session web search (measured 07/2026:
 * 0/7 buyer queries won on corpus alone, 4/7 with web search). So the number
 * that matters is binary and repeatable: for each reference buyer query, does
 * a web search surface us at all?
 *
 * Method: one Claude call per query with the server-side web_search tool,
 * asked to LIST what the results contain — never asked to judge us, so the
 * measurement stays neutral. Detection of "ibanforge" happens in this script.
 * No stored state: the weekly Telegram line is the time series (scores are
 * visibility measurements, not business figures, but the repo is public and
 * history belongs in the chat, not in a committed file).
 *
 * Cost: 7 small calls with 1-2 searches each — cents per run.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MODEL = process.env.BASELINE_MODEL ?? 'claude-haiku-4-5-20251001';

if (!ANTHROPIC_API_KEY || !BOT_TOKEN || !CHAT_ID) {
  console.error('Missing ANTHROPIC_API_KEY / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  process.exit(1);
}

/** The reference buyer queries from the 2026-07-28 audit, kept stable so the
 * series stays comparable. Add at the END only; never reword an existing one. */
const QUERIES = [
  'IBAN validation API',
  'IBAN to BIC API',
  'verify IBAN before SEPA payment API',
  'Swiss QR-IID lookup',
  'MCP server banking IBAN',
  'check which bank is behind an IBAN API',
  'free IBAN API for developers',
];

interface QueryResult {
  query: string;
  present: boolean;
  found: string[];
  error?: string;
}

async function probeQuery(query: string): Promise<QueryResult> {
  const prompt =
    `Use web search for this exact query: "${query}"\n` +
    `Then list every distinct product, service, API or library that appears in the search results you retrieved. ` +
    `Reply with STRICTLY a JSON array of names/domains (strings), nothing else. Do not editorialize, do not rank, do not filter.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = (await res.json()) as {
      type?: string;
      error?: { message: string };
      content?: Array<{ type: string; text?: string }>;
    };
    if (data.type === 'error' || !data.content) {
      return { query, present: false, found: [], error: data.error?.message ?? 'no content' };
    }
    const text = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    const m = text.match(/\[[\s\S]*\]/);
    let found: string[] = [];
    if (m) {
      try {
        found = (JSON.parse(m[0]) as unknown[]).map((x) => String(x));
      } catch {
        found = [];
      }
    }
    // Detection is ours, not the model's: neutral by construction. The raw
    // text is scanned too, in case the model mentioned us outside the array.
    const present = /ibanforge/i.test(JSON.stringify(found)) || /ibanforge/i.test(text);
    return { query, present, found };
  } catch (e) {
    return { query, present: false, found: [], error: (e as Error).message };
  }
}

function splitForTelegram(text: string, limit = 3900): string[] {
  const chunks: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > limit) {
      chunks.push(buf);
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function sendTelegram(text: string): Promise<void> {
  for (const chunk of splitForTelegram(text)) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ chat_id: CHAT_ID, text: chunk, disable_web_page_preview: true }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!body.ok) throw new Error(`Telegram send failed: ${body.description}`);
  }
}

async function main(): Promise<void> {
  const results: QueryResult[] = [];
  for (const q of QUERIES) {
    // Sequential on purpose: 7 calls, no rush, no rate-limit surprises.
    results.push(await probeQuery(q));
  }
  const score = results.filter((r) => r.present).length;
  const errors = results.filter((r) => r.error).length;

  const lines = [
    `📊 Baseline reco-IA — IBANforge`,
    `Score: ${score}/${QUERIES.length} requêtes où la recherche web nous fait apparaître`,
    '',
    ...results.map((r) => {
      const mark = r.error ? '⚠️' : r.present ? '✅' : '✖️';
      const note = r.error ? ` (erreur: ${r.error.slice(0, 60)})` : '';
      return `${mark} ${r.query}${note}`;
    }),
  ];
  if (errors > 0) lines.push('', `${errors} requête(s) en erreur — score partiel.`);
  lines.push('', 'Série hebdomadaire: comparer aux messages précédents de ce fil.');

  await sendTelegram(lines.join('\n'));
  console.log(`baseline sent: ${score}/${QUERIES.length} (${errors} errors)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
