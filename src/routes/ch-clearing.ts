/**
 * IBANforge — Swiss BC-Nummer Clearing Lookup Route
 *
 * GET /v1/ch/clearing/:iid
 * Cost: 0.003 USDC (same as BIC lookup)
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import {
  lookupClearingByBankCode,
  normalizeIid,
} from '../lib/ch-clearing.js';
import { recordOperation } from '../lib/stats.js';
import { computeRevenue } from '../lib/request-helpers.js';
import type { ChClearingLookupResult } from '../types.js';

const COST_USDC = 0.003;

const chClearing = new Hono<HonoEnv>();

chClearing.get('/v1/ch/clearing/:iid', (c) => {
  const start = performance.now();
  const rawIid = c.req.param('iid');

  if (rawIid === '{iid}' || /^\{.*\}$/.test(rawIid)) {
    return c.json(
      {
        error: 'placeholder_literal',
        message: "You sent the literal OpenAPI placeholder '" + rawIid + "'. Substitute it with a real Swiss IID.",
        example: 'GET /v1/ch/clearing/230',
        schema: 'https://api.ibanforge.com/openapi.json',
      },
      400,
    );
  }

  // Validate format (1-5 digits)
  if (!/^\d{1,5}$/.test(rawIid)) {
    return c.json(
      {
        error: 'invalid_iid_format',
        message: 'IID must be a 1-5 digit number.',
      },
      400,
    );
  }

  const normalizedIid = normalizeIid(rawIid);

  // Use lookupClearingByBankCode to follow redirects
  const entry = lookupClearingByBankCode(normalizedIid);
  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  const revenue = computeRevenue(c, COST_USDC);

  if (!entry) {
    recordOperation('ch_clearing_lookup', 'CH', false, revenue, normalizedIid);

    const result: ChClearingLookupResult = {
      iid: normalizedIid,
      found: false,
      error: 'clearing_not_found',
      message: `IID ${normalizedIid} not found in Swiss BankMaster database.`,
      cost_usdc: c.get('apiKeyAuthenticated') ? 0 : COST_USDC,
      processing_ms: processingMs,
    };
    return c.json(result);
  }

  recordOperation('ch_clearing_lookup', entry.address.country, true, revenue);

  const result: ChClearingLookupResult = {
    iid: entry.iid,
    found: true,
    institution: {
      name: entry.name,
      type: entry.institution_type,
      iid_type: entry.iid_type,
      headquarters_iid: entry.headquarters_iid,
    },
    address: entry.address,
    bic: entry.bic,
    payment_services: entry.payment_services,
    sic_iid: entry.sic_iid,
    qr_iid: entry.qr_iid,
    valid_on: entry.valid_on,
    cost_usdc: c.get('apiKeyAuthenticated') ? 0 : COST_USDC,
    processing_ms: processingMs,
  };

  // QR-IID lookups (range 30000–31999): `iid` above already carries the
  // institution's standard IID and `qr_iid` the queried QR-IID — flag it and
  // say so, an agent should not have to know the SIX range convention.
  if (entry.is_qr_iid) {
    result.is_qr_iid = true;
    result.note = `IID ${entry.qr_iid} is a QR-IID (QR-bill range 30000–31999) of ${entry.name}; the institution's standard IID is ${entry.iid}.`;
  }

  // Add redirect info if applicable
  if (entry.redirected_from) {
    result.redirected_from = entry.redirected_from;
    result.note = `IID ${entry.redirected_from} has been merged into IID ${entry.iid}.`;
  }

  return c.json(result);
});

export { chClearing };
