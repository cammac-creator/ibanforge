import type { MiddlewareHandler } from 'hono';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import type { HonoEnv } from '../types.js';
import { datasetFacts } from '../lib/dataset-facts.js';
import { BANK_CODE_CHECK_SCHEMA as BANK_CODE_CHECK_OPENAPI , NEXT_STEPS_SCHEMA as NEXT_STEPS_OPENAPI } from '../lib/bank-code-schema.js';
import { buildBazaarInfo, discoveryForRoute, findDiscovery, routeTemplateOf } from '../lib/x402-discovery.js';
import { getIbansArray } from '../lib/request-helpers.js';
// Read-only reuse: the SAME digest the purchase route derives a recovery ref
// from, so an unconfirmed settlement can hand back the recovery URL its own
// 502 would otherwise discard. Imported, never redefined: two hashes that had
// to agree would eventually stop agreeing.
import { settlementRef } from '../routes/credits-buy.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// USDC contract address on Base L2
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * x402 payment middleware for IBANforge.
 *
 * Production rule (must NOT fail-open):
 *   - X402_ENABLED=true + WALLET_ADDRESS + CDP_API_KEY_ID + CDP_API_KEY_SECRET
 *   - OR explicit IBANFORGE_FREE_MODE=true (loud warning, all endpoints free)
 *
 * Anything else in production = boot crash. In dev/test, free mode is the default.
 */
export function ensureWalletConfigured(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const x402Enabled = process.env.X402_ENABLED === 'true';
  const walletAddress = process.env.WALLET_ADDRESS;
  const explicitFreeMode = process.env.IBANFORGE_FREE_MODE === 'true';

  if (!isProd) {
    return;
  }

  if (explicitFreeMode) {
    console.warn(
      '[x402] PRODUCTION boot with IBANFORGE_FREE_MODE=true — all paid endpoints are FREE. ' +
        'Disable this flag and set X402_ENABLED=true + WALLET_ADDRESS to enable monetization.',
    );
    return;
  }

  if (!x402Enabled) {
    throw new Error(
      'In production, X402_ENABLED must be "true". To run in explicit free mode, set IBANFORGE_FREE_MODE=true.',
    );
  }

  if (!walletAddress) {
    throw new Error('WALLET_ADDRESS is required when X402_ENABLED=true.');
  }
}

/**
 * Routes that sell something rather than serve something. They must always go
 * through the payment gate: an allowance covers consumption, never purchase.
 * Kept as a function (not a bare regex) so the intent survives future routes.
 */
export function isSellingRoute(method: string, path: string): boolean {
  return method === 'POST' && /^\/v1\/credits\/buy\/[^/]+\/?$/.test(path);
}

// ─── Batch pricing ───────────────────────────────────────────────────────────

/** Batch rate, decided 11/07/2026: 1 credit = 1 IBAN validated. Not a knob. */
export const BATCH_PRICE_PER_IBAN = 0.002;
/** The handler refuses anything larger (400 batch_too_large). */
export const BATCH_MAX_IBANS = 100;

/**
 * What a batch call is quoted, from the body the handler will read.
 *
 * 🚨 Two bugs lived in the four lines this replaces, and they pull in opposite
 * directions — fixing either one alone makes the other worse.
 *
 *  1. **The quote lied by a factor of 50.** A probe with no body (bare GET,
 *     empty POST) produced `n = 0`, which fell through to `count = 100` and a
 *     $0.20 quote, while every catalog we publish announces the per-IBAN rate
 *     ($0.002 — see the `/.well-known/x402` table, `price_usdc: 0.002`). An
 *     agent that budgets on the catalog and is then billed 50× at the door
 *     refuses SILENTLY: it is the one place where our own offer makes a
 *     solvent, willing buyer fail. A body-less quote is now the 1-IBAN
 *     minimum, which is both the true floor and the announced number.
 *
 *  2. **The count was read case-sensitively.** This read `body.ibans` verbatim
 *     while the handler reads it through `getIbansArray`, which is
 *     case-insensitive because agents uppercase acronyms. So `{"IBANS":[…100…]}`
 *     priced as `n = 0`. That was harmless only as long as `n = 0` meant "charge
 *     the cap"; the moment the quote drops to the minimum it becomes a 100×
 *     under-charge. Both sides now parse the body the same way.
 *
 * `n = 0` after a SUCCESSFUL body read is safe to quote at the minimum: the
 * handler, reading the same body with the same helper, answers 400 — and
 * @x402/hono settles only a response < 400, so nothing is ever collected for it.
 * A body that could not be read at all is a different case and keeps the cap
 * (see the caller's catch): there, we know nothing, so we must not under-quote.
 */
export function batchQuoteFor(body: unknown): string {
  const arr = getIbansArray(body as Record<string, unknown> | null | undefined);
  const n = Array.isArray(arr) ? arr.length : 0;
  const count = n < 1 ? 1 : Math.min(n, BATCH_MAX_IBANS);
  return '$' + (count * BATCH_PRICE_PER_IBAN).toFixed(3);
}

// ─── Trailing slash ──────────────────────────────────────────────────────────

/**
 * The canonical path for a paid route reached with a trailing slash, or null.
 *
 * Hono routes strictly, so `/v1/iban/validate/` matched nothing: a POST fell
 * through to 404 and a bare GET to 405 (audit C2, R2). Both are mute walls. An
 * agent whose URL builder normalises with a trailing slash — a common default —
 * concludes the resource is broken or does not speak x402, and a trust-registry
 * crawler records the same. Neither ever sees the price.
 *
 * Answering 402 on the slashed path would be worse than the wall: no handler is
 * mounted there, so a client that paid would be charged for a 404. The honest
 * answer is the one HTTP already has — 308 keeps the method AND the body, so a
 * POST with a payment header replays intact on the canonical path and gets the
 * real 402 (then the real response) from the route that can actually serve it.
 *
 * Only paid routes are redirected. Anything else keeps whatever Hono decided:
 * this is a payment-surface fix, not a global routing change (`strict: false`
 * on the Hono instance would have fixed these five paths by changing path
 * matching for every route in the app, admin and discovery included).
 *
 * Decided here, next to the route table it is derived from; APPLIED in
 * enrich-402, which is the first middleware mounted under `/v1/*`. That
 * placement is not cosmetic: the api-key middleware sits between the two and
 * increments quota BEFORE calling the next handler, refunding only on a 4xx.
 * A 308 issued after it would bill the redirect and then bill the replay —
 * one slashed call costing an API-key holder two units of allowance.
 */
