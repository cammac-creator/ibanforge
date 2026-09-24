import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';
import { REST_TRIAL_DAILY_LIMIT } from '../lib/trial.js';
import { MCP_DAILY_LIMIT } from '../lib/mcp-limits.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';

/**
 * The free doors, said so they cannot be confused.
 *
 * Two allowances share a number today and have nothing else in common: the
 * keyless trial (a DAY, POST /v1/iban/validate only) and the key that needs no
 * e-mail (a MONTH, every endpoint). Side by side in one sentence ("past 25 a
 * day, take the key: 25 a month") they read as "the key is worse than no key",
 * and the second ChatGPT exchange of 24/09/2026 showed our own README doing it.
 * The rule: never the two in one sentence; name each door; announce the key by
 * what it reaches once claimed.
 *
 * The same day, DeepSeek opened one page of the API live, the MCP server card,
 * and found nothing on free access. The card now carries it, read from the
 * constants.
 *
 * Deliberately out of scope: TRIAL_FREE_KEY_HINT (src/lib/trial.ts), the hint
 * served inside the `trial` block, which opposes the two figures on purpose
 * and is pinned elsewhere; it belongs to a change of the response itself.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const DAY = String(REST_TRIAL_DAILY_LIMIT);
const MONTH = String(ANONYMOUS_MONTHLY_LIMIT);

/** The figure as a bare number: not 0.25, not 250, not 25k, not 2,500. */
const bare = (n: string): RegExp =>
  new RegExp(String.raw`(?<![.,\d$€])${n}(?![.,]?\d)(?![kK])`, 'g');

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 0);
}

/** Does this sentence put the day allowance and the month allowance side by side? */
function collides(sentence: string): boolean {
  // A sentence that puts the monthly figure against the daily one by reference
  // ("not a day", "the two figures above ... share a number") collides just
  // the same with a single bare number in it (review of 24/09/2026).
  const refersToDay =
    /not a day|figures above|share a number|pas un jour|pas par jour|nicht pro Tag|kein Tag/i;
  if (
    (sentence.match(bare(MONTH)) ?? []).length >= 1 &&
    /month|mois|Monat/i.test(sentence) &&
    refersToDay.test(sentence)
  )
    return true;
  const d = (sentence.match(bare(DAY)) ?? []).length;
  if (DAY === MONTH) return d >= 2;
  const m = (sentence.match(bare(MONTH)) ?? []).length;
  return d >= 1 && m >= 1 && /\bday|jour|Tag/i.test(sentence) && /month|mois|Monat/i.test(sentence);
}

function offenders(name: string, text: string): string[] {
  return sentences(text)
    .filter(collides)
    .map((s) => `${name}: ${s.trim().slice(0, 160)}`);
}

/** Every value of a messages file, one per line: the whole site, not one page. */
function messagesText(lang: 'en' | 'fr' | 'de'): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(JSON.parse(read(`frontend/messages/${lang}.json`)));
  return out.join('\n');
}

const STATIC = [
  'README.md',
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'frontend/components/json-ld.tsx',
  'glama.json',
];

const app = buildApp();
afterAll(() => closeAll());

async function get(path: string): Promise<string> {
  const res = await app.request(`https://api.ibanforge.com${path}`);
  expect(res.status, path).toBe(200);
  return res.text();
}

describe('the daily trial and the monthly key never share a sentence', () => {
  it.each(STATIC)('%s', (rel) => {
    const found = offenders(rel, read(rel));
    expect(found, found.join('\n')).toEqual([]);
  });

  it.each(['en', 'fr', 'de'] as const)('every text of the site (%s)', (lang) => {
    const found = offenders(`messages ${lang}`, messagesText(lang));
    expect(found, found.join('\n')).toEqual([]);
  });

  it('the llms.txt the API serves', async () => {
    const found = offenders('/llms.txt', await get('/llms.txt'));
    expect(found, found.join('\n')).toEqual([]);
  });

  it('the MCP server card', async () => {
    const card = JSON.parse(await get('/.well-known/mcp/server-card.json')) as {
      description: string;
      free_access?: string;
      tools: Array<{ description: string }>;
    };
    const text = [
      card.description,
      card.free_access ?? '',
      ...card.tools.map((t) => t.description),
    ];
    const found = offenders('server-card', text.join('\n'));
    expect(found, found.join('\n')).toEqual([]);
  });

  it('the OpenAPI overview and the validation route', async () => {
    const spec = JSON.parse(await get('/openapi.json')) as {
      info: { description: string };
      paths: Record<string, { post?: { description?: string } }>;
    };
    const text = [
      spec.info.description,
      spec.paths['/v1/iban/validate']?.post?.description ?? '',
    ].join('\n');
    const found = offenders('openapi', text);
    expect(found, found.join('\n')).toEqual([]);
  });

  it.each([
    'These 25 are a day, on this route only; the key’s 25 are a month.',
    'Past 25/day, add the free key (25 req/month with no e-mail, 200 once claimed).',
  ])('catches the collision it exists for: %s', (sentence) => {
    expect(collides(sentence)).toBe(DAY === MONTH);
  });

  it('catches the collision made by reference to the daily figure', () => {
    expect(
      collides(
        '- 25 requests a MONTH, on every endpoint, not a day: the two figures above and this one happen to share a number',
      ),
    ).toBe(true);
  });

  it.each([
    'No key at all: up to 25 validations a day.',
    'Credit packs: 1k = $4, 5k = $20, 25k = $80.',
    'Standard: $63/month for 60,000 requests a year, 25 requests/second.',
  ])('lets a single figure through: %s', (sentence) => {
    expect(collides(sentence)).toBe(false);
  });
});

describe('the MCP server card says how to start for free', () => {
  it('names each door with the figure the code applies', async () => {
    const card = JSON.parse(await get('/.well-known/mcp/server-card.json')) as {
      free_access?: string;
    };
    const text = card.free_access ?? '';
    expect(text).toContain(`${REST_TRIAL_DAILY_LIMIT} IBAN validations a day`);
    expect(text).toContain(`${MCP_DAILY_LIMIT} full tool calls a day per IP`);
    expect(text).toContain(`${FREE_TIER_MONTHLY_LIMIT} requests a month once claimed`);
    expect(text).toContain(`starts at ${ANONYMOUS_MONTHLY_LIMIT} requests a month`);
    expect(text).toContain('POST /v1/keys/generate with an empty body');
  });
});

describe('the README Python example is the call the SDK accepts', () => {
  it('creates the key with no e-mail, and the SDK takes no argument', () => {
    const readme = read('README.md');
    expect(readme).toContain('IBANforge.generate_api_key()');
    expect(readme).not.toMatch(/generate_api_key\("[^"]*@/);
    // The published signature: the address is optional, so the empty call is valid.
    expect(read('sdks/python/ibanforge/client.py')).toMatch(
      /def generate_api_key\(\s*email: Optional\[str\] = None,/,
    );
  });
});
