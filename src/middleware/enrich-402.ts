import type { MiddlewareHandler } from 'hono';

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base';

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
      'Lookup a BIC/SWIFT code against 39,243 GLEIF entries with LEI enrichment. Returns bank name, country, city, LEI and address.',
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
      'Full compliance check: IBAN validation + sanctions screening (OFAC/EU/UN) + SEPA Instant reachability + VoP participant + risk score (0-100). Pre-flight triage, not a regulated AML product.',
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

/**
 * Enriches HTTP 402 responses to be both machine-readable (x402 v0.1 spec compliant)
 * AND human-readable. Agents need the `accepts` array to automate payment;
 * humans need the message + free_tier instructions.
 *
 * Includes inputSchema and outputExample on each `accepts` entry to power
 * Coinbase Bazaar discovery (semantic search relies on description + schemas).
 *
 * Runs AFTER the x402 SDK and only acts if the body is empty/{} or missing
 * the `accepts` field. Never overrides a properly-formed x402 response.
 */
export function enrich402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    if (c.res.status !== 402) return;

    const cloned = c.res.clone();
    const text = await cloned.text();

    if (text && text.trim() !== '{}') return;

    const url = new URL(c.req.url);
    const pricing = findPricing(c.req.method, url.pathname);
    const walletAddress = process.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000';

    const accepts = pricing
      ? [
          {
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
          },
        ]
      : [];

    const body = {
      x402Version: 1,
      error: 'payment_required',
      message:
        'Authentication required. Get a free API key (200 req/month) or pay per call via x402.',
      accepts,
      free_tier: {
        description: '200 requests/month — no credit card, no subscription',
        signup: 'POST /v1/keys/generate with body {"email":"you@example.com"}',
        usage: 'Add header: Authorization: Bearer ifk_your_key_here',
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

    c.res = new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: c.res.headers,
    });
    c.res.headers.set('Content-Type', 'application/json');
  };
}
