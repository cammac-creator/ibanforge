import type { MiddlewareHandler } from 'hono';
import type { HonoEnv, PaywallCause } from '../types.js';
import { datasetFacts } from '../lib/dataset-facts.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();


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
      inputBody: { iban: 'CH1000230000000012345' },
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
      // Real API response for the input above (captured from prod), cost shown at the x402 rate.
      outputExample: {
        iban: 'CH1000230000000012345',
        valid: true,
        country: { code: 'CH', name: 'Switzerland' },
        check_digits: '10',
        bban: { bank_code: '00230', account_number: '000000012345' },
        sepa: { member: true, schemes: ['SCT', 'SDD'], vop_required: false },
        formatted: 'CH10 0023 0000 0000 1234 5',
        bic: { code: 'UBSWCHZH', bank_name: 'UBS Switzerland AG', city: 'Zürich' },
        issuer: { type: 'bank', name: 'UBS Switzerland AG', classification: 'default' },
        risk_indicators: {
          issuer_type: 'bank',
          country_risk: 'standard',
          test_bic: false,
          sepa_reachable: true,
          sepa_reachable_scope: 'country',
          vop_coverage: false,
        },
        bank_code_check: {
          value: '00230',
          status: 'verified',
          match: 'register',
          register: 'SIX BankMaster (Swiss IID / BC-Nummer register)',
          authoritative: true,
          as_of: '2026-07',
        },
        clearing: {
          iid: '00230',
          name: 'UBS Switzerland AG',
          type: 'bank',
          town: 'Zürich',
          sic: true,
          instant_payments_chf: true,
          eurosic: true,
          qr_iid: null,
        },
        cost_usdc: 0.005,
      },
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/batch',
    data: {
      inputMethod: 'POST',
      bodyType: 'json',
      inputBody: { ibans: ['CH1000230000000012345', 'DE89370400440532013000'] },
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
      // Real response shape (per-result fields trimmed; each result carries the
      // same enrichment as /v1/iban/validate). count/valid_count, not "summary".
      outputExample: {
        results: [
          {
            iban: 'CH1000230000000012345',
            valid: true,
            country: { code: 'CH', name: 'Switzerland' },
            bic: { code: 'UBSWCHZH', bank_name: 'UBS Switzerland AG', city: 'Zürich' },
          },
          {
            iban: 'DE89370400440532013000',
            valid: true,
            country: { code: 'DE', name: 'Germany' },
            bic: { code: 'COBADEFF', bank_name: 'COMMERZBANK Aktiengesellschaft', city: 'Frankfurt am Main' },
          },
        ],
        count: 2,
        valid_count: 2,
        cost_usdc: 0.004,
      },
    },
  },
  {
    match: (m, p) => m === 'GET' && /^\/v1\/bic\/[^/]+$/.test(p),
    data: {
      inputMethod: 'GET',
      inputPathParams: { code: 'UBSWCHZH80A' },
      // Real API response for the input above (captured from prod, trimmed).
      outputExample: {
        bic: 'UBSWCHZH80A',
        bic8: 'UBSWCHZH',
        bic11: 'UBSWCHZH80A',
        found: true,
        valid_format: true,
        institution: 'UBS Switzerland AG',
        country: { code: 'CH', name: 'Switzerland' },
        city: 'Zurich',
        address: {
          type: 'registered',
          street: 'Bahnhofstrasse 45',
          post_code: '8001',
          city: 'Zurich',
          country: 'CH',
          source: 'GLEIF',
        },
        address_available: true,
        branch_code: '80A',
        lei: '549300WOIFUSNYH0FL22',
        lei_status: 'ACTIVE',
        is_test_bic: false,
        source: 'gleif',
      },
    },
  },
  {
    match: (m, p) => m === 'GET' && /^\/v1\/ch\/clearing\/[^/]+$/.test(p),
    data: {
      inputMethod: 'GET',
      inputPathParams: { iid: '00230' },
      // Real API response for the input above (captured from prod, trimmed).
      outputExample: {
        iid: '00230',
        found: true,
        institution: { name: 'UBS Switzerland AG', type: 'bank', iid_type: 'headquarters', headquarters_iid: '00230' },
        address: { street: 'Bahnhofstrasse', building_number: '45', post_code: '8098', town: 'Zürich', country: 'CH' },
        bic: 'UBSWCHZH80A',
        payment_services: {
          sic: true,
          rtgs_chf: true,
          instant_payments_chf: true,
          eurosic: true,
          lsv_bdd_chf: true,
          lsv_bdd_eur: true,
        },
        sic_iid: '002301',
        qr_iid: null,
      },
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/compliance',
    data: {
      inputMethod: 'POST',
      bodyType: 'json',
      inputBody: { iban: 'CH1000230000000012345' },
      inputJsonSchema: {
        type: 'object',
        required: ['iban'],
        properties: {
          iban: { type: 'string', description: 'IBAN to triage.', minLength: 15, maxLength: 34 },
        },
      },
      // Real API response for the input above (captured from prod, trimmed —
      // the full response also carries the complete /v1/iban/validate enrichment).
      outputExample: {
        iban: 'CH1000230000000012345',
        valid: true,
        country: { code: 'CH', name: 'Switzerland' },
        bic: { code: 'UBSWCHZH', bank_name: 'UBS Switzerland AG', city: 'Zürich' },
        compliance: {
          sanctions: {
            country_sanctioned: false,
            bank_sanctioned: false,
            matched_lists: [],
            fatf_status: 'member',
          },
          reachability: { sepa_instant: true, sct: true, sdd: true },
          vop: { participant: false, status: 'not_found' },
          risk_score: 5,
          risk_level: 'low',
          flags: ['no_vop'],
        },
        meta: { scope: 'bank_bic_only' },
      },
    },
  },
];