export function canonicalPaidPath(method: string, path: string): string | null {
  if (!path.endsWith('/')) return null;
  const stripped = path.replace(/\/+$/, '');
  if (stripped === '') return null;
  // The five consumption routes, matched through the same table the discovery
  // document and the 402 body use, so a route added there is covered here too.
  // Method-agnostic on purpose: a bare GET on a POST resource is exactly the
  // trust-registry probe the universal 402 exists to answer, and it can only
  // answer it on the canonical path.
  if (findDiscovery('GET', stripped) || findDiscovery('POST', stripped)) return stripped;
  // The three purchase routes. A GET is deliberately NOT redirected: a probe
  // must never be walked into the purchase flow.
  if (isSellingRoute(method, stripped)) return stripped;
  return null;
}

/**
 * The longest a route description may be.
 *
 * 🚨 This is a PAYMENT constraint, not an editorial one. The description
 * travels inside `resource` in the x402 v2 payment payload, and Coinbase's
 * facilitator validates that whole payload: past this length it answers
 * `'paymentPayload' is invalid` and names no field. The route is then
 * announced, discoverable, correctly priced — and impossible to pay.
 *
 * /v1/bic/:code sat at 616 characters and was unpayable for months. Real
 * settlement campaigns, an escalation to the CDP Discord and a GitHub issue
 * all missed it, because nothing in the error mentions the description.
 * Measured 17/08/2026: 616 rejected, 437 settles.
 */
export const MAX_RESOURCE_DESCRIPTION = 512;

/**
 * Last-resort guard, applied at the boundary rather than inside
 * `buildRouteTable`.
 *
 * 🚨 That placement is the whole point. Capping inside the builder made the
 * test that checks the limit tautological: it read a value the builder had
 * already truncated, so it passed with the 616-character description that
 * caused the outage. The table now carries what was written, the test judges
 * that, and this runs after — a truncated sentence is a far smaller loss than
 * a route nobody can pay, and the dataset figures inside these strings grow
 * on their own at each monthly refresh.
 */
export function capDescription(text: string): string {
  if (text.length <= MAX_RESOURCE_DESCRIPTION) return text;
  return text.slice(0, MAX_RESOURCE_DESCRIPTION - 1).trimEnd() + '…';
}

/**
 * The x402 route table: what each paid route costs, and what it tells a
 * catalog about itself.
 *
 * Exported, and taking the request as arguments rather than reading a Hono
 * context, so it can be built and inspected in a test. It used to live inside
 * the middleware closure behind a dynamic import of the SDK, which meant no
 * test could reach it — that is how a 616-character description shipped and
 * stayed for months.
 */
