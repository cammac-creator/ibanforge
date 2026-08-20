import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { apiKeys } from './api-keys.js';
import { isDisposableDomain } from '../lib/disposable-domains.js';

/**
 * The example address we publish must survive our own signup guard.
 *
 * 2026-08-20, DX audit: the first command of the English "API Keys" page was
 * `-d '{"email": "you@example.com"}'`, and `example.com` sits on the
 * disposable-domain blocklist. The very first copy-paste of the documented
 * quickstart answered `400 disposable_email`, on eight surfaces at once (the
 * docs, both llms.txt, the .well-known discovery document, the body of every
 * 402, the MCP instructions, and two npm READMEs). The blocklist was right;
 * our own copy handed the reader the address it refuses.
 *
 * The trap is that nothing links the two sides: the blocklist lives in
 * `src/routes/api-keys.ts` + `src/lib/disposable-domains.ts`, the addresses
 * live in prose. Extending the blocklist tomorrow could break a documented
 * example again without a single test turning red. So this test does not
 * re-implement the rule, it *drives the real route* with every example
 * address it finds published in the repository.
 *
 * Note for whoever extends the disposable list: `acme@example.com`, the
 * fixture CLAUDE.md prescribes for invented data, is REFUSED by this guard.
 * It stays fine as a test fixture; it must never be published as the address a
 * reader is told to send. The address the API itself suggests in its own
 * `invalid_email` message is the one to use.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/** Never reaches a reader, or is not ours to police. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.venv',
  '.superpowers', '.claude', 'data', 'tmp', 'internal',
  // Implementation plans and specs are dated design history, like CHANGELOG.
  'superpowers',
  // A mocked response body is not an instruction to a reader: the Python SDK
  // suite asserts on `{"email": "a@b.c"}`, which is a fixture, not an example.
  'tests', '__tests__',
]);

const EXTS = /\.(ts|tsx|js|mjs|py|json|md|mdx|txt|html)$/;
const TEST_FILE = /(\.test\.ts|\.spec\.ts|^test_.*\.py$|_test\.py)$/;

/** History describes the past; this test polices what we serve today. */
const HISTORY = new Set(['CHANGELOG.md']);

/**
 * Surfaces that still carry the refused address on 2026-08-20 and belong to a
 * different workstream: the published SDK sources and their READMEs go out in
 * one npm + PyPI batch, and `src/app.ts` / `src/middleware/enrich-402.ts` were
 * being rewritten in a parallel session when this test was written.
 *
 * This list is debt, not policy. Delete an entry the moment its file is fixed.
 */
const KNOWN_DEBT = new Set(
  [
    'src/app.ts',
    'src/middleware/enrich-402.ts',
    'frontend/public/llms.txt',
    'frontend/public/llms-full.txt',
    'README.md',
    'sdks/python/README.md',
    'sdks/python/ibanforge/client.py',
    'sdks/typescript/src/index.ts',
    // The three locales of this post publish the SAME quickstart the Python
    // README does, each with its own refused address (you@ / vous@ / sie@
    // example.com). Found by this test, not by the audit that preceded it.
    'frontend/content/en/blog/2026-04-29-python-sdk-released.mdx',
    'frontend/content/fr/blog/2026-04-29-python-sdk-released.mdx',
    'frontend/content/de/blog/2026-04-29-python-sdk-released.mdx',
    'integrations/openai/developer-onramp.md',
    // ⚠️ This one is listed for the human reader, not for the extractor: the
    // Postman collection carries the address inside an escaped JSON string
    // (`{\"email\":\"…\"}`), which none of the patterns below match. Removing
    // it from this list will NOT put the file under guard — fix the file and
    // widen a pattern, or it stays uncovered either way.
    'docs/marketing/ibanforge.postman_collection.json',
  ].map((p) => p.split('/').join(sep)),
);

/**
 * Where an address is presented to a reader as the one to SEND. Deliberately
 * narrow: prose that merely names a domain ("example.com is blocked") is
 * documentation of the rule, not an instruction to copy.
 */
const SIGNUP_ADDRESS_PATTERNS: RegExp[] = [
  /"email"\s*:\s*"([^"\s]+@[^"\s]+)"/g,
  /'email'\s*:\s*'([^'\s]+@[^'\s]+)'/g,
  /generateApiKey\(\s*['"]([^'"\s]+@[^'"\s]+)['"]/g,
  /generate_api_key\(\s*['"]([^'"\s]+@[^'"\s]+)['"]/g,
];

interface Occurrence {
  file: string;
  line: number;
  address: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.test(name) && !TEST_FILE.test(name)) out.push(full);
  }
  return out;
}

function collectPublishedAddresses(): Occurrence[] {
  const found: Occurrence[] = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file);
    if (HISTORY.has(rel) || KNOWN_DEBT.has(rel)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const pattern of SIGNUP_ADDRESS_PATTERNS) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(line)) !== null) {
            const address = m[1];
            if (address) found.push({ file: rel, line: i + 1, address });
          }
        }
      });
  }
  return found;
}

const originalEnv = { ...process.env };
beforeAll(() => {
  // The guard is bypassed wholesale by IBANFORGE_ADMIN_TEST_KEYS, which the
  // rest of this suite sets so it can use throwaway fixtures. Here we need the
  // production behaviour, so make sure it is off whatever the ambient env says.
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
});
afterAll(() => {
  process.env = { ...originalEnv };
});

describe('published example signup addresses', () => {
  const occurrences = collectPublishedAddresses();
  const unique = [...new Set(occurrences.map((o) => o.address))].sort();

  it('finds the surfaces that publish one (guards the extractor itself)', () => {
    // If this drops to zero the patterns above stopped matching and the two
    // tests below would pass on an empty set, which is the classic way a
    // guard test dies quietly.
    expect(occurrences.length).toBeGreaterThan(5);
  });

  it('never publishes a domain our own disposable list refuses', () => {
    const refused = occurrences.filter((o) => isDisposableDomain(o.address));
    expect(
      refused.map((o) => `${o.file}:${o.line} publishes ${o.address}`),
      'these addresses are on the disposable blocklist and would 400',
    ).toEqual([]);
  });

  it.each(unique)('POST /v1/keys/generate accepts %s', async (address) => {
    const app = new Hono();
    app.route('/', apiKeys);
    const res = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address }),
    });
    const body = (await res.json()) as { error?: string };
    // 201 on a clean run, 429 once the address already got its key today, 403
    // when the network guard asks for a mailbox code: all of those mean the
    // address was ACCEPTED. Only these two mean we published a dead example.
    expect(
      body.error,
      `${address} is published as the address to send, and the API refuses it`,
    ).not.toBe('disposable_email');
    expect(body.error).not.toBe('invalid_email');
  });
});
