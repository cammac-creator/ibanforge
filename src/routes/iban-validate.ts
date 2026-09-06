import { attachAttribution } from '../lib/attribution.js';
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { recordOperation } from '../lib/stats.js';
import { recordSafely } from '../lib/record-safely.js';
import { getIban, getReference, getReferenceType, computeRevenue } from '../lib/request-helpers.js';
import { buildReferenceCheck } from '../lib/payment-reference.js';
import { TRIAL_DOCS_URL, TRIAL_FREE_KEY_HINT, TRIAL_RESET } from '../lib/trial.js';
import type { IBANValidationResult } from '../types.js';

const ibanValidate = new Hono<HonoEnv>();

ibanValidate.post('/v1/iban/validate', async (c) => {
  const start = performance.now();

  let body: Record<string, unknown> | null;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const iban = getIban(body);
  if (!iban || typeof iban !== 'string' || iban.trim() === '') {
    return c.json(
      {
        error: 'invalid_request',
        message:
          "Request body must include an 'iban' field (case-insensitive: 'iban', 'IBAN', 'Iban' all work).",
      },
      400,
    );
  }

  const result: IBANValidationResult = validateIBAN(iban);

  enrichResult(result);

  // Optional structured payment reference. Attached HERE and not inside
  // enrichResult: that path is shared with batch validation and with several MCP
  // tools whose output schemas do not name this block, and Zod would strip it
  // there without raising anything.
  //
  // The reference is judged even when the IBAN is invalid — the two answers are
  // independent, and a caller fixing a typo still wants to know their reference
  // is sound. Only the PAIRING needs a parsed BBAN, and it reports
  // `not_applicable` when there is none.
  const reference = getReference(body);
  if (typeof reference === 'string' && reference.trim() !== '') {
    // `pickField` casts with `as T` and validates nothing, so both fields need
    // a real typeof guard here — this body is unvalidated JSON, and a numeric
    // reference_type would otherwise reach String.prototype.trim and 500 a
    // route the caller has already paid for.
    const referenceType = getReferenceType(body);
    result.reference_check = buildReferenceCheck(
      result,
      reference,
      typeof referenceType === 'string' ? referenceType : null,
    );
  }

  const postedPrice = result.cost_usdc;
  // Nobody paid for this one: a key spent an allowance, or the keyless daily
  // trial did. Leaving the posted price on a trial response would read to the
  // caller as "you were just charged $0.005", which is the opposite of the
  // message the trial exists to send.
  const trial = c.get('anonymousTrial');
  if (c.get('apiKeyAuthenticated') || trial) {
    result.cost_usdc = 0;
  }

  // The invitation. Attached HERE and not in `enrichResult` for the reason
  // `reference_check` gives above: that path is shared with batch validation
  // and with MCP tools whose Zod output schemas would strip an unnamed block
  // without saying so. The trial is a single-IBAN, REST-only affair anyway.
  if (trial) {
    result.trial = {
      calls_used_today: trial.used,
      calls_left_today: trial.remaining,
      daily_limit: trial.limit,
      resets: TRIAL_RESET,
      free_key: TRIAL_FREE_KEY_HINT,
      docs: TRIAL_DOCS_URL,
    };
  }

  result.processing_ms = Math.round((performance.now() - start) * 100) / 100;

  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  const revenue = computeRevenue(c, postedPrice);
  // Wrapped since 2026-09-01 (QUA-12): the swallow is unchanged, but the
  // failures are now counted and raise an ops alert past a streak, so a stats
  // DB that stops accepting writes cannot look like a service nobody calls.
  recordSafely(
    () =>
      recordOperation(
        'iban_validate',
        result.country?.code ?? null,
        result.valid,
        revenue,
        errorDetail,
        c.get('apiKeyPrefix'),
      ),
    'iban_validate',
  );

  return c.json(attachAttribution(c, result));
});

export { ibanValidate };
