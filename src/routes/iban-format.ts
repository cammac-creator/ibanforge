import { Hono, type Context } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import type { HonoEnv } from '../types.js';
import { recordOperation } from '../lib/stats.js';
import { recordSafely } from '../lib/record-safely.js';
import { codesOf, registerCountries } from '../lib/positioning.js';
import { REST_TRIAL_WEEKLY_LIMIT } from '../lib/trial.js';

/**
 * GET /v1/iban/format — FREE pure-format IBAN check.
 *
 * Why this exists: agents and devs need a way to pre-filter malformed IBANs
 * BEFORE paying for the full validate endpoint. This endpoint runs the same
 * mod-97 + structure check but does NOT touch the BIC, SEPA, VoP, sanctions,
 * or Swiss clearing databases. Output is intentionally minimal.
 *
 * No payment, no API key, no quota. Rate-limited via the global middleware.
 *
 * If you need the bank, its BIC, SEPA flags or the register verdict on the bank
 * code, use POST /v1/iban/validate (paid, $0.005, returns the full enrichment;
 * sanctions screening is POST /v1/iban/compliance, not this pair of routes).
 *
 * Spec source: ISO 13616 (mod 97, country-specific BBAN length).
 */
const ibanFormat = new Hono<HonoEnv>();

/**
 * The IBAN is measured once the separators are gone, never as typed.
 *
 * 🚨 Until 24/09/2026 the length was checked on the raw string, so an IBAN
 * written in groups of four, as it is printed on every invoice, was refused
 * with 400 `invalid_iban_length` as soon as its printed form passed 34
 * characters: 13 countries of 89, Malta among them. The rule below is the
 * library's own (`iban-core` strips whitespace and ASCII hyphens, then reads
 * letters in either case), so the two cannot disagree on what "the IBAN" is.
 *
 * The raw cap stays, at the library's own ceiling: past 64 characters it
 * refuses the input anyway, and a query string of any length should not reach
 * a regex.
 */
const SEPARATORS = /[\s-]/g;
const RAW_MAX = 64;
const TOO_SHORT = 'IBAN must be at least 15 characters, spaces and hyphens aside';
const TOO_LONG = 'IBAN must be at most 34 characters, spaces and hyphens aside';
// Its own sentence (review of 24/09/2026): an IBAN of 21 characters padded past
// 64 is refused by the raw cap, and "at most 34" would be false for it.
const TOO_LONG_RAW =
  'IBAN must be at most 64 characters as sent, and 34 once spaces and hyphens are removed';

/** Why the length rules the input out, or null when the library may judge it. */
function lengthProblem(raw: string): string | null {
  if (raw.length > RAW_MAX) return TOO_LONG_RAW;
  const compact = raw.replace(SEPARATORS, '');
  if (compact.length < 15) return TOO_SHORT;
  if (compact.length > 34) return TOO_LONG;
  return null;
}

/**
 * What `valid: true` means here, said on every answer of the route.
 *
 * An agent that reads `valid: true` on a format check and stops has been told
 * nothing about the bank: this route never opens a register. The hint says so,
 * names the countries where the paid route settles whether the bank code is
 * allocated at all (read from the code, not typed), and names the keyless
 * trial, the one free door this route is the neighbour of. Sanctions are not
 * in it: they are POST /v1/iban/compliance.
 */
let upgradeHint: string | undefined;
function upgradeToFullValidation(): string {
  upgradeHint ??=
    'valid: true here means the IBAN is well formed (length, structure, mod-97), nothing more. ' +
    `POST /v1/iban/validate ($0.005, or keyless for the first ${REST_TRIAL_WEEKLY_LIMIT} calls a week per source address) ` +
    'names the bank and its BIC with the source of that answer, SEPA and VoP readiness, and, ' +
    `where it reads the national register (${codesOf(registerCountries().authoritative)}), ` +
    'whether the bank code is allocated at all. ' +
    // 24/09/2026: this route is the one an assistant that can only send GET
    // reaches, and the sentence above led it to a POST it cannot send. The
    // demo is GET, free, and shows the full answer on fixed examples.
    'Real answers of that full validation, readable with a plain GET: https://api.ibanforge.com/v1/demo';
  return upgradeHint;
}

/**
 * The free structural check, in both shapes a developer reaches for: the GET
 * with a query string the docs have always shown, and a POST with the same
 * JSON body as the paid validate call. A keyless POST to /v1/iban/validate
 * answers 402 by design (that is the x402 paywall); this is the free door
 * next to it, and the 402 body points here (enrich-402.ts).
 */
async function readIban(c: Context<HonoEnv>): Promise<string | undefined> {
  if (c.req.method === 'POST') {
    const body = await c.req.json<{ iban?: unknown }>().catch(() => ({}) as { iban?: unknown });
    return typeof body.iban === 'string' ? body.iban : undefined;
  }
  return c.req.query('iban');
}

const formatHandler = async (c: Context<HonoEnv>) => {
  const ibanQuery = await readIban(c);

  if (!ibanQuery) {
    return c.json(
      {
        error: 'missing_iban',
        message: 'Pass ?iban=... as a query parameter, or POST a JSON body {"iban":"..."}.',
        example:
          'GET /v1/iban/format?iban=CH9300762011623852957 or POST /v1/iban/format {"iban":"CH93..."}',
        upgrade_to_full_validation: upgradeToFullValidation(),
      },
      400,
    );
  }

  const problem = lengthProblem(ibanQuery);
  if (problem) {
    return c.json(
      {
        error: 'invalid_iban_length',
        message: problem,
        upgrade_to_full_validation: upgradeToFullValidation(),
      },
      400,
    );
  }

  // The library receives the IBAN as it was sent: it applies the same
  // normalisation, and `result.iban` comes back compact and upper-case.
  const result = validateIBAN(ibanQuery);

  // Record stats — free endpoint, revenue is 0
  // Wrapped since 2026-09-01 (QUA-12): the swallow is unchanged, but the
  // failures are now counted and raise an ops alert past a streak, so a stats
  // DB that stops accepting writes cannot look like a service nobody calls.
  recordSafely(
    () =>
      recordOperation(
        'iban_format',
        result.valid ? (result.country?.code ?? null) : null,
        result.valid,
        0,
        result.error ?? undefined,
        c.get('apiKeyPrefix'),
      ),
    'iban_format',
  );

  if (!result.valid) {
    return c.json({
      iban: result.iban,
      valid: false,
      error: result.error,
      error_detail: result.error_detail,
      upgrade_to_full_validation: upgradeToFullValidation(),
    });
  }

  // Strip the cost_usdc field — this is the FREE endpoint, no money flow.
  return c.json({
    iban: result.iban,
    formatted: result.formatted,
    valid: true,
    country: result.country,
    check_digits: result.check_digits,
    bban: result.bban,
    upgrade_to_full_validation: upgradeToFullValidation(),
  });
};

ibanFormat.get('/v1/iban/format', formatHandler);
ibanFormat.post('/v1/iban/format', formatHandler);

export { ibanFormat };
