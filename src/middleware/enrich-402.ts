import type { MiddlewareHandler } from 'hono';
import type { HonoEnv, PaywallCause } from '../types.js';
import { datasetFacts } from '../lib/dataset-facts.js';
import {
  buildBazaarInfo,
  findDiscovery,
  markExample,
  routeTemplateOf,
} from '../lib/x402-discovery.js';
import { canonicalPaidPath } from './x402.js';
import {
  ENTRY_PAYMENT_LINK,
  PRICING_PAGE,
  PRO_PAYMENT_LINK,
  PRO_PRICE_USD,
} from '../lib/payment-links.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Base L2 in CAIP-2, which is how x402 v2 names a network. v1 spelled it
 * `base`; the two are the same chain and the difference is the dialect.
 */
const NETWORK = 'eip155:8453';

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
      // The register check is the claim that separates this from a checksum
      // pass, and a registry operator told us it was invisible from the
      // discovery document — it lived only in settled responses. Surfaced.
      'Validate a single IBAN (ISO 13616 mod-97) and resolve BIC, country, EMI/vIBAN classification, SEPA + VoP flags, and Swiss BC-Nummer for CH/LI accounts. Domestic bank codes are verified against the national registers we mirror (with as-of dates), not just checksummed.',
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
        {
          iban: 'CH1000230000000012345',
          valid: true,
          country: { code: 'CH', name: 'Switzerland' },
        },
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
    description: `Lookup a BIC/SWIFT code against ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF, refreshed monthly). Returns bank name, country, city, LEI, and registered head-office address (where available).`,
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
      'Pre-payout screening for agents — check the bank behind a counterparty IBAN before you send funds: validation + sanctions screening (OFAC) + SEPA Instant reachability + VoP participant + risk score (0-100). Pre-flight triage, not a regulated AML product.',
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
    description: `Swiss BC-Nummer / IID clearing lookup against ${F.claim.chClearing} SIX BankMaster entries (refreshed monthly). Returns institution name, type, address, BIC, the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) and the QR-IID allocation.`,
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
      institution: {
        name: 'UBS Switzerland AG',
        type: 'bank',
        iid_type: 'headquarters',
        headquarters_iid: '00230',
      },
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
const CREDIT_BUNDLES: Array<{
  slug: string;
  credits: number;
  price_usdc: number;
  discount?: string;
}> = [
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
          description:
            'Optional — anonymous keys are fully functional. Used only to let you recover the key.',
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

/**
 * The x402 v2 announcement the SDK already produced, decoded from the
 * `PAYMENT-REQUIRED` header.
 *
 * This is the machine half of the 402 body, and reading it back rather than
 * rebuilding it is the whole point: until 17/08/2026 the body was assembled
 * here by hand and announced x402 v1 (`maxAmountRequired`, network `base`)
 * while the header on the very same response announced v2 (`amount`, network
 * `eip155:8453`). Two answers to "what do I owe you" for one resource. A
 * payment surface cannot have a second opinion.
 */
function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function decodePaymentRequired(header: string | null): Record<string, unknown> | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown;
    if (!decoded || typeof decoded !== 'object') return null;
    const announcement = decoded as Record<string, unknown>;
    return Array.isArray(announcement.accepts) ? announcement : null;
  } catch {
    return null;
  }
}

/**
 * A v2 announcement for a route the x402 middleware does not gate, so the 402
 * still says what it costs and how to pay it.
 *
 * In production every paid route carries the header, so this is the safety net
 * rather than the path — but a 402 that cannot quote a price is a dead end,
 * and this file exists because we shipped exactly that once.
 */