export function buildRouteTable(
  walletAddress: string,
  requestMethod: string,
  requestUrl: string,
): Record<string, unknown> {
  // Bazaar discoverability blocks per route — let x402 facilitators (Coinbase CDP, x402.org)
  // index our endpoints in their public catalog so AI agents discover IBANforge automatically.
  //
  // Trust signals appended to descriptions: production status, latency,
  // dataset size, last update. Agents that filter on description quality (Bazaar
  // semantic search, agentic.market) reward this.
  //
  // Two things were wrong here until 28/07/2026 and both are fixed by
  // construction rather than by editing numbers again:
  //
  //  1. The dataset figures were string literals, and they had drifted. The
  //     Swiss table holds 1,165 rows; three of these tags said "~1,200" and
  //     one said "1190+". They now come from datasetFacts(), rounded DOWN,
  //     so they stay true across a monthly refresh. CLAUDE.md forbids
  //     hardcoding them in a served surface; this is that rule applied.
  //  2. The latency claim said "p99 <50ms" with nothing saying what was
  //     measured. Server-side processing is 0.55 ms median (max 1.26 over 20
  //     production calls), but a client in Zurich observes p50 132 ms once
  //     the network is counted: the number was true of the handler and
  //     unobservable for any buyer. It now names the boundary it measures.
  //     One uniform bound replaces five per-endpoint ones that were never
  //     grounded in anything — a local benchmark puts the heaviest path
  //     (validate + enrich + compliance) at p99 0.184 ms.
  const V = `v${pkg.version}`;
  const F = datasetFacts();
  const PERF = 'server processing <5ms (network excluded — measure your own round trip on GET /ping)';
  const TRUST_TAG_VALIDATE = `Production · ${PERF} · ${F.claim.bic} BICs (${F.claim.lei} LEI via GLEIF) + ${F.claim.chClearing} SIX · ${V}`;
  const TRUST_TAG_BIC = `Production · ${PERF} · ${F.claim.bic} BICs (${F.claim.lei} LEI-enriched via GLEIF, refreshed monthly) · ${V}`;
  const TRUST_TAG_CH = `Production · ${PERF} · ${F.claim.chClearing} SIX BankMaster entries, refreshed monthly · ${V}`;
  const TRUST_TAG_COMPLIANCE = `Production · ${PERF} · OFAC + FATF + SEPA + VoP · weekly refresh · ${V}`;
  const TRUST_TAG_BATCH = `Production · ${PERF} for a 100-IBAN batch · ${F.claim.bic} BICs · ${V}`;

  const ibanInputSchema = {
    type: 'object',
    properties: {
      iban: {
        type: 'string',
        description: 'IBAN to validate. Spaces and lowercase accepted. Example: CH1000230000000012345',
        minLength: 15,
        maxLength: 34,
      },
    },
    required: ['iban'],
  };
  // Full-fidelity output schema: every field a real response carries.
  // Mirrors the real /v1/iban/validate response (verified against prod)
  // so agents can predict the response 1:1.
  const ibanOutputSchema = {
    type: 'object',
    properties: {
      iban: { type: 'string', description: 'Normalized IBAN (uppercase, no spaces).' },
      formatted: { type: 'string', description: 'IBAN with 4-char groups, e.g. CH10 0023 0000 0000 1234 5.' },
      valid: { type: 'boolean' },
      country: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'ISO 3166-1 alpha-2.' },
          name: { type: 'string' },
        },
      },
      check_digits: { type: 'string' },
      bban: {
        type: 'object',
        properties: {
          bank_code: { type: 'string' },
          branch_code: { type: 'string' },
          account_number: { type: 'string' },
        },
      },
      bic: {
        type: 'object',
        description: 'Resolved BIC/SWIFT (when BBAN→BIC mapping exists). Null when unresolved.',
        properties: {
          code: { type: 'string' },
          bank_name: { type: 'string' },
          city: { type: 'string' },
        },
      },
      issuer: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['bank', 'digital_bank', 'emi', 'payment_institution'] },
          name: { type: 'string' },
          classification: {
            type: 'string',
            enum: ['curated', 'register', 'default'],
            description:
              "curated = identified from the issuer set; register = an official register names the holder of this bank code (see psd_registration for its source and date); default = 'bank' fallback, 97.9% of BIC8.",
          },
        },
      },
      sepa: {
        type: 'object',
        properties: {
          member: { type: 'boolean' },
          schemes: { type: 'array', items: { type: 'string', enum: ['SCT', 'SDD', 'SCT_INST'] } },
          vop_required: {
            type: 'boolean',
            description: 'Verification of Payee (EU 2024/886) obligation for this country.',
          },
        },
      },
      risk_indicators: {
        type: 'object',
        description: 'AML/CFT pre-screening indicators.',
        properties: {
          issuer_type: {
            type: ['string', 'null'],
            enum: ['bank', 'digital_bank', 'emi', 'payment_institution', null],
            description: 'Null when no institution resolved. It no longer defaults to "bank" for an institution we did not find.',
          },
          country_risk: { type: 'string', enum: ['standard', 'elevated', 'high'] },
          test_bic: { type: 'boolean' },
          sepa_reachable: { type: 'boolean' },
          sepa_reachable_scope: {
            type: 'string',
            enum: ['country'],
            description: 'Scope sepa_reachable holds at. Derived from the country, never from the account.',
          },
          vop_coverage: { type: 'boolean' },
        },
      },
      bank_code_check: BANK_CODE_CHECK_OPENAPI,
      next_steps: NEXT_STEPS_OPENAPI,
      clearing: {
        type: 'object',
        description: 'Swiss clearing data when country is CH or LI and the IID is in the SIX BankMaster. Null otherwise.',
        properties: {
          iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
          name: { type: 'string' },
          type: {
            type: 'string',
            enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'],
          },
          town: { type: 'string' },
          sic: { type: 'boolean' },
          instant_payments_chf: { type: 'boolean' },
          eurosic: { type: 'boolean' },
          qr_iid: { type: 'string', description: 'QR-IID allocation, null when none.' },
        },
      },
      cost_usdc: { type: 'number' },
      processing_ms: { type: 'number' },
    },
  };

  const routes: Record<string, unknown> = {
    'POST /v1/iban/validate': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$0.005',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        `Validate a European IBAN and enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, a bank account, a SEPA payment or asks who the bank is. Returns: valid, country, BIC/SWIFT, bank name, EMI/vIBAN flag, SEPA + VoP reachability, risk score, Swiss bc_nummer for CH/LI. ${TRUST_TAG_VALIDATE}.`,
      mimeType: 'application/json',
      extensions: {
        bazaar: {
          discoverable: true,
          bodyType: 'json',
          inputSchema: ibanInputSchema,
          outputSchema: ibanOutputSchema,
          // `info` is filled from the shared discovery table below.
        },
      },
    },
    'POST /v1/iban/batch': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        // Dynamic price: $0.002 per IBAN, so a 1-IBAN call settles $0.002
        // (not the old flat $0.20 = 100× overcharge). x402 awaits this
        // function with the request context; we read the batch size from
        // the parsed body — see batchQuoteFor for why a body-less quote is the
        // 1-IBAN minimum and why the count must be read case-insensitively.
        price: async (context: { adapter?: { getBody?: () => unknown } }): Promise<string> => {
          try {
            return batchQuoteFor(await context.adapter?.getBody?.());
          } catch {
            // The body could not be read AT ALL. Unlike an empty body, this
            // tells us nothing about the batch size, so the cap is the only
            // safe quote: under-quoting here would serve 100 IBANs for one.
            return '$0.20';
          }
        },
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        `Validate up to 100 IBANs in one call at $0.002 per IBAN (2.5x cheaper per IBAN than single calls at $0.005, and one settlement instead of N). A quote asked for without a body is the 1-IBAN minimum, $0.002 — the same figure the catalog lists. Use for CSV cleanup, customer DB dedup, or pre-flight payout list triage. ${TRUST_TAG_BATCH}.`,
      mimeType: 'application/json',
      extensions: {
        bazaar: {
          discoverable: true,
          bodyType: 'json',
          inputSchema: {
            type: 'object',
            properties: {
              ibans: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                maxItems: 100,
                description: 'Array of 1 to 100 IBAN strings.',
              },
            },
            required: ['ibans'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              results: { type: 'array', items: ibanOutputSchema },
              count: { type: 'number', description: 'Total IBANs processed.' },
              valid_count: { type: 'number', description: 'Number of valid IBANs.' },
              cost_usdc: { type: 'number', description: 'Actual USDC charged for this call.' },
            },
          },
        },
      },
    },
    'GET /v1/bic/:code': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$0.003',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        `Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank: name, country, city, LEI, and registered head-office address (where available). Use only when you already have the BIC — for IBAN inputs, prefer /v1/iban/validate which resolves the BIC for you. ${TRUST_TAG_BIC}.`,
      mimeType: 'application/json',
      extensions: {
        bazaar: {
          discoverable: true,
          pathParams: {
            code: { type: 'string', description: 'BIC/SWIFT code (8 or 11 alphanumeric).' },
          },
          outputSchema: {
            type: 'object',
            properties: {
              bic: { type: 'string' },
              bic8: { type: 'string' },
              bic11: { type: 'string' },
              found: { type: 'boolean' },
              valid_format: { type: 'boolean' },
              institution: { type: 'string' },
              country: {
                type: 'object',
                properties: { code: { type: 'string' }, name: { type: 'string' } },
              },
              city: { type: 'string' },
              lei: { type: 'string' },
              address: {
                type: 'object',
                description:
                  'Registered/head-office address (GLEIF, CC0). Entity-level, not per-branch; null for branch or non-LEI BICs. Non-Latin addresses (Chinese, Arabic, Greek…) carry an official Latin reading in `romanized` only when GLEIF provides one; otherwise `romanization` is "unavailable" and we never fabricate a transliteration.',
                properties: {
                  street: { type: 'string' },
                  post_code: { type: 'string' },
                  region: { type: 'string' },
                  city: { type: 'string' },
                  country: { type: 'string' },
                  romanized: {
                    type: 'string',
                    description:
                      "Latin reading: GLEIF's official English address for non-Latin entities, or the address itself when already Latin. Null when no official Latin form exists (never fabricated).",
                  },
                  romanization: {
                    type: 'string',
                    enum: ['original_latin', 'gleif_english', 'unavailable'],
                    description:
                      'Provenance of the Latin reading: original_latin | gleif_english | unavailable (non-Latin entity with no official Latin form — not transliterated).',
                  },
                  source: { type: 'string' },
                },
              },
              address_available: { type: 'boolean' },
            },
          },
        },
      },
    },
    'POST /v1/iban/compliance': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$0.02',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        `Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. ${TRUST_TAG_COMPLIANCE}.`,
      mimeType: 'application/json',
      extensions: {
        bazaar: {
          discoverable: true,
          bodyType: 'json',
          inputSchema: ibanInputSchema,
          // Real response = full /v1/iban/validate enrichment + a nested
          // `compliance` object + `meta` provenance block (verified against prod).
          outputSchema: {
            type: 'object',
            properties: {
              iban: { type: 'string' },
              valid: { type: 'boolean' },
              country: {
                type: 'object',
                properties: { code: { type: 'string' }, name: { type: 'string' } },
              },
              bic: {
                type: 'object',
                properties: { code: { type: 'string' }, bank_name: { type: 'string' }, city: { type: 'string' } },
              },
              compliance: {
                type: 'object',
                properties: {
                  sanctions: {
                    type: 'object',
                    properties: {
                      country_sanctioned: { type: 'boolean' },
                      bank_sanctioned: { type: 'boolean' },
                      matched_lists: { type: 'array', items: { type: 'string' } },
                      fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'non_member'] },
                    },
                  },
                  reachability: {
                    type: 'object',
                    properties: {
                      sepa_instant: { type: 'boolean' },
                      sct: { type: 'boolean' },
                      sdd: { type: 'boolean' },
                    },
                  },
                  vop: {
                    type: 'object',
                    properties: {
                      participant: { type: 'boolean' },
                      status: { type: 'string', enum: ['active', 'pending', 'inactive', 'not_found'] },
                    },
                  },
                  risk_score: {
                    type: ['number', 'null'],
                    minimum: 0,
                    maximum: 100,
                    description: 'null when the IBAN did not validate: there was nothing to score.',
                  },
                  risk_level: {
                    type: 'string',
                    enum: ['low', 'medium', 'elevated', 'high', 'critical', 'unassessable'],
                    description:
                      'unassessable = the IBAN failed validation, no screening was possible. Never treat it as low.',
                  },
                  flags: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Risk flags, e.g. sanctioned_country, sanctioned_bank, fatf_grey_list, emi_issuer, test_bic, no_sepa_instant, no_vop.',
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  scope: { type: 'string' },
                  disclaimer: { type: 'string' },
                  sanctions_as_of: { type: 'string' },
                  fatf_as_of: { type: 'string' },
                  country_risk_as_of: {
                    type: 'string',
                    description:
                      'Year-month the editorial country-risk axis was last reviewed. risk_indicators.country_risk is a SEPARATE axis layered on top of fatf_status, not a restatement of it: the two can disagree on a country by design.',
                  },
                  country_risk_scope: { type: 'string' },
                  sources: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    // -- Bundle credits ----------------------------------------------------
    // 3 prepaid bundles. Once the agent pays, the handler in
    // src/routes/api-keys.ts mints a fresh key with N credits.
    // Pricing is: 1k=$5 (0.005/credit), 5k=$20 (0.004/credit), 25k=$80 (0.0032/credit).
    'POST /v1/credits/buy/1k': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$5.00',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        'Prepaid bundle of 1,000 credits for AI agents — 1 credit = 1 validation/lookup, batch validation debits 1 credit per IBAN. Same per-credit cost as retail (0.005 USDC) but only ONE x402 settlement instead of 1,000 — most agent stacks handle a single payment far better than micropayments. Returns ifk_xxx key with 1,000 credits valid for any /v1/iban/* or /v1/bic/* endpoint. No expiry.',
      mimeType: 'application/json',
      extensions: {
        bazaar: {
          discoverable: true,
          bodyType: 'json',
          inputSchema: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Optional. Anonymous keys work too.' },
            },
          },
          outputSchema: {
            type: 'object',
            properties: {
              api_key: { type: 'string' },
              key_prefix: { type: 'string' },
              credits: { type: 'number' },
              price_paid_usdc: { type: 'number' },
              usage_hint: { type: 'string' },
            },
          },
          info: {
            input: { type: 'http', method: 'POST', bodyType: 'json', body: {}, discoverable: true },
            output: { type: 'json' },
          },
        },
      },
    },
    'POST /v1/credits/buy/5k': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$20.00',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        'Prepaid bundle of 5,000 credits (-20% vs retail, 0.004 USDC per credit; batch validation debits 1 credit per IBAN). One x402 settlement, no monthly subscription, no expiry. Fits a mid-volume agent that runs payment validation continuously.',
      mimeType: 'application/json',
      extensions: {
        bazaar: { discoverable: true, bodyType: 'json' },
      },
    },
    'POST /v1/credits/buy/25k': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$80.00',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        'Prepaid bundle of 25,000 credits (-36% vs retail, 0.0032 USDC per credit; batch validation debits 1 credit per IBAN). One x402 settlement, no expiry. Designed for scale agents (KYB, payroll, batch reconciliation) that want predictable cost.',
      mimeType: 'application/json',
      extensions: {
        bazaar: { discoverable: true, bodyType: 'json' },
      },
    },
    'GET /v1/ch/clearing/:iid': {
      accepts: {
        scheme: 'exact',
        network: 'eip155:8453' as const,
        price: '$0.003',
        payTo: walletAddress,
        maxTimeoutSeconds: 60,
      },
      description:
        `Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, address, BIC, the full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) and the QR-IID allocation. Backed by ${F.claim.chClearing} SIX BankMaster entries (refreshed monthly) — the canonical Swiss banking source. ${TRUST_TAG_CH}.`,
      mimeType: 'application/json',
      extensions: {
        bazaar: {
          discoverable: true,
          pathParams: {
            iid: { type: 'string', description: 'Swiss IID / BC-Nummer (1-5 digits).' },
          },
          // Mirrors the real /v1/ch/clearing/:iid response (verified against prod).
          outputSchema: {
            type: 'object',
            properties: {
              iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
              found: { type: 'boolean' },
              institution: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'] },
                  iid_type: { type: 'string', enum: ['headquarters', 'branch', 'other'] },
                  headquarters_iid: { type: 'string' },
                },
              },
              address: {
                type: 'object',
                properties: {
                  street: { type: 'string' },
                  building_number: { type: 'string' },
                  post_code: { type: 'string' },
                  town: { type: 'string' },
                  country: { type: 'string' },
                },
              },
              bic: { type: 'string', description: 'BIC if mapped.' },
              payment_services: {
                type: 'object',
                properties: {
                  sic: { type: 'boolean', description: 'Swiss Interbank Clearing.' },
                  rtgs_chf: { type: 'boolean' },
                  instant_payments_chf: { type: 'boolean' },
                  eurosic: { type: 'boolean' },
                  lsv_bdd_chf: { type: 'boolean' },
                  lsv_bdd_eur: { type: 'boolean' },
                },
              },
              sic_iid: { type: 'string' },
              qr_iid: { type: 'string', description: 'QR-IID allocation, null when none.' },
              valid_on: { type: 'string' },
            },
          },
        },
      },
    },
  };

  // Every route gets the same three things, derived from its key rather
  // than repeated eight times, so a route added later cannot forget them.
  //
  // `resource` is the one that matters. Without it the SDK falls back to
  // adapter.getUrl(), which is `c.req.url` — and Railway terminates TLS
  // then forwards over plain HTTP, so the v2 PAYMENT-REQUIRED header went
  // out announcing `http://api.ibanforge.com/...`. That is verbatim the
  // string Coinbase's own validator rejected on 14/08/2026: "discovery
  // request validation failed: resource must start with 'https://' when
  // protocol type is http". The 14/08 pass checked the v1 body's
  // accepts[0].resource, which was https, and never decoded the header.
  //
  // It advertises the URL actually requested, never the `:code` template.
  // Catalog grouping does not need the template here — the Bazaar
  // extension emits its own `routeTemplate` field — and a template in a
  // field agents treat as callable has already cost us: the discovery
  // document listed /v1/bic/:code, agents called it literally, the route
  // read ":code" as a BIC and answered 400, and two of five priced
  // resources were unbuyable from May to 30/07/2026.
  const SERVICE_NAME = 'IBANforge'; // max 32 chars, printable ASCII (SDK schema)
  const TAGS = ['iban', 'bic', 'sepa', 'compliance', 'banking']; // max 5, 32 chars each
  const ICON_URL = 'https://ibanforge.com/logo.svg';
  const requestPath = requestUrl;

  for (const [key, config] of Object.entries(routes)) {
    const [routeMethod, routeTemplate] = key.split(' ');
    // Only the matching route's config is ever consulted, but resolving it
    // per route keeps every entry describing itself truthfully.
    const isCurrent = routeMethod === requestMethod && routeTemplateOf(requestPath) === routeTemplate;
    const path = isCurrent ? requestPath : routeTemplate;
    const entry = config as { extensions?: { bazaar?: Record<string, unknown> } } & Record<string, unknown>;
    Object.assign(entry, {
      resource: `https://api.ibanforge.com${path}`,
      serviceName: SERVICE_NAME,
      tags: TAGS,
      iconUrl: ICON_URL,
    });
    // How to call the route and what a real answer looks like, from the
    // shared table so the header and the 402 body cannot disagree.
    const discovery = discoveryForRoute(key);
    if (discovery && entry.extensions?.bazaar) {
      entry.extensions.bazaar.info = buildBazaarInfo(discovery);
    }
  }

  // Piste A — the "universal 402". A trust-registry crawler probes a resource
  // with a bare GET; on our POST routes that fell through to Hono's 405, read as
  // "does not speak x402" → Aegis "treat with caution". Expose a synthetic entry
  // for the probe's method, cloned from the canonical route (already enriched
  // above) so the 402 still announces the REAL method and price. Done after the
  // enrichment loop on purpose: the clone inherits the canonical bazaar.info
  // (input.method: POST), which a fresh discoveryForRoute() on the synthetic key
  // could not provide.
  //   Safe against accidental capture: a GET carrying a payment reaches no
  //   handler (405), and @x402/hono settles only a response < 400 (settle-after-
  //   2xx, verified in its source) — so nothing is ever charged for a method we
  //   do not serve. Selling routes are excluded: a probe must never be quoted
  //   the purchase flow. Only static paths qualify (param routes are GET and a
  //   bare probe already method-matches them).
  const canonicalKey = Object.keys(routes).find((k) => {
    const sp = k.indexOf(' ');
    const km = k.slice(0, sp);
    const kp = k.slice(sp + 1);
    return kp === requestPath && km !== requestMethod && !kp.includes(':') && !isSellingRoute(km, kp);
  });
  if (canonicalKey) {
    const synthKey = `${requestMethod} ${requestPath}`;
    if (!routes[synthKey]) routes[synthKey] = routes[canonicalKey];
  }
  return routes;
}

// ─── The paywall, built once ─────────────────────────────────────────────────
//
// Until 20/08/2026 everything below — four dynamic imports, an
// HTTPFacilitatorClient, an x402ResourceServer, and `paymentMiddleware()` —
// was rebuilt inside the handler, on EVERY request under /v1/*. Two costs, one
// of them fatal:
//
//  1. `paymentMiddleware()` fires `httpServer.initialize()` — a
//     `GET {facilitator}/supported` — from its constructor. So every anonymous
//     request amplified 1:1 into an outbound call to Coinbase (audit A2 §C1.3).
//  2. On a route that requires no payment the SDK returns `next()` without ever
//     awaiting that promise. When the facilitator was unreachable the rejection
//     had no handler, and Node 22 kills the process for an unhandled rejection
//     — after which Railway gives up at 3 restarts. A CDP outage therefore took
//     the whole service down, paying API-key holders included (audit A2 §C1.1).
//
// The facilitator client and the resource server are now created once and
// reused; the facilitator handshake happens once, lazily, and ONLY on a request
// that actually needs a quote. Two things are deliberately NOT hoisted:
//
//  - The route table stays per-request. It has to: `resource` must announce the
//    URL actually requested (a `:code` template published as callable already
//    cost us two unbuyable routes), and the synthetic "universal 402" entry for
//    a mismatched-method probe is derived from the request.
//  - The handshake is not awaited at boot, nor on free routes. Awaiting it at
//    boot would turn a facilitator outage into a 503 on `/v1/iban/format` —
//    trading a crash for an outage on routes that never needed CDP at all.
type HonoX402Module = typeof import('@x402/hono');
type CoreServerModule = typeof import('@x402/core/server');
type ResourceServer = InstanceType<CoreServerModule['x402ResourceServer']>;
type HTTPResourceServer = InstanceType<CoreServerModule['x402HTTPResourceServer']>;
type RoutesArg = ConstructorParameters<CoreServerModule['x402HTTPResourceServer']>[1];

interface X402Paywall {
  hono: HonoX402Module;
  core: CoreServerModule;
  server: ResourceServer;
  /** True once `GET /supported` has succeeded for this server. */
  facilitatorSynced: boolean;
  /** In-flight handshake, shared by concurrent requests; cleared on failure. */
  facilitatorSync: Promise<void> | null;
}

/**
 * Keyed by the configuration it was built from, so a change of wallet or
 * facilitator (tests, a rotated CDP key read from a fresh env) rebuilds instead
 * of silently serving a stale payee.
 */
let paywallCache: { signature: string; promise: Promise<X402Paywall> } | null = null;

function paywallSignature(walletAddress: string): string {
  return [
    walletAddress,
    process.env.CDP_API_KEY_ID ?? '',
    // The secret itself never goes into a cache key — only whether one is set.
    process.env.CDP_API_KEY_SECRET ? 'cdp' : '',
    process.env.FACILITATOR_URL ?? '',
  ].join('|');
}

// ─── Facilitator timeouts ────────────────────────────────────────────────────
//
// `HTTPFacilitatorClient` issues its three calls with a bare `fetch` — no
// `signal`, no timeout, and no way to pass one: its constructor reads only
// `url` and `createAuthHeaders` (verified in @x402/core's bundle). The
// effective ceiling is therefore undici's, ~300 s. A facilitator that accepts
// the connection and then says nothing makes a PAID request hang for five
// minutes, and the v2 settle is blocking before the response leaves, so the
// buyer waits for verify + handler + settle (audit A2 §C1.2).
//
// We cannot abort the underlying socket without forking the SDK, so we bound
// the WAIT instead of the connection: the call races a timer, and the loser is
// abandoned. That leaves at most one dangling socket per timed-out call for the
// rest of undici's own timeout — a bounded leak, traded against a request path
// that can no longer hang for minutes.
//
// 🚨 The abandoned promise MUST keep a handler. An unobserved rejection is
// exactly what killed the process on 20/08 (§C1.1) and burned Railway's three
// restarts; a "fix" for a hang that reintroduces that crash is a net loss.
//
// ─── Why every default is under eight seconds ────────────────────────────────
//
// A budget only bounds a hang while the process is alive to enforce it. At
// SIGTERM `gracefulShutdown` drains in-flight requests for DRAIN_TIMEOUT_MS =
// 8_000 (`src/index.ts:111`) and then cuts what is left. A settle budget of
// 30 s was therefore unreachable at exactly the moment it mattered most: the
// socket was severed at 8 s and the buyer got NOTHING: no receipt, no error,
// no way to tell a refusal from a redeploy. A clear "we do not know" beats a
// dropped connection, so each default leaves the failure response ~2 s of the
// drain window to be serialized and flushed before the deadline closes it.
//
// The earlier reasoning for a generous settle is preserved, not discarded, and
// it is the reason settle stays the most generous of the three: every route
// announces `maxTimeoutSeconds: 60`, and giving up on a settle the facilitator
// is still processing means the buyer may be charged for an answer we then
// cannot confirm. An operator who would rather wait than answer "unknown"
// raises X402_SETTLE_TIMEOUT_MS, knowing that any value above the drain is
// only honoured while no shutdown is in progress.
const FACILITATOR_TIMEOUT_DEFAULTS = {
  /** Handshake. Off the paid path (see syncFacilitator) but must not wedge it. */
  supported: 5_000,
  /** Before the handler runs. Nothing has been served, so failing fast is free. */
  verify: 5_000,
  /** After the handler ran, and money may already be moving. See above. */
  settle: 6_000,
} as const;

type FacilitatorOperation = keyof typeof FACILITATOR_TIMEOUT_DEFAULTS;

const FACILITATOR_TIMEOUT_ENV: Record<FacilitatorOperation, string> = {
  supported: 'X402_SUPPORTED_TIMEOUT_MS',
  verify: 'X402_VERIFY_TIMEOUT_MS',
  settle: 'X402_SETTLE_TIMEOUT_MS',
};

/**
 * The budget for one facilitator call, read from the environment at call time.
 *
 * Read lazily, never memoized into a module constant: the defaults must hold
 * with no configuration at all (the service starts on a bare env), and a test
 * that stubs the variable must not be racing a value frozen at import.
 *
 * 🚨 Anything that is not a finite, strictly positive number falls back to the
 * default. This is a money path and `setTimeout(NaN)` fires IMMEDIATELY, so a
 * typo in a Railway variable would otherwise turn every settle into an instant
 * timeout, which is the one failure this whole block exists to avoid.
 */
export function facilitatorTimeoutMs(operation: FacilitatorOperation): number {
  const fallback = FACILITATOR_TIMEOUT_DEFAULTS[operation];
  const raw = process.env[FACILITATOR_TIMEOUT_ENV[operation]];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[x402] ${FACILITATOR_TIMEOUT_ENV[operation]}=${raw} is not a positive number of milliseconds. Using ${fallback}ms.`,
    );
    return fallback;
  }
  return parsed;
}

export class FacilitatorTimeoutError extends Error {
  constructor(operation: string, ms: number) {
    super(`Facilitator ${operation} did not answer within ${ms}ms`);
    this.name = 'FacilitatorTimeoutError';
  }
}

/**
 * Bound one facilitator call. The losing promise is silenced, never dropped.
 */
export function withFacilitatorTimeout<T>(
  call: Promise<T>,
  operation: FacilitatorOperation,
): Promise<T> {
  const ms = facilitatorTimeoutMs(operation);
  // Attached BEFORE the race: if the SDK call rejects after we stopped waiting,
  // this is the handler that keeps Node from killing the process.
  call.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FacilitatorTimeoutError(operation, ms)), ms);
    // Never hold the event loop open on our own accounting.
    timer.unref?.();
  });
  return Promise.race([call, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// ─── A settlement we could not confirm is UNKNOWN, never refused ─────────────
//
// When `processSettlement` throws something that is not a FacilitatorResponseError
// the SDK logs it and answers a bare `402 {}` (@x402/hono, the catch around
// processSettlement). For a REFUSAL that is right. For our timeout it is the
// same lie the compliance side spent 21/08 removing: `screenBicSanctions`
// answers `listed: null` and never `listed: false`, because a screen that could
// not run must not read as a clean one. A settle we stopped waiting on is a
// settlement whose outcome we do not know (the payment may well be on-chain)
// and `402` states the opposite of that: "payment required".
//
// 🚨 402 is not merely imprecise here, it is the dangerous answer. An x402
// client treats 402 as the signal to attach a payment and retry, so answering
// 402 to a buyer who may already have paid is an invitation to pay twice. The
// honest answer is 5xx: the FACILITATOR failed us, the caller did nothing
// wrong, and nothing about it tells an agent to re-send money. 502 is the code
// this same file already gives a facilitator that answered badly on the
// handshake, so the two failure modes stay consistent.
//
// The flag has to be request-scoped: the facilitator client is memoized for the
// whole process, so a module-level boolean would leak one request's timeout
// onto another's response under concurrency.
export interface SettlementSlot {
  unconfirmed: FacilitatorTimeoutError | null;
}
const settlementSlot = new AsyncLocalStorage<SettlementSlot>();

/**
 * Test seam for the one link that has no other observable effect: the
 * AsyncLocalStorage context must survive from the `run()` below, through the
 * SDK's awaits, into the settle wrapper in `boundFacilitator`. If it does not,
 * `getStore()` returns undefined, the flag never sets, and the buyer silently
 * receives the SDK's bare 402 while every unit test on the body builder stays
 * green. Exercised by x402.test.ts against a fake facilitator.
 */
export function runInSettlementSlot<T>(fn: () => T): { slot: SettlementSlot; out: T } {
  const slot: SettlementSlot = { unconfirmed: null };
  const out = settlementSlot.run(slot, fn);
  return { slot, out };
}

/**
 * The body served when a settlement's outcome is unknown.
 *
 * Mirrors the shape of `screenBicSanctions`: a `*_received: false` that says
 * the check did not happen, and the claim itself left `null` rather than
 * `false`. `paid: false` here would assert the buyer was not charged, which is
 * exactly what we do not know.
 */
export function unconfirmedSettlementBody(
  err: FacilitatorTimeoutError,
  ms: number,
  recoveryRef?: string | null,
): {
  error: string;
  message: string;
  settlement: { confirmation_received: false; paid: null; authoritative: false; timeout_ms: number };
  recovery_url?: string;
  recovery_note?: string;
} {
  return {
    error: 'settlement_unconfirmed',
    message:
      `The payment facilitator did not confirm settlement within ${ms}ms. ` +
      'Your payment may or may not have settled on-chain: this is not a refusal, and it is not a receipt. ' +
      'Do NOT re-send the payment before checking whether the transfer reached the payTo address, ' +
      'or you may be charged twice.',
    settlement: {
      // The confirmation never arrived...
      confirmation_received: false,
      // ...so we make no claim either way. Never `false`.
      paid: null,
      // Nothing on-chain was observed to back this answer.
      authoritative: false,
      timeout_ms: ms,
    },
    // 🚨 On a route that SELLS a pack, the handler already minted the key before
    // settle ran, and its response carried the one-time recovery URL. This 502
    // replaces that response, so without the line below we would destroy the
    // very recovery path the buyer needs precisely in the case where they may
    // have paid. The ref is the same digest credits-buy.ts computes, so the
    // recovery endpoint answers to it unchanged.
    ...(recoveryRef
      ? {
          recovery_url: `https://api.ibanforge.com/v1/credits/recover/${recoveryRef}`,
          recovery_note:
            'If your payment did settle, the key it bought already exists. Fetch it ONCE at recovery_url. ' +
            'Buying again would pay a second time for a pack you may already own.',
        }
      : {}),
  };
}

