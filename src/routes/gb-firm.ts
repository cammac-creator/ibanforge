/**
 * IBANforge — UK firm lookup in the FCA Financial Services Register
 *
 * GET /v1/gb/firm/:frn
 * Cost: 0.003 USDC (same as the BIC and Swiss clearing lookups)
 *
 * One request = one firm, served from the FCA's Register API under its written
 * permission of 07/09/2026 and its four conditions — see src/lib/fca-register.ts
 * for where each condition is kept. This route adds the pricing, the stats and
 * the answer shape; it holds no register vocabulary of its own.
 *
 * ## Why a miss is a 200
 *
 * Aligned on `GET /v1/bic/:code`: an FRN the register does not hold answers
 * `found: false` with the same credit, date and disclaimer as a hit, and is
 * charged like one. A 404 would be refunded by the API-key middleware and
 * never settled by x402, which would make every miss free — and a free miss
 * is what turns a per-firm lookup into a scanner of the FRN space at the
 * register's expense, the one thing the permission forbids in spirit. The
 * miss is cached for a day like a hit, so a retry costs the register nothing.
 *
 * ## Why `not_configured` is answered before any credential is read
 *
 * `fcaConfiguredGuard()` is mounted in src/app.ts BEFORE the API-key
 * middleware. A deployment without the register credential answers 503 to
 * everyone, key or not, and no quota, credit or payment is touched — the
 * middleware refunds 4xx only, by policy, so a 503 raised after it would have
 * billed a key for a route that cannot serve.
 */

import { Hono, type MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { attachAttribution } from '../lib/attribution.js';
import { classifyFrnInput } from '../lib/input-normalize.js';
import { recordOperation, recordRejection } from '../lib/stats.js';
import { recordSafely } from '../lib/record-safely.js';
import { computeRevenue } from '../lib/request-helpers.js';
import {
  FCA_DISCLAIMER,
  FCA_SOURCE,
  FcaRegisterError,
  firmRegisterUrl,
  isFcaRegisterConfigured,
  lookupFirm,
  type FcaFirm,
} from '../lib/fca-register.js';

export const GB_FIRM_COST_USDC = 0.003;

export const NOT_CONFIGURED_MESSAGE =
  'The FCA Financial Services Register lookup is not enabled on this deployment: no Register API ' +
  'credential is configured. Nothing was charged.';

/**
 * The answer, hit or miss. Everything the register publishes on the firm
 * resource, plus the four things the permission asks for on every answer: the
 * source, the retrieval date, the register as the record that prevails, and
 * no claim of endorsement.
 */
export type GbFirmPayload = {
  frn: string;
  found: boolean;
  source: typeof FCA_SOURCE;
  /** The firm's own page on the public register (a search by FRN). */
  source_url: string;
  /** When the register was asked, ISO 8601 UTC. */
  retrieved_at: string;
  cache: {
    hit: boolean;
    /** True when the register was down and an expired copy was served. */
    stale: boolean;
    expires_at: string;
  };
  disclaimer: string;
  note?: string;
  cost_usdc: number;
  processing_ms: number;
} & Partial<Omit<FcaFirm, 'frn'>>;

/**
 * 503 for everyone while the deployment holds no credential. Mounted BEFORE
 * the API-key middleware (src/app.ts), so it costs nobody anything.
 */
export function fcaConfiguredGuard(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    if (isFcaRegisterConfigured()) {
      await next();
      return;
    }
    return c.json({ error: 'not_configured', message: NOT_CONFIGURED_MESSAGE }, 503);
  };
}

const gbFirm = new Hono<HonoEnv>();