function buildFallbackAnnouncement(
  method: string,
  path: string,
  walletAddress: string,
): Record<string, unknown> | null {
  const pricing = findPricing(method, path);
  if (!pricing) return null;

  const announcement: Record<string, unknown> = {
    x402Version: 2,
    resource: {
      // The URL actually requested, same as the SDK announces on the gated
      // routes. A `:code` template here would be published as callable and is
      // not: it answers 400.
      url: `https://api.ibanforge.com${path}`,
      description: pricing.description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        amount: Math.round(pricing.price_usdc * 1_000_000).toString(),
        asset: USDC_BASE,
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
        // The EIP-712 domain the payer signs against, and nothing else. v1
        // carried our inputSchema and outputExample in here too; in v2 `extra`
        // is signing material, so discovery data belongs in extensions.bazaar.
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
  };

  const discovery = findDiscovery(method, path);
  if (discovery) {
    announcement.extensions = {
      bazaar: {
        discoverable: true,
        // What a catalog groups on, so /v1/bic/:code stays one resource
        // instead of one per BIC ever probed. The SDK emits this field itself
        // on the gated routes; the fallback matches it rather than being a
        // lesser stand-in.
        routeTemplate: routeTemplateOf(path),
        ...(discovery.bodyType ? { bodyType: discovery.bodyType } : {}),
        ...(pricing.inputSchema ? { inputSchema: pricing.inputSchema } : {}),
        info: buildBazaarInfo(discovery),
      },
    };
  } else if (pricing.outputExample) {
    // Credit bundles have no captured sample response, only the shape of the
    // key they mint, so they get the example without the rest.
    announcement.extensions = {
      bazaar: {
        discoverable: true,
        bodyType: 'json',
        ...(pricing.inputSchema ? { inputSchema: pricing.inputSchema } : {}),
        info: {
          input: { type: 'http', method, bodyType: 'json', body: {}, discoverable: true },
          output: { type: 'json', example: markExample(pricing.outputExample) },
        },
      },
    };
  }

  return announcement;
}

/**
 * Byte budget for the `PAYMENT-REQUIRED` header.
 *
 * Node caps a whole response header block at `http.maxHeaderSize`, 16 384
 * bytes by default, and undici (the engine behind `fetch`) aborts the response
 * with UND_ERR_HEADERS_OVERFLOW rather than surfacing the 402 underneath. The
 * MCP audit of 2026-09-01 measured 18 600 bytes on POST /v1/iban/validate and
 * 19 509 on POST /v1/iban/batch: every Node caller — the published
 * `ibanforge-mcp` package, our own TypeScript SDK, the `wrapFetchWithPayment`
 * recipe in /docs/pay-as-an-agent — read `fetch failed` where a price should
 * have been. Python, curl and HTTP/2 clients never saw it.
 *
 * 8 KB, not 16: the other response headers already cost ~1.3 KB, and a budget
 * with no room left is a budget that breaks again the next time the discovery
 * payload grows.
 */
export const MAX_PAYMENT_REQUIRED_BYTES = 8192;

/**
 * Fields dropped from the header copy of an extension, in order.
 *
 * `outputSchema` is a full JSON Schema of the response — 11 KB on
 * /v1/iban/validate — and nothing on the payment path reads it: @x402/core
 * compares only `extensions.<key>.info` when it checks a client echo
 * (`getExtensionInfo` returns `value.info` when present), the Bazaar
 * facilitator validates `info` against the sibling `schema`, and the x402 SDK's
 * own v1 catalog path deletes this very field. The 402 BODY still carries it
 * in full for indexers that read bodies.
 */
const HEADER_BULK_EXTENSION_KEYS = ['outputSchema'] as const;

/** The header value the SDK encodes: base64 of the JSON announcement. */
function encodeAnnouncement(announcement: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(announcement), 'utf8').toString('base64');
}

function encodedBytes(announcement: Record<string, unknown>): number {
  return encodeAnnouncement(announcement).length;
}

/** Every extension copied, minus the bulk fields that sit BESIDE `info`. */
function withoutExtensionBulk(extensions: unknown): Record<string, unknown> | null {
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extensions as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    const copy = { ...(value as Record<string, unknown>) };
    for (const bulk of HEADER_BULK_EXTENSION_KEYS) delete copy[bulk];
    out[key] = copy;
  }
  return out;
}