/** The same client, with each of its three calls bounded in time. */
export function boundFacilitator<T extends { verify: unknown; settle: unknown; getSupported: unknown }>(
  client: T,
): T {
  const verify = client.verify as (...args: unknown[]) => Promise<unknown>;
  const settle = client.settle as (...args: unknown[]) => Promise<unknown>;
  const getSupported = client.getSupported as (...args: unknown[]) => Promise<unknown>;
  // Own properties, so the prototype methods stay intact for anything the SDK
  // reaches for that we did not wrap (createAuthHeaders, toJsonSafe, url…).
  return Object.assign(client, {
    verify: (...args: unknown[]) => withFacilitatorTimeout(verify.apply(client, args), 'verify'),
    settle: (...args: unknown[]) =>
      withFacilitatorTimeout(settle.apply(client, args), 'settle').catch((err: unknown) => {
        // Record, then rethrow untouched: the SDK still runs its own failure
        // path, we only remember WHY it is about to answer 402.
        if (err instanceof FacilitatorTimeoutError) {
          const slot = settlementSlot.getStore();
          if (slot) slot.unconfirmed = err;
        }
        throw err;
      }),
    getSupported: (...args: unknown[]) =>
      withFacilitatorTimeout(getSupported.apply(client, args), 'supported'),
  });
}

