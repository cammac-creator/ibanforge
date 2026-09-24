/**
 * Ce que le paquet publié dit de l'accès gratuit, lu là où un agent le lit : les
 * instructions de connexion, `tools/list`, les notes et indices des réponses,
 * et le README que npm affiche.
 *
 * 24/09/2026 : le paquet disait encore l'essai sans clé « quotidien » alors
 * qu'il était passé à la semaine, et « 60% cheaper » pour le lot alors que ce
 * rabais n'existe qu'en USDC par x402 (sur une clé, un IBAN du lot coûte un
 * crédit, comme une validation seule). Un paquet publié est figé jusqu'à la
 * publication suivante, et les quotas du service bougent : la règle est donc
 * de n'écrire AUCUN chiffre de quota ici et de renvoyer à `rate-limits.yml` et
 * à `GET /v1`. Ce test la tient sur le paquet construit, pas sur sa source :
 * le paragraphe d'accès des instructions partagées (copie de
 * `src/mcp/instructions.ts`, chiffres compris) n'est remplacé qu'au moment
 * d'être servi, par `stdioInstructions`.
 */
import { readFileSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const RATE_LIMITS = 'https://api.ibanforge.com/.well-known/rate-limits.yml';
const IBAN = 'DE89370400440532013000';

/**
 * Un quota compté au jour, dit en mots. « daily list » (la liste quotidienne de
 * la BCE) et « today » au sens de « à ce jour » dans les schémas sont justes :
 * ils sont retirés nommément avant la lecture, et seulement eux.
 */
const DAILY = /\bdaily\b|\bper day\b|\ba day\b|\/day\b|\btoday\b|\bmidnight\b/i;
const TRUE_DAILY = [
  'Banco de Espana daily list',
  '(today DE, AT, BE and BG)',
  '(today the EBA PSD2 register)',
];

/** Un chiffre de quota écrit à la main, sous les formes que le paquet a connues. */
const QUOTA_FIGURES = [
  /\b\d[\d,]*\s*(?:REST |tool |free |full )*(?:calls?|requests?|validations?)\b/i,
  /\b\d[\d,]*\s*(?:calls?|requests?)?\s*\/\s*(?:IP\/)?(?:day|week|month)\b/i,
  /\b\d[\d,]*\s*(?:a|per|every) (?:day|week|month)\b/i,
  /\b(?:reaches|gives) \d[\d,]*\b/i,
];

const PRICE_CLAIMS = /\d+\s*%\s*(?:cheaper|lower|off)|cheaper than/i;

/**
 * La période d'un quota, même sans chiffre : l'essai est passé du jour à la
 * semaine, l'accès MCP sans clé le même soir, et « a monthly allowance » aurait
 * figé la clé de la même façon. Lue seulement dans une phrase qui parle
 * d'allocation : « refreshed monthly » (la fraîcheur d'une source) est juste.
 * `monthly_limit`, nom d'un champ de l'API, ne forme pas un mot entier.
 */
const QUOTA_SENTENCE = /allowance|quota|\blimit\b|trial|free[ -]tier|\bcalls?\b|\brequests?\b|\bcredits?\b/i;
const PERIOD =
  /\b(?:daily|weekly|monthly|hourly)\b|\b(?:per|a|every|each|this) (?:day|week|month|hour)\b|\/(?:day|week|month|hour)\b/i;

function periodSentences(text: string): string[] {
  return withoutTrueDaily(text)
    .split(/(?<=[.!?;])\s+|\n/)
    .filter((sentence) => QUOTA_SENTENCE.test(sentence) && PERIOD.test(sentence));
}

function withoutTrueDaily(text: string): string {
  return TRUE_DAILY.reduce((t, phrase) => t.split(phrase).join(''), text);
}

function offences(label: string, text: string): string[] {
  const found: string[] = [];
  const daily = withoutTrueDaily(text).match(DAILY);
  if (daily) found.push(`${label} : « ${daily[0]} »`);
  for (const pattern of QUOTA_FIGURES) {
    const m = text.match(pattern);
    if (m) found.push(`${label} : chiffre de quota « ${m[0]} »`);
  }
  const price = text.match(PRICE_CLAIMS);
  if (price) found.push(`${label} : « ${price[0]} »`);
  for (const sentence of periodSentences(text))
    found.push(`${label} : période de quota « ${sentence.slice(0, 140)} »`);
  return found;
}

/** Tout 402 sans cause ; le format gratuit répond, comme en production. */
const handler: RequestListener = (req, res) => {
  if (req.url?.startsWith('/v1/iban/format')) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ iban: IBAN, valid: true, country: { code: 'DE', name: 'Germany' } }),
    );
    return;
  }
  res.writeHead(402, { 'content-type': 'application/json' }).end('{"error":"payment_required"}');
};

let api: ReturnType<typeof createServer>;
let client: Client;

beforeAll(async () => {
  api = createServer(handler);
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const { port } = api.address() as { port: number };
  client = new Client({ name: 'texte-publie', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      env: { IBANFORGE_API_BASE: `http://127.0.0.1:${port}/`, IBANFORGE_API_KEY: '' },
      stderr: 'pipe',
    }),
  );
}, 30_000);

afterAll(async () => {
  await client?.close();
  api?.closeAllConnections();
  await new Promise<void>((resolve) => api?.close(() => resolve()));
});

