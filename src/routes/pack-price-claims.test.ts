import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';
import { buildRouteTable } from '../middleware/x402.js';
import { BUNDLES } from './api-keys.js';

/**
 * No served text may quote a pack price other than the one GET
 * /v1/credits/bundles serves.
 *
 * The 1,000-credit pack moved to $4 on 16/09/2026. A week later /llms.txt
 * still said "one $5 payment for 1,000 credits", the guide said "$5 covers
 * 1,000 validations" in three languages, and the 402 of the pack itself said
 * "same per-credit cost as retail (0.005 USDC)". An assistant quoted the $5
 * back as an inconsistency of ours, and it was one. The price itself is
 * Claude-Alain's decision and is not read here; what is held is that every
 * text quoting it agrees with the constant.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const PACK = BUNDLES['1k'];

/** Every way the served texts spell the price of the 1,000-credit pack. */
const PATTERNS: RegExp[] = [
  /one \$(\d+(?:\.\d+)?) payment for 1,000 credits/g,
  /\b1k\s*=\s*\$(\d+(?:\.\d+)?)/g,
  /\b1k\s*=\s*(\d+(?:,\d+)?)\s?\$/g,
  /1,000 (?:calls|credits) = \$(\d+(?:\.\d+)?)/g,
  /1,000 credits for \$(\d+(?:\.\d+)?)/g,
  /\$(\d+(?:\.\d+)?) covers 1,000/g,
  // The 429 message quoted in the docs: the price of the 1k pack, named by its route.
  /\$(\d+(?:\.\d+)?) per 1,000, POST \/v1\/credits\/buy\/1k/g,
  /\$(\d+(?:\.\d+)?) \/ 1,000 credits/g,
  /(\d+(?:,\d+)?) \$ \/ 1[ .]000 (?:crédits|Credits)/g,
  /(\d+(?:,\d+)?) \$ couvrent 1 000/g,
  /(\d+(?:,\d+)?) \$ decken 1\.000/g,
  /\$(\d+(?:\.\d+)?) for 1,000 calls/g,
];

/**
 * A FLOOR per 1,000 calls ("from $X per 1,000", "down to $X per 1,000") is
 * the cheapest pack's ratio, not the smallest pack's price: "from $4 per
 * 1,000 calls" was served while the 25,000 pack costs $3.20 per 1,000 (review
 * of 24/09/2026). A bare "$X per 1,000" is no longer read as the 1k price.
 */
const FLOOR = /(?:from|down to) \$(\d+(?:\.\d+)?) per 1,000\b/g;
const CHEAPEST_PER_1K = Math.min(
  ...Object.values(BUNDLES).map((b) => (b.price_usdc / b.credits) * 1000),
);

/**
 * Known debt, named rather than hidden: MCP_INSTRUCTIONS still says "from $4
 * per 1,000 calls", and it is compared character for character with its copy
 * in the npm package (src/mcp/instructions.test.ts), which only a release may
 * change. Remove the entry in the same change as that release.
 */
const FLOOR_DEBT = new Set(['src/mcp/instructions.ts']);

const docs = (lang: string): string[] =>
  readdirSync(join(ROOT, 'frontend', 'content', lang, 'docs'))
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => `frontend/content/${lang}/docs/${f}`);

/** The texts served as they are written: no code stands between them and a reader. */
const SURFACES = [
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'README.md',
  'src/mcp/instructions.ts',
  ...['en', 'fr', 'de'].map((lang) => `frontend/messages/${lang}.json`),
  ...['en', 'fr', 'de'].flatMap(docs),
];

function quotes(text: string): number[] {
  const found: number[] = [];
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) found.push(Number(m[1].replace(',', '.')));
  }
  return found;
}

afterAll(() => closeAll());

