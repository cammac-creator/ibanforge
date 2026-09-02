import { Hono } from 'hono';
import { getBicDB } from '../lib/db.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';

/**
 * GET /v1/test-iban — test IBANs whose bank codes are REAL.
 *
 * The "test IBAN generator" space is saturated with tools that emit
 * checksum-valid IBANs carrying arbitrary bank codes — the exact trap the
 * 2026-08-06 blog post documents (three of the four official example IBANs
 * point at unallocated codes). This endpoint is the honest version: the bank
 * code is drawn from the national register we serve, the account digits are
 * random, and the proof is not hand-written — each generated IBAN is run
 * through our own validation engine and the answer ships alongside.
 *
 * Free, rate-limited like every other route. The bank codes are public data
 * (the registers publish them); the account numbers are random and are NOT
 * real accounts — the response says so on every item.
 */

const testIban = new Hono();

const COUNTRIES = ['CH', 'DE', 'AT', 'BE'] as const;
type Country = (typeof COUNTRIES)[number];

const NOTE =
  'Structurally valid test IBAN with a REAL, register-allocated bank code. The account digits are random — this is NOT a real account. Safe for demos, fixtures and integration tests.';

function randDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** ISO 13616 check digits for `cc` + BBAN. */
function ibanCheckDigits(cc: string, bban: string): string {
  const rearranged = bban + cc + '00';
  let rem = 0n;
  for (const ch of rearranged) {
    const v = parseInt(ch, 36).toString();
    for (const d of v) rem = (rem * 10n + BigInt(d)) % 97n;
  }
  return String(98n - rem).padStart(2, '0');
}

function pickBankCode(country: Country): string | null {
  const db = getBicDB();
  if (country === 'DE') {
    const row = db
      .prepare(
        'SELECT blz FROM de_blz WHERE retired = 0 OR retired IS NULL ORDER BY RANDOM() LIMIT 1',
      )
      .get() as { blz: string } | undefined;
    return row?.blz ?? null;
  }
  if (country === 'CH') {
    // Ordinary IIDs only: QR-IIDs (30000-31999) are a separate number range
    // with their own semantics, wrong for a generic test IBAN.
    const row = db
      .prepare(
        'SELECT iid FROM ch_clearing WHERE CAST(iid AS INTEGER) < 30000 ORDER BY RANDOM() LIMIT 1',
      )
      .get() as { iid: string } | undefined;
    return row ? row.iid.padStart(5, '0') : null;
  }
  const row = db
    .prepare('SELECT code FROM national_bank_codes WHERE country = ? ORDER BY RANDOM() LIMIT 1')
    .get(country) as { code: string } | undefined;
  return row?.code ?? null;
}

function buildIban(country: Country, bankCode: string): string {
  let bban: string;
  switch (country) {
    case 'DE': // 8!n BLZ + 10!n account
      bban = bankCode + randDigits(10);
      break;
    case 'AT': // 5!n code + 11!n account
      bban = bankCode + randDigits(11);
      break;
    case 'CH': // 5!n IID + 12!c account (random digits are a valid subset)
      bban = bankCode + randDigits(12);
      break;
    case 'BE': {
      // 3!n code + 7!n account + 2!n national check = (code+account) mod 97, 0 → 97
      const account = randDigits(7);
      const national = Number(BigInt(bankCode + account) % 97n) || 97;
      bban = bankCode + account + String(national).padStart(2, '0');
      break;
    }
  }
  return country + ibanCheckDigits(country, bban) + bban;
}

function generateOne(country: Country): Record<string, unknown> | null {
  // The proof is our own engine's answer, not a hand-written claim. If the
  // dataset shifted under us (register refresh mid-flight), try a few codes
  // rather than shipping an IBAN whose own proof disagrees.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = pickBankCode(country);
    if (!code) return null;
    const iban = buildIban(country, code);
    const result = validateIBAN(iban);
    enrichResult(result);
    const check = (result as unknown as { bank_code_check?: { status?: string } }).bank_code_check;
    if (result.valid && check?.status === 'verified') {
      return {
        iban,
        formatted: iban.replace(/(.{4})/g, '$1 ').trim(),
        country,
        proof: {
          bank_code_check: check,
          bic: (result as unknown as { bic?: unknown }).bic ?? null,
        },
        note: NOTE,
      };
    }
  }
  return null;
}

testIban.get('/v1/test-iban', (c) => {
  const countryParam = (c.req.query('country') ?? '').toUpperCase();
  const countParam = Number(c.req.query('count') ?? '1');

  if (countryParam && !COUNTRIES.includes(countryParam as Country)) {
    return c.json(
      {
        error: 'unsupported_country',
        message: `Supported: ${COUNTRIES.join(', ')} — the countries whose national register we can vouch for. More as registers allow.`,
      },
      400,
    );
  }
  const count =
    Number.isInteger(countParam) && countParam >= 1 && countParam <= 10 ? countParam : 1;

  const items = [];
  for (let i = 0; i < count; i++) {
    const country =
      (countryParam as Country) || COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    const item = generateOne(country);
    if (item) items.push(item);
  }
  if (items.length === 0) {
    return c.json(
      {
        error: 'generation_failed',
        message: 'Could not generate against the current register data. Try again.',
      },
      503,
    );
  }
  return c.json({
    test_ibans: items,
    disclaimer:
      'Bank codes are real (drawn from the national registers we serve); account digits are random and belong to nobody. Do not send money to these.',
    docs: 'https://ibanforge.com/tools/test-iban',
    cost_usdc: 0,
  });
});

export { testIban };