gbFirm.get('/v1/gb/firm/:frn', async (c) => {
  const start = performance.now();
  const frn = c.req.param('frn');

  // Same mutual exclusion as the BIC and IID routes: in the mounted app the
  // guard of src/middleware/identifier-guard.ts answers first and carries the
  // same counting; alone, the route does it itself. Never both.
  const rejection = classifyFrnInput(frn);
  if (rejection === 'placeholder_literal') {
    recordRejection('gb_firm_lookup', rejection, c.get('apiKeyPrefix'));
    return c.json(
      {
        error: 'placeholder_literal',
        message:
          "You sent the literal OpenAPI placeholder '" +
          frn +
          "'. Substitute it with a real Firm Reference Number.",
        example: 'GET /v1/gb/firm/123456',
        schema: 'https://api.ibanforge.com/openapi.json',
      },
      400,
    );
  }
  if (rejection !== null) {
    recordRejection('gb_firm_lookup', rejection, c.get('apiKeyPrefix'));
    return c.json(
      { error: 'invalid_frn_format', message: 'A Firm Reference Number is 6 or 7 digits.' },
      400,
    );
  }

  // Defensive twin of fcaConfiguredGuard(), for a route mounted without it.
  if (!isFcaRegisterConfigured()) {
    return c.json({ error: 'not_configured', message: NOT_CONFIGURED_MESSAGE }, 503);
  }

  const keyPrefix = c.get('apiKeyPrefix');
  try {
    const reading = await lookupFirm(frn);
    const found = reading.lookup.found;
    const revenue = computeRevenue(c, GB_FIRM_COST_USDC);
    recordSafely(
      () =>
        recordOperation(
          'gb_firm_lookup',
          'GB',
          found,
          revenue,
          found ? undefined : 'not_found',
          keyPrefix,
        ),
      'gb_firm_lookup',
    );

    const base: Pick<
      GbFirmPayload,
      | 'source'
      | 'source_url'
      | 'retrieved_at'
      | 'cache'
      | 'disclaimer'
      | 'cost_usdc'
      | 'processing_ms'
    > = {
      source: FCA_SOURCE,
      source_url: firmRegisterUrl(frn),
      retrieved_at: reading.retrieved_at,
      cache: { ...reading.cache, expires_at: reading.expires_at },
      disclaimer: FCA_DISCLAIMER,
      cost_usdc: c.get('apiKeyAuthenticated') ? 0 : GB_FIRM_COST_USDC,
      processing_ms: Math.round((performance.now() - start) * 100) / 100,
    };
    const result: GbFirmPayload = reading.lookup.found
      ? { ...reading.lookup.firm, found: true, ...base }
      : {
          frn,
          found: false,
          note:
            'No firm carries this reference number in the Financial Services Register at the time ' +
            'of retrieval. An absent FRN is not a finding about anyone: check the number, then the ' +
            'register itself.',
          ...base,
        };
    return c.json(attachAttribution(c, result));
  } catch (err) {
    const failure = err instanceof FcaRegisterError ? err : new FcaRegisterError(502, 'failed');
    recordSafely(
      () => recordOperation('gb_firm_lookup', 'GB', false, 0, failure.reason, keyPrefix),
      'gb_firm_lookup',
    );
    if (failure.reason === 'bad_request') {
      // The register itself would not take the number: the caller's problem,
      // said as such, and refunded like every 4xx.
      return c.json(
        {
          error: 'invalid_frn',
          message: 'The Financial Services Register did not accept this reference number.',
        },
        400,
      );
    }
    if (failure.reason === 'refused') {
      // Our credential, not the caller's request. Loud in the log, opaque to
      // the caller: the key is ours to fix.
      console.error(
        '[fca-register] credential refused by the register (status %d)',
        failure.status,
      );
    }
    return c.json(
      {
        error: 'upstream',
        message:
          'The Financial Services Register did not answer and no recent copy of this entry is held. ' +
          'Retry later; the register at register.fca.org.uk remains the record.',
        upstream_status: failure.status,
        reason: failure.reason === 'refused' ? 'credential_refused' : failure.reason,
      },
      502,
    );
  }
});

export { gbFirm };
