import type { MiddlewareHandler } from 'hono';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base';

// Per-route Bazaar discovery payload following the v1 recipe documented in
// the CDP Discord #x402 channel by @CyberSapper:
//   - outputSchema.input.body (NOT JSON Schema): example values the v1
//     facilitator's extractBodyInfo() reads to display the request shape
//   - outputSchema.input.bodyType: "json" for POST endpoints
//   - outputSchema.input.schema: optional JSON Schema kept alongside body for
//     x402scan strict validation
//   - outputSchema.output: BARE example object, NOT wrapped {type, example} —
//     v1's extractDiscoveryInfoV1 wraps the whole thing as example itself.
//
// Without this, the CDP Bazaar catalog rejects the discovery extension with
// EXTENSION-RESPONSES → {bazaar:{status:"rejected"}} and agentic.market never
// indexes the service. With this, indexing happens within ~1-2 hours of the
// next successful settlement.

interface BazaarDiscovery {
  inputBody?: Record<string, unknown>;
  inputPathParams?: Record<string, unknown>;
  inputQueryParams?: Record<string, unknown>;
  inputMethod: 'GET' | 'POST';
  bodyType?: 'json';
  inputJsonSchema?: Record<string, unknown>;
  outputExample: Record<string, unknown>;
}

const DISCOVERY: Array<{ match: (m: string, p: string) => boolean; data: BazaarDiscovery }> = [
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/validate',
    data: {
      inputMethod: 'POST',
      bodyType: 'json',
      inputBody: { iban: 'CH9300762011623852957' },
      inputJsonSchema: {
        type: 'object',
        required: ['iban'],
        properties: {
          iban: {
            type: 'string',
            description: 'IBAN to validate (spaces and lowercase accepted).',
            minLength: 15,
            maxLength: 34,
          },
        },
      },
      outputExample: {
        iban: 'CH9300762011623852957',
        formatted: 'CH93 0076 2011 6238 5295 7',
        valid: true,
        country: { code: 'CH', name: 'Switzerland' },
        check_digits: '93',
        bban: { bank_code: '00762', branch_code: '', account: '011623852957' },
        bic: { bic: 'UBSWCHZH80A', bankName: 'UBS Switzerland AG', city: 'Zurich', lei: 'BFM8T61CT2L1QCEMIK50' },
        issuer: { type: 'bank', name: 'UBS Switzerland AG' },
        sepa: { reachable: true, instant: true },
        vop: { participant: true },
        ch_clearing: { bc_nummer: '762', sic: true, qr_iid: true },
        risk_score: 5,
      },
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/batch',
    data: {
      inputMethod: 'POST',
      bodyType: 'json',
      inputBody: { ibans: ['CH9300762011623852957', 'DE89370400440532013000'] },
      inputJsonSchema: {
        type: 'object',
        required: ['ibans'],
        properties: {
          ibans: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 100,
            description: 'Array of 1 to 100 IBAN strings.',
          },
        },
      },
      outputExample: {
        results: [
          { iban: 'CH9300762011623852957', valid: true, country: { code: 'CH' } },
          { iban: 'DE89370400440532013000', valid: true, country: { code: 'DE' } },
        ],
        summary: { total: 2, valid: 2, invalid: 0 },
        cost_usdc: 0.004,
      },
    },
  },
  {
    match: (m, p) => m === 'GET' && /^\/v1\/bic\/[^/]+$/.test(p),
    data: {
      inputMethod: 'GET',
      inputPathParams: { code: 'UBSWCHZH80A' },
      outputExample: {
        bic: 'UBSWCHZH80A',
        bic8: 'UBSWCHZH',
        bic11: 'UBSWCHZH80A',
        found: true,
        valid_format: true,
        institution: 'UBS Switzerland AG',
        country: { code: 'CH', name: 'Switzerland' },
        city: 'Zurich',
        lei: 'BFM8T61CT2L1QCEMIK50',
        address: 'Bahnhofstrasse 45',
      },
    },
  },
  {
    match: (m, p) => m === 'GET' && /^\/v1\/ch\/clearing\/[^/]+$/.test(p),
    data: {
      inputMethod: 'GET',
      inputPathParams: { iid: '00762' },
      outputExample: {
        iid: '00762',
        found: true,
        institution: { name: 'UBS Switzerland AG (retail)', type: 'bank', iid_type: 'branch', headquarters_iid: '00230' },
        participation: { sic: true, eurosic: true, instant_payments: true, qr_iid: true },
        bic: 'UBSWCHZH80A',
      },
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/compliance',
    data: {
      inputMethod: 'POST',
      bodyType: 'json',
      inputBody: { iban: 'GB29NWBK60161331926819' },
      inputJsonSchema: {
        type: 'object',
        required: ['iban'],
        properties: {
          iban: { type: 'string', description: 'IBAN to triage.', minLength: 15, maxLength: 34 },
        },
      },
      outputExample: {
        iban: 'GB29NWBK60161331926819',
        valid: true,
        risk_score: 8,
        recommended_action: 'allow',
        sanctions: { bic_sanctioned: false, country_sanctioned: false, lists: [] },
        fatf: { list: 'none' },
        sepa: { reachable: true, instant: true },
        vop: { participant: true },
        flags: {},
      },
    },
  },
];

