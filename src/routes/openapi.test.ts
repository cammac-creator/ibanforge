import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSpec } from './openapi.js';
import { Hono } from 'hono';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { bicLookup } from './bic-lookup.js';
import { buildBicComplianceResponse, buildComplianceResponse } from '../lib/compliance-response.js';
import type { HonoEnv } from '../types.js';

/**
 * The machine contract must describe every step the endpoint actually demands.
 *
 * ## Why this file exists
 *
 * The 2026-08-18 mailbox-verification guard shipped without reaching a single
 * machine-readable surface. Audit C1 walked the whole product: the step was
 * described in exactly one place, the `instructions` field of the HTTP MCP
 * transport, which only a client that has already run `initialize` on /mcp ever
 * reads. The OpenAPI document, which is what an agent or a code generator reads
 * before writing anything, still said "One key per email per day", had no `code`
 * field in its request body and listed neither 403 nor 503.
 *
 * A generated client is therefore *structurally* unable to finish the signup:
 * it cannot put the code in the body, and it does not expect the status it will
 * receive. It loops or gives up on a step the product answers in one retry.
 * That is worse than a documentation gap, because the caller has no way to
 * discover the truth from the contract it was handed.
 *
 * ## What parity means here
 *
 * The route is the primary source, not the audit and not this file. So the
 * expectations below are read out of `src/routes/api-keys.ts` at test time:
 * every status the handler can return must be a documented response, and every
 * `error` string it can emit must be named in the operation an agent branches
 * on. Add a failure mode to the handler and this goes red until the contract
 * says so too.
 *
 * The handler is scanned as text rather than exercised, because reaching the
 * verification branches needs a network-scoped creation history and a mail
 * relay; the point being defended is the contract's completeness, not the
 * guard's behaviour, which `src/lib/key-creation-guard.test.ts` already covers.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/** The body of the /v1/keys/generate handler, bounded by the next route registration. */
function generateHandlerSource(): string {
  const src = readFileSync(join(ROOT, 'src/routes/api-keys.ts'), 'utf8');
  const start = src.indexOf("apiKeys.post('/v1/keys/generate'");
  expect(
    start,
    'the /v1/keys/generate handler moved out of src/routes/api-keys.ts',
  ).toBeGreaterThan(-1);
  const end = src.indexOf('\napiKeys.', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
}

const HANDLER = generateHandlerSource();

/** Every HTTP status the handler can answer with. */
const HANDLER_STATUSES = [
  ...new Set([...HANDLER.matchAll(/\},\s*(\d{3}),?\s*\)/g)].map((m) => m[1])),
].sort();

/** Every machine-readable `error` value the handler can emit. */
const HANDLER_ERRORS = [
  ...new Set([...HANDLER.matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1])),
].sort();

// Cast through unknown: `paths` is a literal object whose entries carry `get`
// or `post` depending on the route, so it does not structurally match a
// post-only index signature.
const PATHS = buildSpec().paths as unknown as Record<string, { post: Record<string, unknown> }>;
const OPERATION = PATHS['/v1/keys/generate'].post;
const OPERATION_TEXT = JSON.stringify(OPERATION);
const REQUEST_BODY = OPERATION.requestBody as {
  required?: boolean;
  content: {
    'application/json': { schema: { required?: string[]; properties: Record<string, unknown> } };
  };
};
const SCHEMA = REQUEST_BODY.content['application/json'].schema;