function payload(result: { content: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('le paquet publié ne fige aucun quota', () => {
  it('les instructions de connexion : ni jour, ni chiffre, et le renvoi aux chiffres servis', () => {
    const text = client.getInstructions() ?? '';
    expect(offences('instructions', text)).toEqual([]);
    expect(text).toContain(RATE_LIMITS);
    expect(text).toContain('GET https://api.ibanforge.com/v1');
    // La consigne sur l'adresse survit à la réécriture du paragraphe d'accès.
    expect(text).toContain('never send an address your human has not handed you for this purpose');
    expect(text).toContain('request_api_key then poll_api_key');
  });

  it('chaque outil de tools/list, schémas compris', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const found = tools.flatMap((tool) => offences(tool.name, JSON.stringify(tool)));
    expect(found, found.join('\n')).toEqual([]);
  });

  it('aucune phrase de positionnement retirée (PR 231) dans tools/list', async () => {
    // 25/09/2026 : les descriptions des outils de donnée suivent celles du
    // transport HTTP ; scripts/mcp-parity.test.ts compare la source, ceci le
    // texte réellement servi par le paquet construit.
    const { tools } = await client.listTools();
    const served = JSON.stringify(tools);
    for (const retired of [
      /DEEPEST SWISS CLEARING/i,
      /\b38k\+/i,
      /bank sanctions \(OFAC\)/i,
      /a European IBAN/i,
      /from the GLEIF database/i,
    ]) {
      expect(served).not.toMatch(retired);
    }
    expect(served).toContain('EVERY IID OF THE SIX BANKMASTER');
    expect(served).toContain("matched on the payee's bank (BIC8)");
  });

  it('le lot dit son prix vrai : le rabais est celui de x402, un crédit par IBAN sur une clé', async () => {
    const { tools } = await client.listTools();
    const batch = tools.find((t) => t.name === 'batch_validate_iban')?.description ?? '';
    expect(batch).toContain('via x402');
    expect(batch).toContain('one request or one credit');
  });

  it('les descriptions du device grant disent l’allocation gratuite sans jour', async () => {
    const { tools } = await client.listTools();
    const descriptionOf = (name: string) => tools.find((t) => t.name === name)?.description ?? '';
    expect(descriptionOf('request_api_key')).toContain(
      'This tool is free and does NOT count against the free allowance — it works even after the allowance is spent.',
    );
    expect(descriptionOf('request_api_key')).toContain('USE WHEN: you used up the free allowance');
    expect(descriptionOf('poll_api_key')).toContain(
      'This tool is free and does NOT count against the free allowance.',
    );
  });

  it('la note du résultat dégradé et l’indice du 402', async () => {
    const single = await client.callTool({ name: 'validate_iban', arguments: { iban: IBAN } });
    const note = String(payload(single)._note ?? '');
    expect(note).toContain('Anonymous mode');
    expect(offences('_note', note)).toEqual([]);
    expect(note).toContain(RATE_LIMITS);

    const batch = await client.callTool({
      name: 'batch_validate_iban',
      arguments: { ibans: [IBAN, IBAN] },
    });
    expect(batch.isError).toBe(true);
    const hint = String(payload(batch)._hint ?? '');
    expect(offences('_hint', hint)).toEqual([]);
    expect(hint).toContain(RATE_LIMITS);
  });

  it('le README affiché par npm', () => {
    expect(offences('README', README)).toEqual([]);
    expect(README).toContain(RATE_LIMITS);
    expect(README).toContain('https://api.ibanforge.com/v1');
  });
});

describe('les motifs eux-mêmes', () => {
  it.each([
    'an ifk_ key worth 25 REST calls/month',
    'lifts that same key to 200 REST calls/month',
    'Free tier: 10 tool calls/IP/day here',
    'Free tier: 25 tool calls a week per source address here',
    'returns an ifk_ key worth 25 requests a month on every endpoint',
    'the same key reaches 200 a month',
    'gives 200 calls/month',
    'The mailed code gives 200 every month; a payment gives 200 once.',
    'an anonymous key normally has 25 calls/month, an email-claimed key 200/month',
  ])('attrape un chiffre de quota : %s', (line) => {
    expect(QUOTA_FIGURES.some((p) => p.test(line))).toBe(true);
  });

  it.each([
    'Validate up to 100 IBANs in a single call.',
    'a 6-digit code mailed to an address',
    '0.002 USDC per IBAN (e.g. 10 IBANs = 0.02, 100 IBANs = 0.20)',
    'Requests time out after 30 seconds',
    '121k+ BIC entries',
    'Validation in 89 countries',
  ])('laisse passer un autre nombre : %s', (line) => {
    expect(QUOTA_FIGURES.some((p) => p.test(line))).toBe(false);
  });

  it.each([
    "`validate_iban` goes through the REST API's daily keyless trial",
    'each answer says how many calls remain today',
    'does NOT count against the daily free-tier limit',
    'you hit the daily free allowance',
  ])('attrape le jour : %s', (line) => {
    expect(DAILY.test(withoutTrueDaily(line))).toBe(true);
  });

  it.each([
    'returns an ifk_ key with a monthly allowance on every endpoint.',
    'Both tools are free and keep working after the daily limit is reached.',
    'The remote service has its own allowance, counted by the week (per week and per address).',
    'The mailed code raises the allowance every month; a payment raises it once.',
  ])('attrape la période d’un quota : %s', (line) => {
    expect(periodSentences(line)).not.toEqual([]);
  });

  it.each([
    'GLEIF and the national registers are refreshed monthly.',
    'the ECB or Banco de Espana daily list.',
    'read `monthly_limit`, since a temporary protection can reduce it.',
    'raises the allowance, renewed with each new period.',
  ])('laisse passer une période qui n’est pas un quota : %s', (line) => {
    expect(periodSentences(line)).toEqual([]);
  });

  it('attrape « 60% cheaper »', () => {
    expect(PRICE_CLAIMS.test('(60% cheaper than calling validate_iban repeatedly at $0.005)')).toBe(true);
  });
});