function findDiscovery(method: string, path: string): BazaarDiscovery | null {
  return DISCOVERY.find((d) => d.match(method, path))?.data ?? null;
}

function buildInputBlock(d: BazaarDiscovery): Record<string, unknown> {
  const block: Record<string, unknown> = {
    type: 'http',
    method: d.inputMethod,
    discoverable: true,
  };
  if (d.bodyType) block.bodyType = d.bodyType;
  if (d.inputBody) block.body = d.inputBody;
  if (d.inputPathParams) block.pathParams = d.inputPathParams;
  if (d.inputQueryParams) block.queryParams = d.inputQueryParams;
  if (d.inputJsonSchema) block.schema = d.inputJsonSchema;
  return block;
}

/**
 * Builds the v1-shape outputSchema that CDP's Bazaar catalog extractor
 * expects. Lives at the top of each accept entry, alongside scheme/network/
 * payTo/asset, NOT under extra or extensions.bazaar.
 */
function buildOutputSchema(d: BazaarDiscovery): { input: Record<string, unknown>; output: Record<string, unknown> } {
  return {
    input: buildInputBlock(d),
    // BARE example — extractDiscoveryInfoV1 wraps this as example itself.
    output: d.outputExample,
  };
}

interface EndpointPricing {
  match: (method: string, path: string) => boolean;
  price_usdc: number;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  outputExample?: Record<string, unknown>;
}

