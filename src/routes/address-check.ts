import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../types.js';
import {
  ADDRESS_SCHEMES,
  CBPR_NOTE,
  checkPostalAddress,
  type AddressScheme,
  type AddressToCheck,
} from '../lib/address-conformity.js';

/**
 * POST /v1/address/check — FREE conformity check of an ALREADY STRUCTURED
 * ISO 20022 postal address.
 *
 * What it does: takes the `PostalAddress` elements you intend to send and tells
 * you, rule by rule and with the document each rule comes from, whether they
 * satisfy the scheme you name. Pure rule evaluation — it reads no database and
 * needs no data of ours, which is why it costs nothing.
 *
 * What it does NOT do, and will not pretend to: turn a free-text address into a
 * structured one. That is address parsing against national postal reference
 * data for 250 countries — the trade of Loqate, Smarty and Google Address
 * Validation. We hold no such reference data.
 *
 * And it does not answer "is this CBPR+ compliant?", because nobody honestly
 * can from public sources: see CBPR_NOTE, served on every response.
 */
const addressCheck = new Hono<HonoEnv>();

const addressSchema = z
  .object({
    twn_nm: z.string().max(200).optional(),
    ctry: z.string().max(10).optional(),
    pst_cd: z.string().max(50).optional(),
    strt_nm: z.string().max(200).optional(),
    bldg_nb: z.string().max(50).optional(),
    adr_tp: z.string().max(50).optional(),
    // Capped well above the 2 any scheme allows, on purpose: a caller sending 7
    // lines must get the `adr_line_max_2` finding that explains the problem, not
    // a 400 that only says the request was rejected.
    adr_line: z.array(z.string().max(500)).max(20).optional(),
  })
  .strict();

const bodySchema = z.object({
  scheme: z.string(),
  address: addressSchema,
});

const SCHEME_LIST = ADDRESS_SCHEMES.join(', ');

/** The refusal that IS the feature. Returned rather than a scheme we cannot source. */
function cbprRefusal(): {
  error: string;
  message: string;
  schemes: readonly AddressScheme[];
  note: string;
} {
  return {
    error: 'scheme_not_available',
    message:
      "The 'cbpr+' scheme is not implemented, and not because it was overlooked: its rules could not be read " +
      'from any public source. Pick one of the schemes whose rules are quoted from a document we actually ' +
      `fetched: ${SCHEME_LIST}.`,
    schemes: ADDRESS_SCHEMES,
    note: CBPR_NOTE,
  };
}

addressCheck.post('/v1/address/check', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
        expected: {
          scheme: SCHEME_LIST,
          address: 'object with any of twn_nm, ctry, pst_cd, strt_nm, bldg_nb, adr_tp, adr_line[]',
        },
        example: {
          scheme: 'sps',
          address: { strt_nm: 'Bahnhofstrasse', bldg_nb: '45', pst_cd: '8001', twn_nm: 'Zurich', ctry: 'CH' },
        },
      },
      400,
    );
  }

  // 'hvps+' is what the market writes, and 'HVPS Plus' is what documents write;
  // the served value stays 'hvps_plus' because a '+' in an enum is a
  // query-string trap waiting to happen.
  const requested = parsed.data.scheme
    .trim()
    .toLowerCase()
    .replace(/\+/g, '_plus')
    .replace(/[\s-]+/g, '_');

  // 'cbpr+', 'cbpr', 'CBPR Plus' all land here and get the reason, not a shrug.
  if (requested.startsWith('cbpr')) {
    return c.json(cbprRefusal(), 400);
  }

  const normalized = requested === 'hvps' ? 'hvps_plus' : requested;

  if (!(ADDRESS_SCHEMES as readonly string[]).includes(normalized)) {
    return c.json(
      {
        error: 'unknown_scheme',
        message: `Unknown scheme "${parsed.data.scheme}". Available: ${SCHEME_LIST}.`,
        schemes: ADDRESS_SCHEMES,
        note: CBPR_NOTE,
      },
      400,
    );
  }

  const address: AddressToCheck = parsed.data.address;
  return c.json(checkPostalAddress(normalized as AddressScheme, address));
});

export { addressCheck };