// The wallet is NOT baked in here: prices and payTo are resolved per request by
// buildRouteTable, so the shared server stays request-agnostic.
async function buildPaywall(): Promise<X402Paywall> {
  const hono = await import('@x402/hono');
  const core = await import('@x402/core/server');
  const { ExactEvmScheme } = await import('@x402/evm/exact/server');
  const { bazaarResourceServerExtension } = await import('@x402/extensions');

  const cdpKeyId = process.env.CDP_API_KEY_ID;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET;

  let facilitatorClient: InstanceType<CoreServerModule['HTTPFacilitatorClient']>;
  if (cdpKeyId && cdpKeySecret) {
    const { createFacilitatorConfig } = await import('@coinbase/x402');
    facilitatorClient = new core.HTTPFacilitatorClient(createFacilitatorConfig(cdpKeyId, cdpKeySecret));
  } else {
    facilitatorClient = new core.HTTPFacilitatorClient({
      url: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
    });
  }

  // Build x402 resource server with EVM scheme (like official example)
  const server = new core.x402ResourceServer(boundFacilitator(facilitatorClient));
  server.register('eip155:*', new ExactEvmScheme());
  // Register the Bazaar discovery extension so each route ships its
  // inputSchema/outputSchema to facilitator catalogs (Coinbase CDP, x402.org)
  // and AI agents can find IBANforge automatically.
  server.registerExtension(bazaarResourceServerExtension);

  return { hono, core, server, facilitatorSynced: false, facilitatorSync: null };
}