/**
 * The announcement as it goes into the `PAYMENT-REQUIRED` header: the same
 * object, shrunk only as far as the budget requires, and never below it.
 *
 * Two rungs, in this order, and deliberately no third. Drop the bulk fields
 * beside `info`; if that is still too large, drop `extensions` outright. A
 * HALF-trimmed `info` is the one thing this must never emit: on the paid
 * retry, @x402/core validates the client's echoed extension info as a subset
 * of what the server advertises (`objectContainsSubset` in
 * `x402ResourceServer.validateExtensions`, and the Bazaar extension declares no
 * dynamic fields), so a client echoing a trimmed `info` would be refused with
 * `extension_echo_mismatch`. A client that saw no extensions echoes none, and
 * that same check passes untouched.
 *
 * `x402Version`, `error`, `resource` and `accepts` are never touched — they are
 * the payment terms, and the whole point is that the caller finally gets to
 * read them. Audit MCP-01, 2026-09-01.
 */
export function projectAnnouncementForHeader(
  announcement: Record<string, unknown>,
  maxBytes: number = MAX_PAYMENT_REQUIRED_BYTES,
): Record<string, unknown> {
  if (encodedBytes(announcement) <= maxBytes) return announcement;

  const slimmed: Record<string, unknown> = { ...announcement };
  const extensions = withoutExtensionBulk(announcement.extensions);
  if (extensions) {
    slimmed.extensions = extensions;
    if (encodedBytes(slimmed) <= maxBytes) return slimmed;
  }

  delete slimmed.extensions;
  return slimmed;
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
      signup: 'POST /v1/keys/generate with body {"email":"you@company.com"}',
      usage: 'Add header: Authorization: Bearer ifk_your_key_here',
    },
    // The structural verdict is free and needs no key: format, checksum,
    // country, BBAN. Until 02/09/2026 a caller who hit this wall had to guess
    // that; the paid call is what adds the registry (BIC, bank, SEPA, sanctions,
    // Swiss clearing), and the wall now says so.
    free_structural_check: {
      description:
        'Structure, checksum, country and BBAN, free and without a key. Registry data (BIC, bank, SEPA, sanctions, Swiss clearing) is what the paid call adds.',
      endpoint:
        'GET /v1/iban/format?iban=CH9300762011623852957 or POST /v1/iban/format with body {"iban":"..."}',
    },
    credit_packs: {
      description: 'Prepaid credits — never expire, lower per-call cost than retail',
      // 🚨 This field used to be an HTML anchor — `https://api.ibanforge.com/#pricing`
      // — which is the exact failure mode `src/lib/payment-links.ts` names as the
      // reason it exists: "the 402 paywall could advertise pay_by_card while
      // pointing at an HTML anchor a machine client never renders". The 25/07
      // card-first fix reached only the "key exhausted" branch, through
      // `paywallCause.detail`; the anonymous branch — the overwhelming majority
      // of 402s served — kept the anchor. So the one rail with a measured
      // conversion (a wall, then a pack bought under two minutes later) was
      // reaching well under one percent of the callers who saw a wall.
      //
      // Same constant as every other card surface (dashboard, e-mails,
      // /STRIPE_PAYMENT_LINK_* redirects), never a URL retyped here. The
      // Editor/OEM link is deliberately absent from payment-links.ts — it is a
      // private link sent in conversation — so importing from that module
      // cannot leak it.
      pay_by_card: ENTRY_PAYMENT_LINK,
      // Added, not renamed: `pay_by_card` keeps its name and its meaning (one
      // clickable checkout), and the field below carries the other half of
      // what the anchor used to gesture at. Catalog ingesters read named
      // fields and pass unknown ones through, so nothing that reads this body
      // today stops working.
      //
      // `CARD_CHECKOUT_HINT` — the prose form of the same offer — is
      // deliberately NOT repeated here. On the exhausted-allowance branch it
      // is already the body's `message` (written by api-key.ts into
      // paywallCause.detail), and stating one offer twice in one response
      // reads worse to a language model than stating it once. The prices it
      // quotes are in `pricing` just below.
      pay_by_card_all_packs: PRICING_PAGE,
      pay_by_usdc: 'POST /v1/credits/buy/1k|5k|25k — list: GET /v1/credits/bundles',
      pricing: '1k = $5 · 5k = $20 (-20%) · 25k = $80 (-36%)',
      // ECB/Banco de España licence condition: a buyer must be told, before
      // paying, that the underlying data is free at its official source. The
      // 402 IS the machine buyer's pre-payment screen, so the notice lives
      // here — phrased as what the fee actually buys.
      data_note:
        'The public registers behind this API are available free of charge from their official publishers (see https://ibanforge.com/docs/data-sources). The fee pays for validation logic, aggregation, freshness and API delivery.',
    },
    // Pro subscription (2026-09-02): the flat monthly alternative, for a caller
    // that budgets one number a month rather than topping up packs. Same source
    // of truth as every other card surface (src/lib/payment-links.ts); card
    // only, a subscription has no x402 rail. A sibling of credit_packs, not a
    // child: a plan is not a pack, and ingesters that read credit_packs keep
    // reading exactly what they read before.
    monthly_plan: {
      description: `Pro: $${PRO_PRICE_USD}/month for 10,000 requests, resets on the 1st, cancel anytime`,
      subscribe_by_card: PRO_PAYMENT_LINK,
      details: PRICING_PAGE,
    },
    x402: {
      description: 'Pay per call with USDC on Base L2 (machine-to-machine)',
      // The measured last metre: thousands of 402s a week reach callers whose
      // wallet is not funded (or not created) at the moment the wall appears,
      // and this body carried every rail EXCEPT the "I have no wallet yet"
      // path. /docs/pay-as-an-agent (live, linked from llms.txt and the MCP
      // instructions) walks that path in 3 steps — the 402 itself was the one
      // surface that never mentioned it.
      wallet_setup:
        'https://ibanforge.com/docs/pay-as-an-agent — create and fund an agent wallet, then make your first paid call (3 steps)',
      protocol_docs: 'https://x402.org',
      discovery: 'https://api.ibanforge.com/.well-known/x402',
      bazaar: 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources',
      // Both dialects settle. We announce v2; the route still honours a v1
      // X-PAYMENT signature, so an older client that already holds v1
      // requirements is not locked out.
      payment_header: 'PAYMENT-SIGNATURE (x402 v2) — X-PAYMENT (v1) is still accepted',
    },
    documentation: 'https://ibanforge.com/docs',
    terms: 'https://ibanforge.com/legal/terms — using the API constitutes acceptance',
    llms: 'https://api.ibanforge.com/llms.txt',
  };
}

