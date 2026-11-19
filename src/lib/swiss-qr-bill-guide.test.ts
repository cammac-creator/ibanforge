import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { chQrBill } from '../routes/ch-qr-bill.js';
import { closeAll } from './db.js';
import { checkSwissQrBill, type QrFinding } from './swiss-qr-bill.js';

/**
 * The page /tools/qr-bill quotes what this check returns (frontend/messages,
 * `qrBillGuide`, and frontend/lib/qr-bill-examples.ts). Both are READ here, as
 * text, never imported: a file of frontend/ does not import from outside
 * frontend/, and the reverse keeps the site image free of the API. A quoted
 * `detail` that the tool no longer returns, or a sample that drifts from the
 * route, fails here.
 */
const FRONTEND = join(import.meta.dirname, '..', '..', 'frontend');
const LANGS = ['en', 'fr', 'de'] as const;

type Row = { rule: string; mistake: string; code: string; detail: string };
const guideRows = (lang: string): Row[] => {
  const messages = JSON.parse(readFileSync(join(FRONTEND, 'messages', `${lang}.json`), 'utf8'));
  return Object.values(messages.qrBillGuide.rules.items) as Row[];
};

/** An invented QR-bill, one line per entry of the payload. */
const GOOD = [
  'SPC',
  '0200',
  '1',
  'CH4431999123000889012',
  'S',
  'Robert Schneider AG',
  'Rue du Lac',
  '1268',
  '2501',
  'Biel',
  'CH',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '1949.75',
  'CHF',
  'S',
  'Pia Rutschmann',
  'Marktgasse',
  '28',
  '9400',
  'Rorschach',
  'CH',
  'QRR',
  '210000000003139471430009017',
  'Order 15.06.2026',
  'EPD',
];
const variant = (changes: Record<number, string>) => {
  const lines = [...GOOD];
  for (const [i, v] of Object.entries(changes)) lines[Number(i)] = v;
  return lines.join('\n');
};
const ORDINARY_IBAN = 'CH9300762011623852957';

/** One payload per row of the table of the page, in the order of the rows. */
const PAYLOADS = [
  variant({ 0: 'QRCH' }),
  variant({ 3: 'DE89370400440532013000' }),
  variant({ 3: ORDINARY_IBAN }),
  variant({ 27: 'SCOR', 28: 'RF18539007547034' }),
  variant({ 28: '210000000003139471430009018' }),
  variant({ 3: ORDINARY_IBAN, 27: 'NON', 28: 'x' }),
  variant({ 9: '' }),
  variant({ 4: 'K', 6: 'Rue du Lac 12', 7: '2501 Biel', 8: '', 9: '', 10: 'CH' }),
  variant({ 18: '1949,75' }),
  variant({ 19: 'USD' }),
  variant({ 19: 'EUR' }),
  variant({ 5: 'A'.repeat(71) }),
  variant({ 5: 'Robert Schneider AG'.replace('o', 'ö') }),
  variant({ 30: 'END' }),
  variant({ 8: '9999', 9: 'Biel' }),
];

/** What the page quotes, cut at its "[...]" marks: each piece must be a piece of a real detail. */
const pieces = (detail: string) =>
  detail
    .split('[...]')
    .map((p) => p.trim())
    .filter(Boolean);

describe('the table of /tools/qr-bill quotes what the check really returns', () => {
  it('has one invented payload per row of the table', () => {
    for (const lang of LANGS) expect(guideRows(lang)).toHaveLength(PAYLOADS.length);
  });

  it.each(LANGS)(
    'every quoted detail (%s) is a real detail, under a code the row names',
    (lang) => {
      guideRows(lang).forEach((row, i) => {
        const findings: QrFinding[] = checkSwissQrBill(PAYLOADS[i]!).findings;
        const quoted = pieces(row.detail);
        expect(quoted.length, `row ${i}: nothing quoted`).toBeGreaterThan(0);
        const owner = findings.find((f) => quoted.every((p) => f.detail.includes(p)));
        expect(owner, `row ${i}: no finding returns "${row.detail}"`).toBeDefined();
        const codes = row.code.split(',').map((c) => c.replace(/\(.*\)/, '').trim());
        expect(codes, `row ${i}: code ${owner!.code} is not named in the row`).toContain(
          owner!.code,
        );
      });
    },
  );
});

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** `expected` is an abridged copy of `actual`: every key it names must match; a "..." key stands for what was cut. */
function expectSubset(expected: Json, actual: Json, path = '$'): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as Json[]).length, `${path} length`).toBe(expected.length);
    expected.forEach((e, i) => expectSubset(e, (actual as Json[])[i]!, `${path}[${i}]`));
  } else if (expected !== null && typeof expected === 'object') {
    const a = actual as { [k: string]: Json };
    for (const [k, v] of Object.entries(expected)) {
      if (k === '...') continue;
      expect(a, `${path}.${k} missing`).toHaveProperty(k);
      expectSubset(v, a[k]!, `${path}.${k}`);
    }
  } else {
    expect(actual, path).toBe(expected);
  }
}

/** The value of `export const NAME = \`…\`` in the samples file, template literal evaluated. */
function sample(name: string): string {
  const source = readFileSync(join(FRONTEND, 'lib', 'qr-bill-examples.ts'), 'utf8');
  const m = new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`).exec(source);
  expect(m, `${name} not found`).not.toBeNull();
  return new Function(`return \`${m![1]}\``)() as string;
}

/**
 * The API's own example (USAGE.example in src/routes/ch-qr-bill.ts) writes its line breaks as the
 * two characters backslash and n, because the note of its answer asks for real line breaks
 * written that way in JSON: unescaped, it is the payload.
 */
const unescaped = (payload: string) => payload.replaceAll(String.raw`\n`, '\n');

const app = new Hono();
app.route('/', chQrBill);
const post = (payload: string) =>
  app.request('/v1/ch/qr-bill/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload }),
  });

afterAll(() => closeAll());

describe('the code samples of /tools/qr-bill are what the route answers', () => {
  it('the request is the example the API returns on an invalid request', async () => {
    const invalid = await app.request('/v1/ch/qr-bill/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const usage = (await invalid.json()) as { example: { payload: string } };
    const body = /-d '(\{.*\})'/.exec(sample('REQUEST_EXAMPLE'));
    expect(body).not.toBeNull();
    expect(JSON.parse(body![1]!).payload).toBe(unescaped(usage.example.payload));
  });

  it('the response shown is the route output on that example', async () => {
    const invalid = await app.request('/v1/ch/qr-bill/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const usage = (await invalid.json()) as { example: { payload: string } };
    const res = await post(unescaped(usage.example.payload));
    expect(res.status).toBe(200);
    expectSubset(JSON.parse(sample('RESPONSE_EXAMPLE')), (await res.json()) as Json);
  });

  it('the combined-address variant is the route output on that payload typed K', async () => {
    const res = await post(
      variant({ 4: 'K', 6: 'Rue du Lac 12', 7: '2501 Biel', 8: '', 9: '', 10: 'CH' }),
    );
    expectSubset(JSON.parse(sample('COMBINED_EXAMPLE')), (await res.json()) as Json);
  });
});
