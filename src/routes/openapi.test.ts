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
  expect(start, 'the /v1/keys/generate handler moved out of src/routes/api-keys.ts').toBeGreaterThan(-1);
  const end = src.indexOf('\napiKeys.', start + 10);
  return src.slice(start, end === -1 ? undefined : end);
}

const HANDLER = generateHandlerSource();

/** Every HTTP status the handler can answer with. */
const HANDLER_STATUSES = [...new Set([...HANDLER.matchAll(/\},\s*(\d{3})\)/g)].map((m) => m[1]))].sort();

/** Every machine-readable `error` value the handler can emit. */
const HANDLER_ERRORS = [...new Set([...HANDLER.matchAll(/error:\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();

// Cast through unknown: `paths` is a literal object whose entries carry `get`
// or `post` depending on the route, so it does not structurally match a
// post-only index signature.
const PATHS = buildSpec().paths as unknown as Record<string, { post: Record<string, unknown> }>;
const OPERATION = PATHS['/v1/keys/generate'].post;
const OPERATION_TEXT = JSON.stringify(OPERATION);
const SCHEMA = (
  OPERATION.requestBody as { content: { 'application/json': { schema: { required: string[]; properties: Record<string, unknown> } } } }
).content['application/json'].schema;

describe('/v1/keys/generate: the spec documents the whole signup, verification included', () => {
  it('documents every status the handler can return', () => {
    // 403 (verification_required / verification_failed) and 503
    // (verification_unavailable) are the two that were missing, and they are
    // precisely the ones a caller cannot guess.
    expect(HANDLER_STATUSES.length, 'handler scan found no statuses, the extraction broke').toBeGreaterThan(3);
    const documented = Object.keys(OPERATION.responses as Record<string, unknown>).sort();
    expect(documented).toEqual(expect.arrayContaining(HANDLER_STATUSES));
  });

  it('names every error string the handler can emit', () => {
    // An agent branches on `error`, not on prose. A status alone does not tell
    // it whether to retry with a code, wait a day, or stop asking.
    expect(HANDLER_ERRORS.length, 'handler scan found no error codes, the extraction broke').toBeGreaterThan(5);
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