/**
 * When the api-key middleware flagged WHY this request fell through to the
 * paywall (exhausted quota/credits, broken key), surface it prominently:
 * a `cause` object plus a message that states the real situation. Without
 * this, an authenticated-but-exhausted client reads the generic 402 as
 * "you are anonymous" and never learns what actually happened.
 */
/**
 * The announcement's own error, when it describes a payment that was ATTEMPTED
 * and refused rather than one that was never made.
 *
 * A second 402 after a signature was sent means something rejected it, and the
 * SDK says what in the header it re-issues. Overwriting `error` with the
 * generic code and stopping there leaves the payer staring at "payment
 * required" for a payment they just made. Found the hard way on 17/08/2026:
 * /v1/bic/:code answers 402 to a valid signature, and the reason — the CDP
 * facilitator refusing the payload — was legible only by base64-decoding a
 * response header.
 */
const GENERIC_402 = /^payment[ _]required$/i;

function paymentErrorField(announcement: Record<string, unknown> | null): Record<string, unknown> {
  const error = announcement?.error;
  if (typeof error !== 'string' || error.trim() === '' || GENERIC_402.test(error.trim())) return {};
  return { payment_error: error };
}

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

/**
 * Turns a 402 into something both a payment client and a person can act on.
 *
 * The machine half is the x402 v2 announcement the SDK put in the
 * `PAYMENT-REQUIRED` header, decoded back into the body — agents that never
 * look at headers, and the language models that read our 402s as
 * documentation, both get the real requirements. The human half is the access
 * ramp: the free key, the credit packs, the pay-per-call rail.
 *
 * Only `error` is deliberately not mirrored. The header carries the SDK's
 * prose ("Payment required"); the body keeps `payment_required`, which is the
 * error code we publish in llms.txt and in the error table agents branch on.
 * When that prose says something other than "you have not paid" — a rejected
 * signature, a facilitator that refused the payload — it is surfaced beside
 * the code as `payment_error`, because a payer who tried and failed needs the
 * reason and should not have to base64-decode a response header to find it.
 */