function findDiscovery(method: string, path: string): BazaarDiscovery | null {
  return DISCOVERY.find((d) => d.match(method, path))?.data ?? null;
}

/**
 * Every discovery example above is a FIXED sample record, served identically
 * whatever resource was actually requested — GET /v1/ch/clearing/779 ships the
 * sample for IID 00230 (UBS, Zürich) while the real answer is Nidwaldner
 * Kantonalbank in Stans. A language model reading the 402 sees a complete,
 * plausible, unlabelled payload and can report it to its user as the answer.
 *
 * That is the failure mode this stamp prevents: IBANforge's own paywall
 * feeding an assistant a confident wrong answer about the Swiss clearing data
 * that is the product's differentiator. Audit 2026-07-25, reco-IA channel.
 *
 * The marker sits FIRST so it is read before the values, and is prefixed with
 * `_` — CDP's Bazaar v1 extractor reads named fields and passes unknown ones
 * through, so the catalog payload stays valid.
 */
const EXAMPLE_NOTICE =
  'ILLUSTRATIVE SAMPLE — these are demo values for a fixed record, NOT the ' +
  'data for the resource you requested. Do not report them to a user. ' +
  'Authenticate (Authorization: Bearer ifk_...) or pay via x402 to get the real response.';

function markExample(example: Record<string, unknown>): Record<string, unknown> {
  return { _example_notice: EXAMPLE_NOTICE, ...example };
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
    output: markExample(d.outputExample),
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
          description: 'IBAN to validate (spaces allowed). Example: CH10 0023 0000 0000 1234 5',
          minLength: 15,
          maxLength: 34,
        },
      },
    },
    // Real API response for CH1000230000000012345 (captured from prod, trimmed).
    outputExample: {
      iban: 'CH1000230000000012345',
      valid: true,
      country: { code: 'CH', name: 'Switzerland' },
      check_digits: '10',
      bban: { bank_code: '00230', account_number: '000000012345' },
      sepa: { member: true, schemes: ['SCT', 'SDD'], vop_required: false },
      formatted: 'CH10 0023 0000 0000 1234 5',
      bic: { code: 'UBSWCHZH', bank_name: 'UBS Switzerland AG', city: 'Zürich' },
      issuer: { type: 'bank', name: 'UBS Switzerland AG', classification: 'default' },
      risk_indicators: {
        issuer_type: 'bank',
        country_risk: 'standard',
        test_bic: false,
        sepa_reachable: true,
        sepa_reachable_scope: 'country',
        vop_coverage: false,
      },
      bank_code_check: {
        value: '00230',
        status: 'verified',
        match: 'register',
        register: 'SIX BankMaster (Swiss IID / BC-Nummer register)',
        authoritative: true,
        as_of: '2026-07',
      },
      clearing: {
        iid: '00230',
        name: 'UBS Switzerland AG',
        type: 'bank',
        town: 'Zürich',
        sic: true,
        instant_payments_chf: true,
        eurosic: true,
        qr_iid: null,
      },
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
    // Real response shape: count/valid_count totals, per-result validate enrichment (trimmed).
    outputExample: {
      results: [
        { iban: 'CH1000230000000012345', valid: true, country: { code: 'CH', name: 'Switzerland' } },
        { iban: 'DE89370400440532013000', valid: true, country: { code: 'DE', name: 'Germany' } },
      ],
      count: 2,
      valid_count: 2,
      cost_usdc: 0.004,
    },
  },
  {
    match: (m, p) => m === 'GET' && p.startsWith('/v1/bic/'),
    price_usdc: 0.003,
    description:
      `Lookup a BIC/SWIFT code against ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF, refreshed monthly). Returns bank name, country, city, LEI, and registered head-office address (where available).`,
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
    // Real API response for UBSWCHZH80A (captured from prod, trimmed).
    outputExample: {
      bic: 'UBSWCHZH80A',
      bic8: 'UBSWCHZH',
      bic11: 'UBSWCHZH80A',
      found: true,
      valid_format: true,
      institution: 'UBS Switzerland AG',
      country: { code: 'CH', name: 'Switzerland' },
      city: 'Zurich',
      address: {
        type: 'registered',
        street: 'Bahnhofstrasse 45',
        post_code: '8001',
        city: 'Zurich',
        country: 'CH',
        source: 'GLEIF',
      },
      address_available: true,
      lei: '549300WOIFUSNYH0FL22',
      lei_status: 'ACTIVE',
    },
  },
  {
    match: (m, p) => m === 'POST' && p === '/v1/iban/compliance',
    price_usdc: 0.02,
    description:
      'Pre-payout screening for agents — vet a counterparty IBAN before you send funds: validation + sanctions screening (OFAC) + SEPA Instant reachability + VoP participant + risk score (0-100). Pre-flight triage, not a regulated AML product.',
    inputSchema: {
      type: 'object',
      required: ['iban'],
      properties: {
        iban: { type: 'string', description: 'IBAN to check' },
      },
    },
    // Real API response for CH1000230000000012345 (captured from prod, trimmed).
    outputExample: {
      iban: 'CH1000230000000012345',
      valid: true,
      country: { code: 'CH', name: 'Switzerland' },
      compliance: {
        sanctions: {
          country_sanctioned: false,
          bank_sanctioned: false,
          matched_lists: [],
          fatf_status: 'member',
        },
        reachability: { sepa_instant: true, sct: true, sdd: true },
        vop: { participant: false, status: 'not_found' },
        risk_score: 5,
        risk_level: 'low',
        flags: ['no_vop'],
      },
      meta: { scope: 'bank_bic_only' },
    },
  },
  {
    match: (m, p) => m === 'GET' && p.startsWith('/v1/ch/clearing/'),
    price_usdc: 0.003,
    description:
      `Swiss BC-Nummer / IID clearing lookup against ${F.claim.chClearing} SIX BankMaster entries (refreshed monthly). Returns institution name, type, address, BIC, the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) and the QR-IID allocation.`,
    inputSchema: {
      type: 'object',
      required: ['iid'],
      properties: {
        iid: {
          type: 'string',
          description: 'Swiss IID / BC-Nummer (1-5 digits). Example: 230',
          pattern: '^[0-9]{1,5}$',
        },
      },
    },
    // Real API response for IID 230 (captured from prod, trimmed).
    outputExample: {
      iid: '00230',
      found: true,
      institution: { name: 'UBS Switzerland AG', type: 'bank', iid_type: 'headquarters', headquarters_iid: '00230' },
      bic: 'UBSWCHZH80A',
      payment_services: {
        sic: true,
        rtgs_chf: true,
        instant_payments_chf: true,
        eurosic: true,
        lsv_bdd_chf: true,
        lsv_bdd_eur: true,
      },
      sic_iid: '002301',
      qr_iid: null,
    },
  },
];