const PRICING: EndpointPricing[] = [
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/validate',
    price_usdc: 0.005,
    description:
      'Validate a single IBAN (ISO 13616 mod-97) and resolve BIC, country, EMI/vIBAN classification, SEPA + VoP flags, and Swiss BC-Nummer for CH/LI accounts.',
    inputSchema: {
      type: 'object',
      required: ['iban'],
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to validate (spaces allowed). Example: CH93 0076 2011 6238 5295 7',
          minLength: 15,
          maxLength: 34,
        },
      },
    },
    outputExample: {
      valid: true,
      iban: 'CH9300762011623852957',
      formatted: 'CH93 0076 2011 6238 5295 7',
      country: 'CH',
      countryName: 'Switzerland',
      checkDigits: '93',
      bban: '00762011623852957',
      bic: { bic: 'UBSWCHZH80A', bankName: 'UBS Switzerland AG', city: 'Zurich', lei: 'BFM8T61CT2L1QCEMIK50' },
      issuer: { type: 'bank', name: 'UBS Switzerland AG' },
      sepa: { reachable: true, instant: true },
      vop: { participant: true },
      ch_clearing: { bc_nummer: '762', sic: true, qr_iid: true },
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/batch',
    price_usdc: 0.2,
    description:
      'Batch validate up to 100 IBANs in one call. Returns per-IBAN validation, country, BIC and a summary.',
    inputSchema: {
      type: 'object',
      required: ['ibans'],
      properties: {
        ibans: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 100,
          description: 'Array of IBANs (max 100).',
        },
      },
    },
    outputExample: {
      results: [
        { valid: true, iban: 'CH9300762011623852957', country: 'CH', countryName: 'Switzerland' },
        { valid: true, iban: 'DE89370400440532013000', country: 'DE', countryName: 'Germany' },
      ],
      summary: { total: 2, valid: 2, invalid: 0 },
    },
  },
  {
    match: (m, p) => m === 'GET' && p.startsWith('/v1/bic/'),
    price_usdc: 0.003,
    description:
      'Lookup a BIC/SWIFT code against 121,399 BIC entries (38,761 LEI-enriched via GLEIF). Returns bank name, country, city, LEI and address.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: {
        code: {
          type: 'string',
          description: 'BIC/SWIFT code, 8 or 11 alphanumeric characters. Example: UBSWCHZH80A',
          pattern: '^[A-Z0-9]{8}([A-Z0-9]{3})?$',
        },
      },
    },
    outputExample: {
      found: true,
      bic: 'UBSWCHZH80A',
      bankName: 'UBS Switzerland AG',
      country: 'CH',
      countryName: 'Switzerland',
      city: 'Zurich',
      lei: 'BFM8T61CT2L1QCEMIK50',
      address: 'Bahnhofstrasse 45, 8001 Zurich',
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/compliance',
    price_usdc: 0.02,
    description:
      'Pre-payout screening for agents — vet a counterparty IBAN before you send funds: validation + sanctions screening (OFAC/EU/UN) + SEPA Instant reachability + VoP participant + risk score (0-100). Pre-flight triage, not a regulated AML product.',
    inputSchema: {
      type: 'object',
      required: ['iban'],
      properties: {
        iban: { type: 'string', description: 'IBAN to check' },
      },
    },
    outputExample: {
      iban: 'CH9300762011623852957',
      valid: true,
      sanctions: { matches: [], cleared: true, lists_checked: ['OFAC SDN', 'EU CFSP', 'UN consolidated'] },
      sepa: { reachable: true, instant: true },
      vop: { participant: true, last_seen: '2026-04-01' },
      risk_score: 4,
      risk_level: 'low',
    },
  },
  {
    match: (m, p) => m === 'GET' && p.startsWith('/v1/ch/clearing/'),
    price_usdc: 0.003,
    description:
      'Swiss BC-Nummer / IID clearing lookup against 1,190 SIX BankMaster entries. Returns institution name, type, SIC, euroSIC, Instant Payments and QR-IID participation.',
    inputSchema: {
      type: 'object',
      required: ['iid'],
      properties: {
        iid: {
          type: 'string',
          description: 'Swiss IID / BC-Nummer (1-5 digits). Example: 762',
          pattern: '^[0-9]{1,5}$',
        },
      },
    },
    outputExample: {
      found: true,
      iid: '762',
      bc_nummer: '762',
      institution: 'UBS Switzerland AG',
      type: 'bank',
      sic: true,
      euro_sic: true,
      instant: true,
      qr_iid: true,
    },
  },
];

function findPricing(method: string, path: string): EndpointPricing | undefined {
  return PRICING.find((p) => p.match(method, path));
}

interface AcceptEntry {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  asset?: string;
  extra?: Record<string, unknown>;
  outputSchema?: { input: Record<string, unknown>; output: Record<string, unknown> };
  [key: string]: unknown;
}

function injectOutputSchema(method: string, path: string, accept: AcceptEntry): AcceptEntry {
  const discovery = findDiscovery(method, path);
  if (!discovery) return accept;
  // Only inject if it's missing — never overwrite a more authoritative source.
  if (!accept.outputSchema) {
    accept.outputSchema = buildOutputSchema(discovery);
  }
  return accept;
}

/**
 * Human- and agent-readable access ramp shared by both 402 enrichment paths.
 * Lists the three ways to call a paid endpoint: a free API key, prepaid
 * credit packs (card or USDC), and pay-per-call x402. The machine `accepts`
 * array is built separately and never lives here.
 */
