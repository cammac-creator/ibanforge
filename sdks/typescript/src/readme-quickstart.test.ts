/**
 * Runs the README. Every block, every line, every claim.
 *
 * ─── why this file exists ───────────────────────────────────────────────────
 * The 1.3.3 quickstart demonstrated the two things this product is sold on —
 * BIC and Swiss clearing — on `CH9300762011623852957`, an IBAN whose bank code
 * is allocated to nobody. Both fields came back null, so the published example
 * printed `undefined` for six weeks. Nothing was broken in the SDK: the guide
 * was simply never executed by anything.
 *
 * So this test does not re-implement the quickstart, and does not paste a copy
 * of it (a copy diverges, which is the same failure one level down). It reads
 * `../README.md`, takes the text of every ```typescript block, runs it, and
 * checks each `console.log` against the `// comment` the README puts next to
 * it. The comments in the README are the assertions.
 *
 * ─── why a stub and not the real API ────────────────────────────────────────
 * CI runs this package alone (`working-directory: sdks/typescript`, only this
 * package's dependencies, no server, no database). The responses come from
 * `../../fixtures/quickstart-api.json`, recorded from a real IBANforge server.
 * That moves the rot one step rather than removing it — a frozen fixture can
 * drift from the API exactly like a frozen README — which is why the fixture
 * carries a re-recorder with a `--check` mode, run before every publish:
 *
 *     node sdks/fixtures/record.mjs --check http://127.0.0.1:3300
 *
 * ─── the one rule the README must obey ──────────────────────────────────────
 * Blocks are executed as plain JavaScript, so a quickstart may not contain type
 * annotations or `as` assertions. That is a feature: a snippet a reader cannot
 * paste into a `.js` file, or into a REPL, is a snippet with a step missing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as sdk from './index.js';

const HERE = dirname(new URL(import.meta.url).pathname);
const README = join(HERE, '..', 'README.md');
const FIXTURE = join(HERE, '..', '..', 'fixtures', 'quickstart-api.json');

// ─── the README, parsed ──────────────────────────────────────────────────────

interface Expectation {
  /** 1-based line inside the block, for the failure message. */
  line: number;
  source: string;
  expected: unknown;
}
interface Block {
  index: number;
  code: string;
  expectations: Expectation[];
}

/**
 * Strip the trailing prose some expectations carry — `// '00230' (CH/LI only)`.
 * Only after a closing quote or bracket, so `// (nothing yet)` stays whole and
 * fails loudly as unparseable rather than silently becoming an empty string.
 */
function stripTrailingProse(comment: string): string {
  return comment.replace(/(['"\]}\d])\s+\(.*\)$/, '$1').trim();
}

/**
 * Turn `// 'UBSWCHZH'`, `// true`, `// null`, `// []` into a value.
 * Throws on anything it cannot read — an expectation that quietly stops being
 * comparable is how this kind of test dies without anyone noticing.
 */
function parseExpectation(comment: string, where: string): unknown {
  const text = stripTrailingProse(comment);
  const json = /^'(?:[^'\\]|\\.)*'$/.test(text)
    ? `"${text.slice(1, -1).replace(/"/g, '\\"')}"` // 'single' → "double"
    : text;
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(
      `${where}: the README annotates this console.log with \`// ${comment}\`, which is not a ` +
        `comparable value. Every console.log in the README must state what it prints ` +
        `(\`// true\`, \`// 'UBSWCHZH'\`, \`// null\`, \`// 42\`), or the line stops being checked ` +
        `and the guide starts drifting again.`,
    );
  }
}

function parseReadme(): Block[] {
  const md = readFileSync(README, 'utf8');
  const blocks: Block[] = [];
  const fence = /^```typescript\n([\s\S]*?)^```$/gm;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) {
    const code = m[1];
    const expectations: Expectation[] = [];
    code.split('\n').forEach((line, i) => {
      if (!/\bconsole\.log\(/.test(line)) return;
      const comment = line.match(/\/\/\s*(.+?)\s*$/);
      const where = `README block #${blocks.length + 1}, line ${i + 1} (${line.trim()})`;
      if (!comment) {
        throw new Error(
          `${where}: a console.log with no \`// expected\` comment. Add one, or drop the log — ` +
            `an unchecked line is how the quickstart went stale in the first place.`,
        );
      }
      expectations.push({ line: i + 1, source: line.trim(), expected: parseExpectation(comment[1], where) });
    });
    blocks.push({ index: blocks.length + 1, code, expectations });
  }
  return blocks;
}

// ─── the stub: recorded responses, replayed ──────────────────────────────────

interface FixtureCall {
  name: string;
  /** Which README(s) exercise this call — 'typescript', 'python'. */
  used_by: string[];
  request: {
    method: string;
    path: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  };
  response: { status: number; body: unknown };
}