function getPaywall(walletAddress: string): Promise<X402Paywall> {
  const signature = paywallSignature(walletAddress);
  const cached = paywallCache;
  if (cached && cached.signature === signature) return cached.promise;
  const promise = buildPaywall().catch((err: unknown) => {
    // Never cache a failure: the next request must be free to try again.
    if (paywallCache?.signature === signature) paywallCache = null;
    throw err;
  });
  paywallCache = { signature, promise };
  return promise;
}

/**
 * The facilitator handshake, run at most once per process.
 *
 * `x402HTTPResourceServer.initialize()` fetches the supported payment kinds
 * into the SHARED resource server and validates this request's route table
 * against them — the exact call the SDK used to make from every
 * `paymentMiddleware()` construction. On failure the latch is cleared so the
 * next paid request retries, which is the SDK's own behaviour.
 */
async function syncFacilitator(paywall: X402Paywall, httpServer: HTTPResourceServer): Promise<void> {
  if (paywall.facilitatorSynced) return;
  if (!paywall.facilitatorSync) {
    paywall.facilitatorSync = httpServer.initialize().then(
      () => {
        paywall.facilitatorSynced = true;
      },
      (err: unknown) => {
        paywall.facilitatorSync = null;
        throw err;
      },
    );
  }
  await paywall.facilitatorSync;
}