function buildAccessRamp(): Record<string, unknown> {
  return {
    message:
      'Authentication or payment required. Three ways in: a free API key ' +
      '(200 req/month), prepaid credit packs (card or USDC), or pay-per-call via x402.',
    free_tier: {
      description: '200 requests/month — no credit card, no subscription',
      signup: 'POST /v1/keys/generate with body {"email":"you@example.com"}',
      usage: 'Add header: Authorization: Bearer ifk_your_key_here',
    },
    credit_packs: {
      description: 'Prepaid credits — never expire, lower per-call cost than retail',
      pay_by_card: 'https://api.ibanforge.com/#pricing',
      pay_by_usdc: 'POST /v1/credits/buy/1k|5k|25k — list: GET /v1/credits/bundles',
      pricing: '1k = $5 · 5k = $20 (-20%) · 25k = $80 (-36%)',
    },
    x402: {
      description: 'Pay per call with USDC on Base L2 (machine-to-machine)',
      protocol_docs: 'https://x402.org',
      discovery: 'https://api.ibanforge.com/.well-known/x402',
      bazaar: 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources',
    },
    documentation: 'https://ibanforge.com/docs',
    llms: 'https://api.ibanforge.com/llms.txt',
  };
}

/**
 * Enriches HTTP 402 responses to be both machine-readable (x402 v0.1 spec compliant)
 * AND human-readable. Agents need the `accepts` array to automate payment;
 * humans need the message + free_tier instructions.
 *
 * Two paths:
 *   1. Body empty / {} → build a full 402 from pricing config (legacy fallback
 *      for routes that aren't gated by the @x402/hono middleware).
 *   2. Body has `accepts` from x402 middleware → patch each accept entry to
 *      add `outputSchema` (CyberSapper recipe) at the top level so the CDP
 *      Bazaar v1 catalog extractor indexes the service.
 */
export function enrich402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    if (c.res.status !== 402) return;

    const cloned = c.res.clone();
    const text = await cloned.text();

    const url = new URL(c.req.url);
    const method = c.req.method;
    const pricing = findPricing(method, url.pathname);
    const walletAddress = process.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000';

    // Path 2: existing 402 with an `accepts` body — patch accepts with
    // outputSchema AND add the human/agent access ramp around it.
    if (text && text.trim() !== '' && text.trim() !== '{}') {
      let parsed: { accepts?: AcceptEntry[]; [key: string]: unknown };
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // not JSON, leave alone
      }
      if (!Array.isArray(parsed.accepts) || parsed.accepts.length === 0) return;

      const patchedAccepts = parsed.accepts.map((a) =>
        injectOutputSchema(method, url.pathname, { ...a }),
      );

      // Spread `parsed` first to keep any field the x402 SDK produced
      // (x402Version, error, …); the ramp's fields then take precedence.
      // `accepts` is never part of buildAccessRamp() — reassigned explicitly
      // so the outputSchema injection stays intact.
      const enriched: Record<string, unknown> = {
        x402Version: 1,
        error: 'payment_required',
        ...parsed,
        ...buildAccessRamp(),
      };
      enriched.accepts = patchedAccepts;

      c.res = new Response(JSON.stringify(enriched, null, 2), {
        status: 402,
        headers: c.res.headers,
      });
      c.res.headers.set('Content-Type', 'application/json');
      return;
    }

    // Path 1: empty body — build full 402 (legacy fallback)
    const baseAccept: AcceptEntry = pricing
      ? {
          scheme: 'exact',
          network: NETWORK,
          maxAmountRequired: Math.round(pricing.price_usdc * 1_000_000).toString(),
          resource: `https://api.ibanforge.com${url.pathname}`,
          description: pricing.description,
          mimeType: 'application/json',
          payTo: walletAddress,
          maxTimeoutSeconds: 60,
          asset: USDC_BASE,
          extra: {
            name: 'USDC',
            version: '2',
            ...(pricing.inputSchema ? { inputSchema: pricing.inputSchema } : {}),
            ...(pricing.outputExample ? { outputExample: pricing.outputExample } : {}),
          },
        }
      : {};

    const accepts = pricing ? [injectOutputSchema(method, url.pathname, baseAccept)] : [];

    const body = {
      x402Version: 1,
      error: 'payment_required',
      accepts,
      ...buildAccessRamp(),
    };

    c.res = new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: c.res.headers,
    });
    c.res.headers.set('Content-Type', 'application/json');
  };
}