function isSubset(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  return Object.entries(expected).every(
    ([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v),
  );
}

let server: Server;
let baseUrl: string;
/** Which fixtures the README actually exercised — checked at the end. */
const used = new Set<string>();

beforeAll(async () => {
  const calls: FixtureCall[] = JSON.parse(readFileSync(FIXTURE, 'utf8')).calls;

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = {};
        }
      }
      const query = Object.fromEntries(url.searchParams.entries());
      const headers = { authorization: req.headers.authorization ?? '' };

      // First match wins, so a specific fixture (the wrong-key 401) must be
      // listed above the general one for the same route.
      const hit = calls.find((c) => {
        if (c.request.method !== req.method || c.request.path !== url.pathname) return false;
        if (c.request.query && !isSubset(c.request.query, query)) return false;
        if (c.request.body && !isSubset(c.request.body, body)) return false;
        if (c.request.headers) {
          const want = Object.fromEntries(
            Object.entries(c.request.headers).map(([k, v]) => [k.toLowerCase(), v]),
          );
          if (!isSubset(want, headers)) return false;
        }
        return true;
      });

      res.setHeader('content-type', 'application/json');
      if (!hit) {
        res.statusCode = 599;
        res.end(
          JSON.stringify({
            error: 'no_fixture',
            message:
              `The README calls ${req.method} ${url.pathname} with body ` +
              `${JSON.stringify(body)}, which is not in sdks/fixtures/quickstart-api.json. ` +
              `Add the call there and re-record — never hand-write a response.`,
          }),
        );
        return;
      }
      used.add(hit.name);
      res.statusCode = hit.response.status;
      res.end(JSON.stringify(hit.response.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.IBANFORGE_API_BASE = baseUrl;

  // A block that hardcodes a base URL would silently call the real API from
  // CI. Make that impossible, and say why when it happens.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input instanceof Request ? input.url : input);
    if (!target.startsWith(baseUrl)) {
      throw new Error(
        `A README block called ${target}. Quickstart blocks must not hardcode a baseUrl: ` +
          `they run in CI, where the only thing that may answer is the recorded stub.`,
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(async () => {
  delete process.env.IBANFORGE_API_BASE;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─── running a block ─────────────────────────────────────────────────────────

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

async function runBlock(block: Block): Promise<unknown[]> {
  // The import line is the only thing rewritten: the names it asks for are
  // handed in as parameters instead. Everything else runs as written.
  const importLine = block.code.match(/^import\s*\{([^}]+)\}\s*from\s*'@ibanforge\/sdk';?\s*$/m);
  const names = (importLine?.[1] ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  for (const n of names) {
    if (!(n in sdk)) {
      throw new Error(
        `README block #${block.index} imports { ${n} } from '@ibanforge/sdk', which this ` +
          `package does not export. Either the export was removed or the README invented it.`,
      );
    }
  }

  const printed: unknown[] = [];
  const fakeConsole = { log: (...args: unknown[]) => printed.push(args.length === 1 ? args[0] : args) };
  const body = block.code.replace(/^import[^\n]*\n/gm, '');

  let fn;
  try {
    fn = new AsyncFunction(...names, 'console', body);
  } catch (err) {
    throw new Error(
      `README block #${block.index} is not executable JavaScript: ${(err as Error).message}. ` +
        `Quickstart blocks must contain no type annotations and no \`as\` assertions — ` +
        `a snippet a reader cannot paste into a REPL is a snippet with a step missing.\n` +
        `--- block ---\n${block.code}`,
    );
  }
  await fn(...names.map((n) => (sdk as Record<string, unknown>)[n]), fakeConsole);
  return printed;
}

// ─── the tests ───────────────────────────────────────────────────────────────

const blocks = parseReadme();

describe('README.md — executed, not just published', () => {
  it('found the quickstart blocks (guards the extractor itself)', () => {
    // If the fence syntax or the language tag ever changes, every test below
    // would pass on an empty set. That is the classic silent death.
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    const total = blocks.reduce((n, b) => n + b.expectations.length, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });

  for (const block of blocks) {
    it(`block #${block.index} runs, and prints what it says it prints`, async () => {
      const printed = await runBlock(block);
      expect(
        printed.length,
        `block #${block.index} printed ${printed.length} value(s) but annotates ` +
          `${block.expectations.length}. A branch that did not fire prints nothing — ` +
          `which is exactly how an example stops being true without failing.`,
      ).toBe(block.expectations.length);

      block.expectations.forEach((exp, i) => {
        expect(
          printed[i],
          `README block #${block.index}, \`${exp.source}\` claims it prints ` +
            `${JSON.stringify(exp.expected)} but printed ${JSON.stringify(printed[i])}.`,
        ).toEqual(exp.expected);
      });
    });
  }

  it('exercises exactly the fixtures the fixture says it does', () => {
    // The fixture carries its own map (`used_by`), so neither test needs a
    // hand-kept exception list. Both directions are checked: an orphan is a
    // deleted example or a block that escaped to the real API; an unlisted use
    // means the map went stale.
    const calls: FixtureCall[] = JSON.parse(readFileSync(FIXTURE, 'utf8')).calls;
    const mine = calls.filter((c) => c.used_by.includes('typescript')).map((c) => c.name);
    expect(
      mine.filter((n) => !used.has(n)),
      'listed as used by this README but never called',
    ).toEqual([]);
    expect(
      [...used].filter((n) => !mine.includes(n)),
      'called by this README but not listed for it in the fixture',
    ).toEqual([]);
  });
});