/**
 * Test seam: drop the memoized paywall so the next request rebuilds it.
 * Used by src/app.test.ts, which swaps facilitators between cases.
 */
export function resetX402Paywall(): void {
  paywallCache = null;
}

export function createX402Middleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    // Dev bypass
    if (
      process.env.NODE_ENV === 'development' &&
      c.req.header('X-Dev-Skip') === 'true'
    ) {
      await next();
      return;
    }

    const isProd = process.env.NODE_ENV === 'production';
    const explicitFreeMode = process.env.IBANFORGE_FREE_MODE === 'true';
    const x402Enabled = process.env.X402_ENABLED === 'true';

    // Skip x402 if authenticated via API key (free tier inside the quota) —
    // EXCEPT on the routes that SELL credits. An API key is a way to spend an
    // allowance, never a way to acquire one: without this guard a free key
    // (200 req/month) buys 200 bundles, i.e. up to $16,000 of credits for one
    // unit of quota, and each minted key can start over.
    // Security audit 2026-07-25, finding 1.
    if (c.get('apiKeyAuthenticated') && !isSellingRoute(c.req.method, new URL(c.req.url).pathname)) {
      await next();
      return;
    }

    // Free mode (dev/test, or explicit prod opt-in) — all paid endpoints are free
    if (!x402Enabled) {
      if (isProd && !explicitFreeMode) {
        // Defense in depth: if boot-time validation was bypassed somehow,
        // refuse to serve paid endpoints rather than fail-open.
        return c.json(
          { error: 'Payment system misconfigured. Please contact support.' },
          503,
        );
      }
      await next();
      return;
    }

    const walletAddress = process.env.WALLET_ADDRESS;
    if (!walletAddress) {
      if (isProd) {
        return c.json(
          { error: 'Payment system misconfigured. Please contact support.' },
          503,
        );
      }
      await next();
      return;
    }

    try {
      // Memoized: four dynamic imports, the facilitator client and the resource
      // server, built on the first request under /v1/* and reused after that.
      const paywall = await getPaywall(walletAddress);

      const routes = buildRouteTable(walletAddress, c.req.method, new URL(c.req.url).pathname);
      // The safety net, run once on the way out. See capDescription: it must
      // NOT live inside the builder, or the test that enforces the limit ends
      // up reading its own correction.
      for (const config of Object.values(routes)) {
        const entry = config as { description?: string };
        if (typeof entry.description === 'string') entry.description = capDescription(entry.description);
      }

      const httpServer = new paywall.core.x402HTTPResourceServer(paywall.server, routes as RoutesArg);
      const context = {
        adapter: new paywall.hono.HonoAdapter(c),
        path: c.req.path,
        method: c.req.method,
      };

      // Answered by the SDK's own matcher on the SDK's own route table, so this
      // cannot drift from what the paywall would have decided a line later.
      if (!httpServer.requiresPayment(context)) {
        await next();
        return;
      }

      // Only a request that will actually be quoted may wait on the
      // facilitator. This is the line that keeps a CDP outage off the free
      // routes instead of spreading it to them.
      try {
        await syncFacilitator(paywall, httpServer);
      } catch (err) {
        // Same triage the SDK applies to its own boot sync: a facilitator that
        // ANSWERED badly is a 502 naming the reason; anything else falls
        // through to the 503 below.
        const facilitatorError = paywall.core.getFacilitatorResponseError(err);
        if (facilitatorError) return c.json({ error: facilitatorError.message }, 502);
        throw err;
      }

      // `false` = do not let the SDK run its own facilitator sync: we just did
      // it, once, above. This is the parameter whose default fired the
      // detached `GET /supported` from every construction.
      const middleware = paywall.hono.paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false);

      // Run the paywall inside a request-scoped slot so a settle that timed out
      // can be told apart from a settle that was refused. Both leave the SDK
      // answering `402 {}`; only one of them means "we do not know".
      const slot: SettlementSlot = { unconfirmed: null };
      const outcome = await settlementSlot.run(slot, () => middleware(c, next));
      if (!slot.unconfirmed) return outcome;

      // Replace the SDK's bare 402. Clearing c.res first is the SDK's own idiom
      // and it matters: Hono's `res` setter copies headers from the response it
      // replaces, and the 402 carries none we want to keep.
      const ms = facilitatorTimeoutMs('settle');
      console.error(
        `[x402] Settlement outcome unknown after ${ms}ms. Answering 502, not 402. ` +
          'The payment may have settled on-chain; it must not be re-requested blindly.',
        slot.unconfirmed.message,
      );
      // Only a SELLING route mints something recoverable. On a per-call paid
      // route nothing was created, so there is nothing to point the buyer at.
      const recoveryRef = isSellingRoute(c.req.method, new URL(c.req.url).pathname)
        ? settlementRef(c)
        : null;
      const body = JSON.stringify(unconfirmedSettlementBody(slot.unconfirmed, ms, recoveryRef));
      c.res = undefined;
      c.res = new Response(body, {
        status: 502,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
      });
      return;
    } catch (err) {
      console.error('[x402] Middleware error:', err);
      if (process.env.NODE_ENV === 'production') {
        return c.json(
          { error: 'Payment system unavailable. Please try again later.' },
          503,
        );
      }
      await next();
    }
  };
}
