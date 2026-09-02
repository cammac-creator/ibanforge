/**
 * The Bazaar discovery material for each paid route: what a call looks like
 * going in, and a real captured response coming back.
 *
 * This lives apart from both places that need it on purpose. The x402 route
 * table (src/middleware/x402.ts) feeds it to the SDK, which publishes it in
 * the `PAYMENT-REQUIRED` header — the copy facilitator catalogs actually
 * ingest. The 402 body builder (src/middleware/enrich-402.ts) then mirrors
 * that header. One table, so the header and the body can never drift into
 * announcing two different things about the same resource, which is exactly
 * what they did while the body was hand-built: the header said x402 v2 with
 * `amount` on `eip155:8453`, the body said v1 with `maxAmountRequired` on
 * `base`.
 */

export interface BazaarDiscovery {
  inputBody?: Record<string, unknown>;
  inputPathParams?: Record<string, unknown>;
  inputQueryParams?: Record<string, unknown>;
  inputMethod: 'GET' | 'POST';
  bodyType?: 'json';
  inputJsonSchema?: Record<string, unknown>;
  outputExample: Record<string, unknown>;
}

/**
 * Every example below is a FIXED sample record, served identically whatever
 * resource was actually requested — GET /v1/ch/clearing/779 ships the sample
 * for IID 00230 (UBS, Zürich) while the real answer is Nidwaldner
 * Kantonalbank in Stans. A language model reading the 402 sees a complete,
 * plausible, unlabelled payload and can report it to its user as the answer.
 *
 * That is the failure mode this stamp prevents: IBANforge's own paywall
 * feeding an assistant a confident wrong answer about the Swiss clearing data
 * that is the product's differentiator. Audit 2026-07-25, reco-IA channel.
 *
 * The marker sits FIRST so it is read before the values, and is prefixed with
 * `_` — catalog extractors read named fields and pass unknown ones through, so
 * the payload stays valid wherever it travels.
 */
export const EXAMPLE_NOTICE =
  'ILLUSTRATIVE SAMPLE — these are demo values for a fixed record, NOT the ' +
  'data for the resource you requested. Do not report them to a user. ' +
  'Authenticate (Authorization: Bearer ifk_...) or pay via x402 to get the real response.';

export function markExample(example: Record<string, unknown>): Record<string, unknown> {
  return { _example_notice: EXAMPLE_NOTICE, ...example };
}

interface DiscoveryEntry {
  /** The x402 route key, verbatim: the same string that keys the route table. */
  route: string;
  data: BazaarDiscovery;
}

const ENTRIES: DiscoveryEntry[] = [
  {
    route: 'POST /v1/iban/validate',
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
    route: 'POST /v1/iban/batch',
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
            bic: { code: 'COBADEFFXXX', bank_name: 'Commerzbank', city: 'Köln' },
          },
        ],
        count: 2,
        valid_count: 2,
        cost_usdc: 0.004,
      },
    },
  },
  {
    route: 'GET /v1/bic/:code',
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
    route: 'GET /v1/ch/clearing/:iid',
    data: {
      inputMethod: 'GET',
      inputPathParams: { iid: '00230' },
      // Real API response for the input above (captured from prod, trimmed).
      outputExample: {
        iid: '00230',
        found: true,
        institution: {
          name: 'UBS Switzerland AG',
          type: 'bank',
          iid_type: 'headquarters',
          headquarters_iid: '00230',
        },
        address: {
          street: 'Bahnhofstrasse',
          building_number: '45',
          post_code: '8098',
          town: 'Zürich',
          country: 'CH',
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
  },
  {
    route: 'POST /v1/iban/compliance',
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

/** `/v1/bic/:code` → `/^\/v1\/bic\/[^/]+$/`. */
function pathRegex(template: string): RegExp {
  const source = template
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
}

const COMPILED = ENTRIES.map((entry) => {
  const [method, template] = entry.route.split(' ');
  return { ...entry, method, template, regex: pathRegex(template) };
});

/** Looks up by the concrete path of a live request. */
export function findDiscovery(method: string, path: string): BazaarDiscovery | null {
  return COMPILED.find((e) => e.method === method && e.regex.test(path))?.data ?? null;
}

/** Looks up by route key, for building the static route table. */
export function discoveryForRoute(route: string): BazaarDiscovery | null {
  return COMPILED.find((e) => e.route === route)?.data ?? null;
}

/**
 * The concrete path, turned back into the parameterised template the catalog
 * groups by. Without it every BIC ever probed would be catalogued as its own
 * resource.
 */
export function routeTemplateOf(path: string): string {
  return COMPILED.find((e) => e.regex.test(path))?.template ?? path;
}

export function buildInputBlock(d: BazaarDiscovery): Record<string, unknown> {
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
 * The `info` block of a Bazaar extension: how to call the route, and what a
 * real answer looks like.
 *
 * The output example is what Coinbase's validator asks for by name — it
 * reported "Missing output example" as an advisory while the example existed
 * only in the 402 body we hand-built and never in the header the catalog
 * reads. Emitting it here puts it where it was always supposed to be.
 */
export function buildBazaarInfo(d: BazaarDiscovery): Record<string, unknown> {
  return {
    input: buildInputBlock(d),
    output: { type: 'json', example: markExample(d.outputExample) },
  };
}
