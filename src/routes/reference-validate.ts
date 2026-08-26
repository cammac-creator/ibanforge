import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../types.js';
import { recordOperation } from '../lib/stats.js';
import { validatePaymentReference } from '../lib/payment-reference.js';

/**
 * GET|POST /v1/reference/validate — FREE structured payment reference check.
 *
 * Why this exists, and why it is free: these checksums are commodities. The
 * algorithms are published, and open-source libraries implement them. Charging
 * for arithmetic anyone can run would be a line item to defend rather than a
 * product. What IS ours is the PAIRING verdict — whether a reference may legally
 * travel with a given account — and that lives in the paid POST
 * /v1/iban/validate, where it costs nothing extra to a caller already paying.
 *
 * No payment, no API key, no quota. Rate-limited via the global middleware.
 *
 * The middleware needs no entry for this route: `enrich402Middleware` matches an
 * explicit allowlist of paid paths, and the x402 middleware asks its own paywall
 * whether the path requires payment. A path in neither table falls straight
 * through, which is exactly how /v1/iban/format already works.
 *
 * Spec sources: one primary, dated document per scheme — see
 * REFERENCE_SOURCES in lib/payment-reference.ts. Every answer that names a
 * scheme carries its source, on every call.
 */
const referenceValidate = new Hono<HonoEnv>();

const inputSchema = z.object({
  reference: z
    .string()
    .min(4, 'Reference must be at least 4 characters')
    .max(64, 'Reference must be at most 64 characters'),
  reference_type: z.string().max(20).optional(),
});

const USAGE = {
  example: 'GET /v1/reference/validate?reference=RF18539007547034',
  schemes:
    'RF (ISO 11649 / SCOR), Swiss QR reference (QRR), Belgian OGM/VCS, Finnish viitenumero. Norwegian KID and Swedish OCR are recognised but answer valid: null — their rules are set per creditor account by the beneficiary bank.',
  pairing_verdict:
    'POST /v1/iban/validate ($0.005) with a `reference` field adds reference_check.pairing — whether a QRR or ISO 11649 reference may legally travel with that IBAN under the Swiss Payment Standards.',
} as const;

/** Shared by the GET and the POST: one code path, one contract. */
function handle(
  c: Context<HonoEnv>,
  raw: { reference?: unknown; reference_type?: unknown },
) {
  if (raw.reference === undefined || raw.reference === null || raw.reference === '') {
    return c.json(
      {
        error: 'missing_reference',
        message: 'Pass ?reference=... as a query parameter, or {"reference": "..."} as a JSON body.',
        ...USAGE,
      },
      400,
    );
  }

  const parsed = inputSchema.safeParse({
    reference: typeof raw.reference === 'string' ? raw.reference : String(raw.reference),
    ...(typeof raw.reference_type === 'string' ? { reference_type: raw.reference_type } : {}),
  });

  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_reference',
        message: parsed.error.issues[0]?.message ?? 'Invalid reference.',
        ...USAGE,
      },
      400,
    );
  }

  const result = validatePaymentReference(parsed.data.reference, parsed.data.reference_type);

  // Free endpoint, so revenue is 0. The scheme rides in the country slot: these
  // references are national conventions, and knowing WHICH one is asked about is
  // the only useful dimension this endpoint has.
  try {
    recordOperation(
      'reference_validate',
      result.scheme,
      result.valid === true,
      0,
      result.scheme === null ? 'unrecognised' : undefined,
      c.get('apiKeyPrefix'),
    );
  } catch {
    // stats failure must not break the response
  }

  return c.json({
    reference: result.reference,
    scheme: result.scheme,
    valid: result.valid,
    status: result.status,
    ...(result.check_digit_expected !== undefined
      ? { check_digit_expected: result.check_digit_expected }
      : {}),
    ...(result.also_valid_as ? { also_valid_as: result.also_valid_as } : {}),
    source: result.source,
    ...(result.as_of ? { as_of: result.as_of } : {}),
    note: result.note,
    pairing_verdict: USAGE.pairing_verdict,
  });
}

referenceValidate.get('/v1/reference/validate', (c) =>
  handle(c, {
    reference: c.req.query('reference'),
    reference_type: c.req.query('reference_type') ?? c.req.query('type'),
  }),
);

referenceValidate.post('/v1/reference/validate', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.', ...USAGE },
      400,
    );
  }
  return handle(c, { reference: body.reference, reference_type: body.reference_type ?? body.type });
});

export { referenceValidate };