describe('the 1,000-credit pack is quoted at the price the API sells it', () => {
  it('in every static text that quotes it', () => {
    const wrong: string[] = [];
    let seen = 0;
    for (const rel of SURFACES) {
      for (const price of quotes(read(rel))) {
        seen += 1;
        if (price !== PACK.price_usdc) wrong.push(`${rel}: $${price}`);
      }
    }
    expect(wrong, `pack price other than $${PACK.price_usdc}:\n${wrong.join('\n')}`).toEqual([]);
    // A sweep that finds nothing proves nothing: the price is quoted on
    // several surfaces, and the day none of them matches, a pattern broke.
    expect(seen).toBeGreaterThan(5);
  });

  it('as a floor per 1,000 calls only at the cheapest pack ratio', async () => {
    const wrong: string[] = [];
    const served = [
      ['/llms.txt', await (await buildApp().request('https://api.ibanforge.com/llms.txt')).text()],
      [
        '/openapi.json',
        (
          (await (await buildApp().request('https://api.ibanforge.com/openapi.json')).json()) as {
            info: { description: string };
          }
        ).info.description,
      ],
    ] as const;
    const texts: Array<readonly [string, string]> = [
      ...served,
      ...SURFACES.filter((rel) => !FLOOR_DEBT.has(rel)).map((rel) => [rel, read(rel)] as const),
    ];
    let seen = 0;
    for (const [name, text] of texts) {
      for (const m of text.matchAll(FLOOR)) {
        seen += 1;
        if (Math.abs(Number(m[1]) - CHEAPEST_PER_1K) > 0.005) wrong.push(`${name}: ${m[0]}`);
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
    // The served llms.txt and the OpenAPI overview both state the floor.
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it('in the pricing cell of the comparison, in three languages', () => {
    for (const lang of ['en', 'fr', 'de']) {
      const cell = (
        JSON.parse(read(`frontend/messages/${lang}.json`)) as {
          compare: { table: { rows: { pricing: { ibanforge: string } } } };
        }
      ).compare.table.rows.pricing.ibanforge;
      const found = quotes(cell);
      expect(found, `${lang}: the pack price is no longer quoted in the cell`).toHaveLength(1);
      expect(found[0], lang).toBe(PACK.price_usdc);
    }
  });

  it('in the comparison example, 2 × 1k packs, in three languages', () => {
    // "$10 one-time (2 × 1k packs)" was the $5 pack, doubled, and survived the
    // price change like the rest of this file's findings.
    const twice = 2 * PACK.price_usdc;
    const spelled: Record<string, RegExp> = {
      en: /\$(\d+(?:\.\d+)?) one-time \(2 × 1k packs\)/,
      fr: /(\d+(?:,\d+)?) \$ une fois \(2 packs 1k\)/,
      de: /(\d+(?:,\d+)?) \$ einmalig \(2 × 1k-Packs\)/,
    };
    for (const [lang, pattern] of Object.entries(spelled)) {
      const m = read(`frontend/messages/${lang}.json`).match(pattern);
      expect(m, `${lang}: the 2 × 1k example was reworded`).not.toBeNull();
      expect(Number(m![1].replace(',', '.')), lang).toBe(twice);
    }
  });

  it('in the llms.txt the API serves', async () => {
    const res = await buildApp().request('https://api.ibanforge.com/llms.txt');
    const text = await res.text();
    expect(text).not.toMatch(/\$5 payment/);
    expect(text).toContain(`one $${PACK.price_usdc} payment for 1,000 credits`);
    for (const price of quotes(text)) expect(price).toBe(PACK.price_usdc);
  });

  it('in the 402 description of the pack itself', () => {
    const table = buildRouteTable(
      '0x0000000000000000000000000000000000000001',
      'POST',
      '/v1/credits/buy/1k',
    ) as Record<string, { description?: string; accepts?: { price?: unknown } }>;
    const entry = table['POST /v1/credits/buy/1k'];
    expect(entry?.description).toContain(`${PACK.price_usdc / PACK.credits} USDC per credit`);
    expect(entry?.description).not.toMatch(/Same per-credit cost as retail/);
    // The price the paywall charges, read back rather than restated.
    expect(entry?.accepts?.price).toBe(`$${PACK.price_usdc.toFixed(2)}`);
    // "cheaper than paying per call" was false for a BIC lookup and an x402
    // batch (review of 24/09/2026): the description compares route by route,
    // and each figure it quotes is the price that route's paywall charges.
    const priceOf = (key: string): string => {
      const route = buildRouteTable('0x0000000000000000000000000000000000000001', 'GET', '/')[
        key
      ] as { accepts?: { price?: unknown } } | undefined;
      return String(route?.accepts?.price ?? '').replace(/^\$/, '');
    };
    const d = entry?.description ?? '';
    expect(d).toContain(`validate (${priceOf('POST /v1/iban/validate')})`);
    expect(d).toContain(`compliance (${priceOf('POST /v1/iban/compliance')})`);
    expect(d).toContain(`BIC lookup (${priceOf('GET /v1/bic/:code')})`);
    expect(d).not.toMatch(/cheaper than paying per call/);
  });
});

/**
 * The batch rate is an x402 price. On a key, a credit pack or Pro, one IBAN in
 * a batch is one request or credit, so a static line quoting "$0.002" without
 * saying USDC or x402 lets a reader believe a batch costs half on every rail
 * (review of 24/09/2026).
 */
describe('the batch rate is said to be the x402 rate', () => {
  const BATCH_SURFACES = [
    'frontend/public/llms.txt',
    'frontend/public/llms-full.txt',
    'README.md',
    'glama.json',
    'frontend/public/.well-known/mcp.json',
  ];
  it.each(BATCH_SURFACES)('%s', (rel) => {
    const wrong = read(rel)
      .split('\n')
      .filter((line) => /\$0\.002\b/.test(line) && !/x402|USDC/.test(line));
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