/**
 * Credit packs are gated by the x402 middleware, but the SDK emits an EMPTY
 * 402 body, so this table is what actually builds the offer an agent reads.
 * Without an entry here the sales routes answered `accepts: []` — gated, yet
 * impossible to pay: the only autonomous purchase path was a dead end.
 * Prices must stay in sync with src/routes/credits-buy.ts and the x402 route
 * table in src/middleware/x402.ts. Audit 2026-07-25.
 */
const CREDIT_BUNDLES: Array<{ slug: string; credits: number; price_usdc: number; discount?: string }> = [
  { slug: '1k', credits: 1000, price_usdc: 5 },
  { slug: '5k', credits: 5000, price_usdc: 20, discount: '-20% vs retail' },
  { slug: '25k', credits: 25000, price_usdc: 80, discount: '-36% vs retail' },
];

for (const b of CREDIT_BUNDLES) {
  const perCall = Math.round((b.price_usdc / b.credits) * 1_000_000) / 1_000_000;
  PRICING.push({
    match: (m, p) => m === 'POST' && new RegExp(`^/v1/credits/buy/${b.slug}/?$`).test(p),
    price_usdc: b.price_usdc,
    description:
      `Prepaid bundle of ${b.credits.toLocaleString('en-US')} credits for AI agents — ` +
      `1 credit = 1 validation/lookup, batch validation debits 1 credit per IBAN. ` +
      `${perCall} USDC per call${b.discount ? ` (${b.discount})` : ''}. ` +
      `ONE x402 settlement instead of ${b.credits.toLocaleString('en-US')} micropayments. ` +
      `Returns a fresh ifk_ key valid on any /v1/iban/* or /v1/bic/* endpoint. Credits never expire.`,
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Optional — anonymous keys are fully functional. Used only to let you recover the key.',
        },
      },
    },
    outputExample: {
      api_key: 'ifk_live_example_key_shown_once',
      key_prefix: 'ifk_live_exam',
      credits: b.credits,
      bundle: b.slug,
      price_paid_usdc: b.price_usdc,
      price_per_call_usdc: perCall,
      message: 'Save this key — it will not be shown again.',
    },
  });
}

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
/**
 * When the api-key middleware flagged WHY this request fell through to the
 * paywall (exhausted quota/credits, broken key), surface it prominently:
 * a `cause` object plus a message that states the real situation. Without
 * this, an authenticated-but-exhausted client reads the generic 402 as
 * "you are anonymous" and never learns what actually happened.
 */
