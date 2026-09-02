import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSpec } from './openapi.js';

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
  ...new Set([...HANDLER.matchAll(/\},\s*(\d{3})\)/g)].map((m) => m[1])),
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
const SCHEMA = (
  OPERATION.requestBody as {
    content: {
      'application/json': { schema: { required: string[]; properties: Record<string, unknown> } };
    };
  }
).content['application/json'].schema;

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

  it('leaves "code" optional, so clients that predate the step keep working', () => {
    // The whole reason the step is survivable: the first key of a network never
    // needs a code. Putting it in `required` would break every client generated
    // from an earlier version of this document, which is a breaking change no
    // matter how additive the diff looks.
    expect(SCHEMA.required).toEqual(['email']);
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
  ])('documents %s %s', (path, method) => {
    expect(spec.paths[path], `${path} is not in the document`).toBeDefined();
    expect(spec.paths[path][method], `${path} has no ${method} operation`).toBeDefined();
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
              schema: { allOf: Array<{ properties?: Record<string, unknown> }> };
            };
          };
        };
      };
    };
    const extension = compliance.responses['200'].content['application/json'].schema.allOf.find(
      (s) => s.properties,
    );
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
    ]) {
      const description = properties[field]?.description ?? '';
      expect(description, `${field} does not say when it appears`).toMatch(
        /present|absent|only|when/i,
      );
    }
  });
});