export function enrich402Middleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    // A paid resource asked for with a trailing slash never reached a handler:
    // Hono routes strictly, so it answered 404 (POST) or 405 (GET) — a mute
    // wall where the price should have been. Sent back to the canonical path
    // with 308, which preserves method AND body, so the replay produces the
    // real 402 from the route that can actually serve it afterwards.
    //
    // Done HERE rather than in the x402 middleware because this is the first
    // middleware mounted under /v1/*: the api-key middleware sits between the
    // two and bills quota before delegating, refunding only on 4xx, so a 308
    // issued after it would charge a key holder twice for one slashed call.
    const canonical = canonicalPaidPath(c.req.method, new URL(c.req.url).pathname);
    if (canonical) {
      const url = new URL(c.req.url);
      url.pathname = canonical;
      return c.redirect(url.pathname + url.search, 308);
    }

    await next();

    if (c.res.status !== 402) return;

    const url = new URL(c.req.url);
    const method = c.req.method;
    const walletAddress =
      process.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000';

    const headerAnnouncement = decodePaymentRequired(c.res.headers.get('payment-required'));
    let announcement = headerAnnouncement;

    if (!announcement) {
      const existing = (await c.res.clone().text()).trim();
      if (existing === '' || existing === '{}') {
        announcement = buildFallbackAnnouncement(method, url.pathname, walletAddress);
      } else {
        // Something upstream wrote a body. If it quotes payment terms, those
        // terms are the announcement and we only add the ramp around them.
        // Anything else is another middleware's considered 402 and we leave
        // its explanation alone rather than overwriting it with ours.
        const parsed = safeJson(existing);
        if (!parsed || !Array.isArray(parsed.accepts)) return;
        announcement = parsed;
        if (!parsed.extensions) {
          const fallback = buildFallbackAnnouncement(method, url.pathname, walletAddress);
          if (fallback?.extensions) parsed.extensions = fallback.extensions;
        }
      }
    }

    // An empty 402 on a route we cannot price still gets the access ramp: the
    // caller learns how to obtain a key or buy credits. A bare `{}` is the
    // dead end this middleware exists to prevent.
    const paywallCause = c.get('paywallCause');
    const body = stripFreeTierWhenExhausted(
      {
        ...(announcement ?? {}),
        error: 'payment_required',
        ...paymentErrorField(announcement),
        ...buildAccessRamp(),
        ...causeFields(paywallCause),
      },
      paywallCause,
    );

    c.res = new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: c.res.headers,
    });
    c.res.headers.set('Content-Type', 'application/json');

    // The header is the half a Node caller cannot survive, and this middleware
    // is the one place that already holds both halves: the body above keeps the
    // complete announcement, the header goes out trimmed to what fetch() can
    // parse. Rewritten only when the SDK wrote one — a 402 we built ourselves
    // has no gate behind it and must not start advertising payment terms in a
    // header. Audit MCP-01, 2026-09-01.
    if (headerAnnouncement) {
      const projected = projectAnnouncementForHeader(headerAnnouncement);
      if (projected !== headerAnnouncement) {
        c.res.headers.set('PAYMENT-REQUIRED', encodeAnnouncement(projected));
      }
    }
  };
}
