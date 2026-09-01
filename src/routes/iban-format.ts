import { Hono } from 'hono';
import { z } from 'zod';
import { validateIBAN } from '../lib/iban.js';
import type { HonoEnv } from '../types.js';
import { recordOperation } from '../lib/stats.js';
import { recordSafely } from '../lib/record-safely.js';

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
 * If you need bank name, sanctions, SEPA flags, etc., use POST /v1/iban/validate
 * (paid, $0.005, returns the full enrichment).
 *
 * Spec source: ISO 13616 (mod 97, country-specific BBAN length).
 */
const ibanFormat = new Hono<HonoEnv>();

const querySchema = z.object({
  iban: z
    .string()
    .min(15, 'IBAN must be at least 15 characters')
    .max(34, 'IBAN must be at most 34 characters'),
});

ibanFormat.get('/v1/iban/format', async (c) => {
  const ibanQuery = c.req.query('iban');

  if (!ibanQuery) {
    return c.json(
      {
        error: 'missing_iban',
        message: 'Pass ?iban=... as a query parameter.',
        example: 'GET /v1/iban/format?iban=CH9300762011623852957',
        upgrade_to_full_validation:
          'POST /v1/iban/validate ($0.005) — adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer.',
      },
      400,
    );
  }

  const parsed = querySchema.safeParse({ iban: ibanQuery });
  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_iban_length',
        message: parsed.error.issues[0]?.message ?? 'Invalid IBAN length.',
        upgrade_to_full_validation:
          'POST /v1/iban/validate ($0.005) — adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer.',
      },
      400,
    );
  }

  const result = validateIBAN(parsed.data.iban);

  // Record stats — free endpoint, revenue is 0
  // Wrapped since 2026-09-01 (QUA-12): the swallow is unchanged, but the
  // failures are now counted and raise an ops alert past a streak, so a stats
  // DB that stops accepting writes cannot look like a service nobody calls.
  recordSafely(
    () =>
      recordOperation(
        'iban_format',
        result.valid ? result.country?.code ?? null : null,
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
      upgrade_to_full_validation:
        'POST /v1/iban/validate ($0.005) — adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer.',
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
    upgrade_to_full_validation:
      'POST /v1/iban/validate ($0.005) — adds BIC, SEPA, VoP, sanctions, Swiss BC-Nummer.',
  });
});

export { ibanFormat };