function causeFields(cause: PaywallCause | undefined): Record<string, unknown> {
  if (!cause) return {};
  return { cause, message: cause.detail };
}

/**
 * Causes where the caller ALREADY holds a key and has simply run out of
 * allowance. For them the free tier is not an upgrade path, it is a way to
 * never pay: the 2026-07-25 funnel audit measured a client hit the quota wall,
 * mint a second free key minutes later and be back in service within the
 * hour, without paying. Shipping `free_tier.signup` inside a "you must pay
 * now" response is what makes that the path of least resistance.
 *
 * `invalid_api_key` is deliberately NOT in this set: that caller may genuinely
 * have lost their key and needs the signup route.
 */
const ALLOWANCE_EXHAUSTED: ReadonlySet<PaywallCause['reason']> = new Set([
  'monthly_quota_exhausted',
  'monthly_quota_insufficient',
  'credits_exhausted',
  'credits_insufficient',
]);

/**
 * Strips the free-tier signup rail from a 402 whose cause is an exhausted
 * allowance, leaving the paid rails (`credit_packs` first, then `x402`) as the
 * only ways forward. No-op for every other cause.
 */
function stripFreeTierWhenExhausted(
  body: Record<string, unknown>,
  cause: PaywallCause | undefined,
): Record<string, unknown> {
  if (!cause || !ALLOWANCE_EXHAUSTED.has(cause.reason)) return body;
  const rest = { ...body };
  delete rest.free_tier;
  return rest;
}

export function enrich402Middleware(): MiddlewareHandler<HonoEnv> {
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
      const paywallCause = c.get('paywallCause');
      const enriched: Record<string, unknown> = stripFreeTierWhenExhausted(
        {
          x402Version: 1,
          error: 'payment_required',
          ...parsed,
          ...buildAccessRamp(),
          ...causeFields(paywallCause),
        },
        paywallCause,
      );
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
            ...(pricing.outputExample ? { outputExample: markExample(pricing.outputExample) } : {}),
          },
        }
      : {};

    const accepts = pricing ? [injectOutputSchema(method, url.pathname, baseAccept)] : [];

    const fallbackCause = c.get('paywallCause');
    const body = stripFreeTierWhenExhausted(
      {
        x402Version: 1,
        error: 'payment_required',
        accepts,
        ...buildAccessRamp(),
        ...causeFields(fallbackCause),
      },
      fallbackCause,
    );

    c.res = new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: c.res.headers,
    });
    c.res.headers.set('Content-Type', 'application/json');
  };
}