describe('/v1/keys/generate: the spec documents the whole signup, verification included', () => {
  it('documents every status the handler can return', () => {
    // 403 (verification_required / verification_failed) and 503
    // (verification_unavailable) are the two that were missing, and they are
    // precisely the ones a caller cannot guess.
    expect(
      HANDLER_STATUSES.length,
      'handler scan found no statuses, the extraction broke',
    ).toBeGreaterThan(3);
    const documented = Object.keys(OPERATION.responses as Record<string, unknown>).sort();
    expect(documented).toEqual(expect.arrayContaining(HANDLER_STATUSES));
  });

  it('names every error string the handler can emit', () => {
    // An agent branches on `error`, not on prose. A status alone does not tell
    // it whether to retry with a code, wait a day, or stop asking.
    expect(
      HANDLER_ERRORS.length,
      'handler scan found no error codes, the extraction broke',
    ).toBeGreaterThan(5);
    const missing = HANDLER_ERRORS.filter((e) => !OPERATION_TEXT.includes(e));
    expect(missing, `the contract never names: ${missing.join(', ')}`).toEqual([]);
  });

  it('accepts the verification code in the request body', () => {
    expect(Object.keys(SCHEMA.properties)).toContain('code');
  });

  it('ne demande plus AUCUN champ : le corps entier est facultatif', () => {
    // « code » n'a jamais été requis (la première clé d'un réseau n'en a pas
    // besoin), et depuis le palier anonyme « email » ne l'est plus non plus :
    // un POST sans corps du tout est un cas SERVI, pas une erreur. C'est la
    // commande la plus courte qu'un agent puisse émettre, et un client généré
    // depuis ce document doit pouvoir l'écrire.
    //
    // `required` est ABSENT plutôt que vide : un tableau vide est refusé par
    // le schéma d'OpenAPI 3.x, donc `npm run openapi:lint` rougirait.
    expect(SCHEMA.required).toBeUndefined();
    expect(REQUEST_BODY.required).toBe(false);
  });

  it('documente le corps anonyme et le chemin de sortie', () => {
    // Un agent qui lit ce contrat doit apprendre les DEUX formes ici : la
    // clé sans adresse, et la route qui la fait monter de palier. Les trouver
    // ailleurs (llms.txt, instructions MCP) a déjà coûté un pas de signup
    // qu'aucun client généré ne pouvait franchir.
    expect(Object.keys(SCHEMA.properties)).toContain('anonymous');
    expect(OPERATION_TEXT).toContain('/v1/keys/claim');
    const claim = (PATHS['/v1/keys/claim'] as { post: Record<string, unknown> } | undefined)?.post;
    expect(claim, 'POST /v1/keys/claim is missing from the contract').toBeDefined();
    expect(claim!.operationId).toBe('claimApiKey');
    // La condition d'entrée est la surprise la plus probable pour un lecteur :
    // elle doit être dans le contrat, pas seulement dans la prose des docs.
    expect(JSON.stringify(claim)).toContain('unused_key');
  });

  it('renames and removes nothing that existing clients already read', () => {
    expect(OPERATION.operationId).toBe('generateApiKey');
    expect(Object.keys(OPERATION.responses as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['201', '400', '429']),
    );
    expect(Object.keys(SCHEMA.properties)).toContain('email');
  });

  it('no longer states the per-email rule as the only limit', () => {
    // "One key per email per day" was the whole description, and it is not the
    // rule that stops a caller: the per-network guard is. A contract that names
    // only the harmless limit sends the reader looking in the wrong place.
    const description = String(OPERATION.description);
    expect(description).toMatch(/verification_required/);
    expect(description).toMatch(/\bcode\b/);
  });
});

/**
 * A contract that types every success and no failure is half a contract.
 *
 * Audit of 2026-09-01 (DX-02): all thirty-one declared 4xx/5xx responses in
 * this document carried a `description` and nothing else, and no `Error`
 * component existed at all — while the served errors are perfectly regular
 * (`{"error": "<snake_case token>", "message": "<sentence>"}`, verified on 17
 * probes over 14 routes). So a generated client, including the Custom GPT that
 * `integrations/openai/custom-gpt-setup.md` builds by pasting this very
 * document, could not branch on a single failure.
 *
 * `429` and `413` were the other half: `rateLimitMiddleware()` and `bodyLimit`
 * are both mounted on `*` in `src/app.ts`, so any operation can answer 429 and
 * any operation with a body can answer 413 — and they were declared on three
 * paths and on none, respectively.
 */
