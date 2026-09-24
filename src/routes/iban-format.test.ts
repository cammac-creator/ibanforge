import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { EXAMPLE_IBANS, IBAN_LENGTHS } from 'iban-core';
import { ibanFormat } from './iban-format.js';

function buildApp() {
  const app = new Hono();
  app.route('/', ibanFormat);
  return app;
}

describe('GET /v1/iban/format (free, no payment)', () => {
  it('validates a correct Swiss IBAN and returns 200 without cost_usdc', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300762011623852957');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect((body.country as { code: string }).code).toBe('CH');
    expect(body.formatted).toBe('CH93 0076 2011 6238 5295 7');
    expect(body.cost_usdc).toBeUndefined();
    expect(body.upgrade_to_full_validation).toContain('/v1/iban/validate');
  });

  it('answers the same verdict to a POST with a JSON body, so the paid call shape works without a key', async () => {
    const app = buildApp();
    const res = await app.request('/v1/iban/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'CH93 0076 2011 6238 5295 7' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      valid: boolean;
      country: { code: string };
      bban: { bank_code: string };
      cost_usdc?: unknown;
    };
    expect(body.valid).toBe(true);
    expect(body.country.code).toBe('CH');
    expect(body.bban.bank_code).toBe('00762');
    expect(body.cost_usdc).toBeUndefined();
  });

  it('rejects a wrong-checksum IBAN with valid: false and a clear error code', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300762011623852958');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.error).toBe('checksum_failed');
  });

  it('rejects an unknown country code', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=ZZ9300762011623852957');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect(body.error).toBe('unsupported_country');
  });

  it('returns 400 with helpful error when iban query param is missing', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format');
    expect(r.status).toBe(400);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.error).toBe('missing_iban');
    expect(body.example).toContain('CH9300762011623852957');
  });

  it('returns 400 when iban is too short', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300');
    expect(r.status).toBe(400);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_iban_length');
  });

  it('accepts spaces in the IBAN (cleans them transparently)', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH93%200076%202011%206238%205295%207');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.iban).toBe('CH9300762011623852957');
  });

  it('exposes the upgrade hint on every response (success and failure)', async () => {
    const app = buildApp();
    for (const iban of ['CH9300762011623852957', 'CH9300762011623852958']) {
      const r = await app.request(`/v1/iban/format?iban=${iban}`);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.upgrade_to_full_validation).toContain('$0.005');
    }
  });
});

/**
 * The printed form of an IBAN is longer than the IBAN.
 *
 * Until 24/09/2026 the route measured the length BEFORE removing the spaces, so
 * a valid IBAN written in groups of four, as on an invoice, was refused with
 * 400 `invalid_iban_length` as soon as its printed form passed 34 characters:
 * 13 countries of 89, Malta among them, a SEPA country. The paid route never had
 * this defect (it measures nothing before the library normalises). The list is
 * computed from the library's own lengths, so a country added tomorrow is
 * covered without anyone remembering.
 */
describe('/v1/iban/format measures the IBAN, not its printed form', () => {
  const grouped = (iban: string) => iban.replace(/(.{4})(?=.)/g, '$1 ');
  const printedTooLong = Object.keys(IBAN_LENGTHS)
    .filter((cc) => grouped('X'.repeat(IBAN_LENGTHS[cc]!)).length > 34)
    .sort();

  it('names the countries whose printed IBAN passes 34 characters', () => {
    expect(printedTooLong).toEqual([
      'BR',
      'EG',
      'JO',
      'KW',
      'LC',
      'MT',
      'MU',
      'PS',
      'QA',
      'RU',
      'SC',
      'UA',
      'YE',
    ]);
  });

  it.each(printedTooLong)(
    'accepts the official %s example written in groups of four (GET and POST)',
    async (cc) => {
      const app = buildApp();
      const example = EXAMPLE_IBANS[cc]!;
      const printed = grouped(example);
      expect(printed.length).toBeGreaterThan(34);

      const get = await app.request(`/v1/iban/format?iban=${encodeURIComponent(printed)}`);
      expect(get.status).toBe(200);
      const getBody = (await get.json()) as { valid: boolean; iban: string };
      expect(getBody.valid).toBe(true);
      expect(getBody.iban).toBe(example);

      const post = await app.request('/v1/iban/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iban: printed }),
      });
      expect(post.status).toBe(200);
      expect(((await post.json()) as { valid: boolean }).valid).toBe(true);
    },
  );

  it('accepts the Maltese example with hyphens between the groups', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: 'MT84-MALT-0110-0001-2345-MTLC-AST0-01S' }),
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { valid: boolean }).valid).toBe(true);
  });

  it('still refuses more than 34 characters once the separators are gone', async () => {
    const app = buildApp();
    const r = await app.request(`/v1/iban/format?iban=${'A'.repeat(35)}`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('invalid_iban_length');
  });

  it('still refuses fewer than 15 characters once the separators are gone', async () => {
    const app = buildApp();
    const r = await app.request(`/v1/iban/format?iban=${encodeURIComponent('CH93 0076 20')}`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('invalid_iban_length');
  });

  it('refuses a raw value longer than the library reads, separators or not', async () => {
    const app = buildApp();
    const padded = 'CH93' + ' '.repeat(70) + '00762011623852957';
    const r = await app.request('/v1/iban/format', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: padded }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_iban_length');
    // The raw cap names itself: "at most 34" would be false for this IBAN,
    // which is 21 characters once the spaces are gone.
    expect(body.message).toMatch(/64 characters as sent/);
  });
});

describe('/v1/iban/format says what valid means', () => {
  it('tells the caller that valid is the written form only, and where the bank code is judged', async () => {
    const app = buildApp();
    const r = await app.request('/v1/iban/format?iban=CH9300762011623852957');
    const body = (await r.json()) as { upgrade_to_full_validation: string };
    expect(body.upgrade_to_full_validation).toMatch(/well[- ]formed|written/i);
    expect(body.upgrade_to_full_validation).toMatch(/allocated/);
    expect(body.upgrade_to_full_validation).toContain('/v1/iban/validate');
  });
});

/**
 * The QR-IBAN page shows a real answer of this route. Until 24/09/2026 its
 * `upgrade_to_full_validation` line was the old hint, sanctions included, days
 * after the route stopped saying it: held equal to what the route serves.
 */
describe('/v1/iban/format, as the documentation shows it', () => {
  it.each(['en', 'fr', 'de'])(
    'swiss-qr-iban (%s) quotes the hint the route serves',
    async (lang) => {
      const app = buildApp();
      const r = await app.request('/v1/iban/format?iban=CH5530024123000889012');
      const { upgrade_to_full_validation: served } = (await r.json()) as {
        upgrade_to_full_validation: string;
      };
      const page = readFileSync(
        join(
          import.meta.dirname,
          '..',
          '..',
          'frontend',
          'content',
          lang,
          'docs',
          'swiss-qr-iban.mdx',
        ),
        'utf8',
      );
      const lines = page
        .split('\n')
        .filter((l) => l.trim().startsWith('"upgrade_to_full_validation":'));
      expect(lines).toEqual([`  "upgrade_to_full_validation": ${JSON.stringify(served)}`]);
    },
  );
});