describe('every failure the API can answer is typed', () => {
  const spec = buildSpec() as unknown as {
    components: {
      schemas: Record<string, { required?: string[]; additionalProperties?: boolean }>;
    };
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody?: unknown;
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        }
      >
    >;
  };

  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, op]) => op && typeof op === 'object' && 'responses' in op)
      .map(([method, op]) => ({ path, method, op })),
  );

  it('declares the ApiError component the whole document leans on', () => {
    const apiError = spec.components.schemas.ApiError;
    expect(apiError, 'components.schemas.ApiError is gone').toBeDefined();
    expect(apiError.required).toEqual(['error', 'message']);
    // Several routes add contextual recovery hints next to those two
    // (`example`, `expected`, `schemes`, `upgrade_to_full_validation`…). A
    // closed schema would make a generated client drop exactly the field that
    // says how to recover.
    expect(apiError.additionalProperties).toBe(true);
  });

  it('points every 4xx and 5xx response at it', () => {
    const naked: string[] = [];
    for (const { path, method, op } of operations) {
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        if (!/^[45]/.test(status)) continue;
        const ref = response.content?.['application/json']?.schema?.$ref;
        if (ref !== '#/components/schemas/ApiError')
          naked.push(`${method.toUpperCase()} ${path} ${status}`);
      }
    }
    expect(naked, `responses with no error schema: ${naked.join(', ')}`).toEqual([]);
  });

  it('declares 429 on every operation, because the rate limit is mounted on *', () => {
    const missing = operations
      .filter(({ op }) => !op.responses?.['429'])
      .map(({ path, method }) => `${method.toUpperCase()} ${path}`);
    expect(
      missing,
      `operations that cannot answer 429 according to the contract: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('declares 413 on every operation that takes a body, and only those', () => {
    // Not on GET /health: bodyLimit is global, but a document that says a
    // bodiless request can exceed 256 KB is noise dressed as rigour.
    for (const { path, method, op } of operations) {
      const declares413 = Boolean(op.responses?.['413']);
      expect(declares413, `${method.toUpperCase()} ${path} declares 413: ${declares413}`).toBe(
        Boolean(op.requestBody),
      );
    }
  });
});

/**
 * Routes that a developer needs in an emergency, and fields that are served.
 *
 * DX-05: the whole self-service key lifecycle was missing from the document.
 * All three routes authenticate with the caller's own key — the handlers say
 * so ("Self-service rotation. Auth is the (still valid) key itself.") — so
 * they are public and their absence was a hole. Someone who leaks a key and
 * reads only the contract could not learn they can kill it themselves.
 *
 * DX-06: five fields were served on every answer and declared in no schema.
 * `sanctions` on a BIC lookup is the one compliance signal on the cheap
 * endpoint, and `meta` on a compliance answer is the block that says what the
 * verdict does not cover: both were invisible to a reader of the contract.
 */
describe('the contract covers the routes and fields the server actually serves', () => {
  const spec = buildSpec() as unknown as {
    paths: Record<string, Record<string, unknown>>;
    components: {
      schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    };
  };

  it.each([
    ['/v1/keys/revoke', 'post'],
    ['/v1/keys/rotate', 'post'],
    ['/v1/credits/balance', 'get'],
    ['/v1/feedback', 'post'],
    ['/v1/feedback/{id}', 'get'],
    // Les cinq routes du device grant. Un agent qui ne peut pas lire ce
    // parcours dans le contrat en inventera un, et celui qu'il invente ouvre un
    // navigateur — ce que la variante A existe précisément pour éviter.
    ['/v1/keys/device', 'post'],
    ['/v1/keys/device/token', 'post'],
    ['/v1/keys/device/lookup', 'post'],
    ['/v1/keys/device/approve', 'post'],
    ['/v1/keys/device/deny', 'post'],
  ])('documents %s %s', (path, method) => {
    expect(spec.paths[path], `${path} is not in the document`).toBeDefined();
    expect(spec.paths[path][method], `${path} has no ${method} operation`).toBeDefined();
  });

  it('declares every block and field the free demo serves (D7, 24/09/2026)', () => {
    const demo = spec.paths['/v1/demo'].get as {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                properties: Record<
                  string,
                  {
                    items?: {
                      allOf?: Array<{ required?: string[] }>;
                      properties?: Record<string, unknown>;
                    };
                  }
                >;
              };
            };
          };
        };
      };
    };
    const props = demo.responses['200'].content['application/json'].schema.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'served_at',
        'how_to_read',
        'iban_examples',
        'bic_examples',
        'compliance_example',
      ]),
    );
    expect(props.iban_examples.items?.allOf?.[1]?.required).toContain('label');
    expect(Object.keys(props.bic_examples.items?.properties ?? {})).not.toContain('endpoint');
  });

  it('declares the sanctions screen served on every BIC lookup', () => {
    expect(Object.keys(spec.components.schemas.BICLookupResult.properties ?? {})).toContain(
      'sanctions',
    );
  });

  it('declares both QR-IID fields served on a Swiss clearing lookup', () => {
    const properties = Object.keys(spec.components.schemas.ChClearingResult.properties ?? {});
    expect(properties).toEqual(expect.arrayContaining(['qr_iid_source', 'qr_iids']));
  });

  it('counts processing_ms among the required fields of a batch answer', () => {
    const batch = spec.paths['/v1/iban/batch'].post as {
      responses: { '200': { content: { 'application/json': { schema: { required: string[] } } } } };
    };
    expect(batch.responses['200'].content['application/json'].schema.required).toContain(
      'processing_ms',
    );
  });

  it('declares the meta block of a compliance answer', () => {
    const compliance = spec.paths['/v1/iban/compliance'].post as {
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { oneOf: Array<{ allOf?: Array<{ properties?: Record<string, unknown> }> }> };
            };
          };
        };
      };
    };
    // Depuis le 25/09/2026, la réponse 200 est un oneOf : la forme IBAN (allOf)
    // puis la forme BIC.
    const extension = compliance.responses['200'].content[
      'application/json'
    ].schema.oneOf[0]!.allOf!.find((s) => s.properties);
    expect(Object.keys(extension?.properties ?? {})).toContain('meta');
  });

  it('says when each conditional field of a validation result appears', () => {
    // DX-08: seven declared fields are never served on a plain valid answer.
    // They are conditional, and nothing said so, so a generated client typed
    // them as optionals with no rule for when to expect them.
    const properties = spec.components.schemas.IBANValidationResult.properties as Record<
      string,
      { description?: string }
    >;
    for (const field of [
      'error',
      'error_detail',
      'reference_check',
      'issuer',
      'psd_registration',
      'official_identity',
      'modulus_check',
      'bank_code_holder',
      'checks',
      'national_check_digits',
    ]) {
      const description = properties[field]?.description ?? '';
      expect(description, `${field} does not say when it appears`).toMatch(
        /present|absent|only|when/i,
      );
    }
  });
});

/**
 * Les champs de vérité du 25/09/2026 : servis par l'API, donc déclarés au
 * contrat, avec les valeurs possibles lues dans le code qui les produit.
 */
describe('the truth fields are in the contract', () => {
  type Schema = {
    properties?: Record<string, Schema>;
    enum?: unknown[];
    items?: Schema;
    description?: string;
  };
  const schemas = (buildSpec() as unknown as { components: { schemas: Record<string, Schema> } })
    .components.schemas;

  it('declares bank_code_holder and every checks key with its possible values', () => {
    const v = schemas.IBANValidationResult.properties!;
    expect(v.bank_code_holder.enum).toEqual(['confirmed', 'inferred', 'not_allocated', 'unknown']);
    const checks = v.checks.properties!;
    expect(Object.keys(checks)).toEqual([
      'iban_structure',
      'iban_checksum',
      'bank_code',
      'bic',
      'sepa_reachability',
      'national_check_digits',
      'account_exists',
      'payee_name',
      'institution_sanctions',
      'country_sanctions',
      'payee_sanctions',
    ]);
    for (const never of ['account_exists', 'payee_name', 'payee_sanctions']) {
      expect(checks[never].enum, never).toEqual(['not_checked']);
    }
    expect(v.checks.description).toMatch(/payee_name: never checked/);
  });

  it('declares the national_check_digits block beside checks, with the statuses the module serves', () => {
    const v = schemas.IBANValidationResult.properties!;
    const keys = Object.keys(v);
    expect(keys.indexOf('national_check_digits')).toBe(keys.indexOf('checks') + 1);
    const block = v.national_check_digits as Schema & { required?: string[] };
    expect(Object.keys(block.properties!)).toEqual(['country', 'scheme', 'status', 'detail']);
    expect(block.required).toEqual(['country', 'scheme', 'status']);
    expect(block.properties!.status.enum).toEqual(['pass', 'fail', 'not_applicable']);
    // Pas d'enum fermé : l'Allemagne ajoutera des pays et des noms d'algorithme.
    expect(block.properties!.country.enum).toBeUndefined();
    expect(block.properties!.scheme.enum).toBeUndefined();
    expect(block.description).toMatch(/valid false|never makes valid false/);
    expect(v.checks.description).toMatch(/FR and MC \(RIB key\)/);
  });

  it('names the blocking next steps, the failed national key included (26/09/2026)', () => {
    // La liste servie oubliait modulus_check_failed ; `next-steps.test.ts` tient
    // désormais chaque code émis, ce test tient ce que le contrat publie.
    const code = schemas.IBANValidationResult.properties!.next_steps.items!.properties!.code;
    for (const blocking of [
      'bank_code_not_allocated',
      'modulus_check_failed',
      'national_check_digits_failed',
    ]) {
      expect(code.description, blocking).toContain(blocking);
    }
    expect(code.description).not.toContain('—');
  });

  it('declares the bank grain of sepa and the trace of the bic block', () => {
    const v = schemas.IBANValidationResult.properties!;
    const sepa = v.sepa.properties!;
    expect(sepa.bank_reachability.enum).toEqual([
      'listed',
      'not_listed',
      'no_bank',
      'bank_code_not_allocated',
      null,
    ]);
    expect(sepa).toHaveProperty('bank_schemes');
    expect(sepa).toHaveProperty('vop_register_status');
    expect(v.bic.properties!).toHaveProperty('listed_in_current_source');
    // Les descriptions qui disaient trop : l'obligation VoP est celle du pays.
    expect(sepa.vop_required.description).toMatch(/COUNTRY/);
    expect(v.risk_indicators.properties!.vop_coverage.description).toMatch(/vop_register_status/);
  });

  it('declares frozen_bic_sources on HealthResponse, beside bic_sources', () => {
    const h = schemas.HealthResponse.properties!;
    expect(h).toHaveProperty('bic_sources');
    expect(Object.keys(h.frozen_bic_sources.items!.properties!)).toEqual([
      'source',
      'source_as_of',
      'rows',
      'bic8',
      'rows_without_current_trace',
      'bic8_without_current_trace',
      'complete',
    ]);
  });

  it('declares source_name, source_as_of and listed_in_current_source on BICLookupResult', () => {
    const b = schemas.BICLookupResult.properties!;
    for (const k of ['source_name', 'source_as_of', 'listed_in_current_source']) {
      expect(b, k).toHaveProperty(k);
    }
    expect(b.found.description).toMatch(/names an institution/);
  });

  it('declares the honest compliance names', () => {
    const c = schemas.ComplianceResult.properties!;
    expect(c.sanctions.properties!).toHaveProperty('institution_listed');
    expect(c.sanctions.properties!.payee_screened.enum).toEqual([false]);
    expect(c.reachability.properties!).toHaveProperty('listed_in_epc_registers');
    expect(c.vop.properties!).toHaveProperty('register_status');
    expect(c.flags.description).toMatch(/bank_code_inferred carries no weight/);
  });
});

/**
 * Relecture de la PR 254, R4 et R5 : des réponses réelles, validées contre le
 * contrat servi. La forme BIC de la conformité n'y était pas déclarée, et
 * `address` d'une fiche BIC était déclaré non nullable alors que la route le
 * sert à `null` sur un BIC trouvé sans adresse enregistrée.
 */
describe('real answers validate against the served contract', () => {
  const spec = buildSpec() as unknown as {
    components: Record<string, unknown> & { schemas: Record<string, Record<string, unknown>> };
    paths: Record<string, { post?: Record<string, unknown> }>;
  };
  /** Un schéma du document, avec les composants pour résoudre ses $ref. */
  function validator(schema: Record<string, unknown>) {
    return new AjvJsonSchemaValidator().getValidator({
      ...schema,
      components: spec.components,
    } as Parameters<AjvJsonSchemaValidator['getValidator']>[0]);
  }
  const compliance = spec.paths['/v1/iban/compliance'].post as {
    requestBody: { content: { 'application/json': { schema: Record<string, unknown> } } };
    responses: { '200': { content: { 'application/json': { schema: Record<string, unknown> } } } };
  };

  it('accepts an iban body or a bic body, and refuses both together', () => {
    const request = validator(compliance.requestBody.content['application/json'].schema);
    expect(request({ iban: 'DE89370400440532013000' }).valid).toBe(true);
    expect(request({ bic: 'COBADEFF' }).valid).toBe(true);
    expect(request({ iban: 'DE89370400440532013000', bic: 'COBADEFF' }).valid).toBe(false);
    expect(request({}).valid).toBe(false);
  });

  it('validates the IBAN and the BIC forms of a compliance answer', () => {
    const response = validator(compliance.responses['200'].content['application/json'].schema);
    const byIban = { ...buildComplianceResponse('DE89370400440532013000'), cost_usdc: 0.02 };
    expect(response(byIban).errorMessage).toBeUndefined();
    for (const bic of ['COBADEFF', 'ZZZZITMM']) {
      const byBic = buildBicComplianceResponse(bic);
      expect(response(byBic).errorMessage, bic).toBeUndefined();
    }
  });

  it('validates a BIC record found without a registered address', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', bicLookup);
    const record = validator({ $ref: '#/components/schemas/BICLookupResult' });
    let withoutAddress = 0;
    for (const code of ['UBSWCHZH', 'ZZZZITMM', 'DEUTDEFF']) {
      const body = (await (await app.request(`/v1/bic/${code}`)).json()) as { address: unknown };
      if (body.address === null) withoutAddress += 1;
      expect(record(body).errorMessage, code).toBeUndefined();
    }
    expect(withoutAddress).toBeGreaterThan(0);
  });
});
