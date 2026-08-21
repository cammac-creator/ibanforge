#!/usr/bin/env node
/**
 * Record — or re-check — the API responses the two SDK READMEs are executed
 * against.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-20 the DX audit found that both published quickstarts were dead
 * on arrival: the PyPI one raised `TypeError` on its third line (it read
 * `bic["bankName"]`, a field that never existed), the npm one printed
 * `undefined` for BIC and Swiss clearing — the two things the product is sold
 * on. Neither README had ever been executed by anything.
 *
 * The READMEs are now run, line by line, by a test in each SDK
 * (`readme-quickstart.test.ts` / `test_readme_quickstart.py`). Those tests must
 * stay hermetic: CI runs each SDK job on its own (`working-directory:
 * sdks/typescript` with only the SDK's own deps, `sdks/python` with no Node at
 * all), so neither can boot the real server. They replay the responses in
 * `quickstart-api.json` instead.
 *
 * Which moves the rot one step: a frozen fixture can drift from the real API
 * exactly the way the README did. That is what this script closes. It replays
 * every recorded request against a real server and rewrites (or, with
 * `--check`, diffs) the bodies. Run it before every SDK publish — the
 * pre-publish gate is `--check` against a local server.
 *
 * USAGE
 * -----
 *   # boot a local server first (never a paid endpoint on production):
 *   PORT=3300 IBANFORGE_FREE_MODE=true npx tsx src/index.ts
 *
 *   node sdks/fixtures/record.mjs http://127.0.0.1:3300            # re-record
 *   node sdks/fixtures/record.mjs --check http://127.0.0.1:3300    # verify only
 *
 * An API key is optional: in `IBANFORGE_FREE_MODE=true` the paid endpoints
 * answer without one. Pass `--key ifk_…` to record against a gated server.
 *
 * Exit code is 1 when `--check` finds a difference, so it can gate a release.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(HERE, 'quickstart-api.json');

/**
 * Fields that legitimately change between two runs of the same request. They
 * are recorded (a reader of the fixture should see the real shape) but never
 * compared, or `--check` would be red on every run and stop meaning anything.
 */
const VOLATILE = new Set([
  'processing_ms',
  'uptime_seconds',
  'api_key',
  'key_prefix',
  'used',
  'remaining',
  'month',
  'sanctions_as_of',
  'uptime',
  'bic_database_entries',
  'ch_clearing_entries',
  'bic_data_last_updated',
  // Depends on the caller, not on the contract: the same endpoint quotes 0 to
  // a keyed caller in free mode and its list price to an anonymous one. It is
  // recorded so a reader sees the field, and never compared — no README
  // asserts on it, precisely because the value is not a property of the route.
  'cost_usdc',
]);

/**
 * Values never written to this file. `/v1/keys/generate` answers with a live
 * key; this repository is public, and a fixture is the classic way a secret
 * gets committed by a process nobody reviews. The READMEs print the quota, not
 * the key, so nothing downstream needs the real value.
 */
const REDACT = { api_key: 'ifk_REDACTED', key_prefix: 'ifk_REDACTED' };

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        k in REDACT && typeof v === 'string' ? [k, REDACT[k]] : [k, redact(v)],
      ),
    );
  }
  return value;
}

export function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/**
 * Random by design, but ONLY inside the entries `/v1/test-iban` mints: it picks
 * a bank code at random from the register and appends random account digits, so
 * the IBAN, the code and the institution differ on every call.
 *
 * Stripping the whole `test_ibans` key instead would be the easy move and the
 * wrong one: both READMEs assert on `proof.bank_code_check.status` and
 * `.authoritative` INSIDE those entries. Blanking the key would leave those two
 * lines as the only assertions in either guide with no live gate behind them —
 * the register could stop backing the minted codes and nothing would say so.
 */
const TEST_IBAN_RANDOM = new Set(['iban', 'formatted', 'value', 'institution', 'bic']);

/** Strip the fields that change on every call, recursively. */
function stable(value, extra) {
  if (Array.isArray(value)) return value.map((v) => stable(v, extra));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE.has(k)) continue;
      if (extra?.has(k)) continue;
      // The narrower rule applies from `test_ibans` downwards, and nowhere
      // else: `bank_code_check.value` stays compared on every other route.
      out[k] = stable(v, k === 'test_ibans' ? TEST_IBAN_RANDOM : extra);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON: object keys sorted, so a re-order is not a diff. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortDeep(value[k])]),
    );
  }
  return value;
}

export async function playOne(baseUrl, call, apiKey) {
  const { method, path, query, body, headers } = call.request;
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

  const init = { method, headers: { ...(headers ?? {}) } };
  // A fixture that pins its own Authorization header (the "wrong key" demo)
  // wins over the recording key: that request is *about* the bad key.
  if (apiKey && !init.headers.authorization && !init.headers.Authorization) {
    init.headers.Authorization = `Bearer ${apiKey}`;
  }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const keyIdx = args.indexOf('--key');
  const apiKey = keyIdx >= 0 ? args[keyIdx + 1] : process.env.IBANFORGE_API_KEY;
  const baseUrl = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3300';

  const fixture = loadFixture();
  const diffs = [];
  const notes = [];
  let compared = 0;
  let key = apiKey;

  for (const call of fixture.calls) {
    if (call.needs_key && !key) {
      notes.push(
        `${call.name}: no API key available — pass --key ifk_…, or run against a server ` +
          `with a fresh STATS_DB_PATH so the signup call above can mint one.`,
      );
      continue;
    }
    const fresh = await playOne(baseUrl, call, key);
    // Chain: the free key this run just created authenticates the rest, so
    // recording needs no key handed in and leaves none lying around.
    if (typeof fresh.body?.api_key === 'string') key = fresh.body.api_key;

    if (!check) {
      // Recording a guard's refusal instead of the real answer is silent and
      // permanent: the README would then be executed against a 429 and every
      // assertion below it rewritten to match. Refuse to write it.
      if (call.first_run_only && (fresh.status < 200 || fresh.status >= 300)) {
        console.error(
          `\n${call.name} answered ${fresh.status}: ${JSON.stringify(fresh.body)}\n\n` +
            `That is the signup guard, not the response this fixture is for. Recording needs ` +
            `a server with a FRESH stats database — this network already claimed its key:\n\n` +
            `  STATS_DB_PATH=$(mktemp -d)/stats.sqlite PORT=3300 IBANFORGE_FREE_MODE=true \\\n` +
            `    npx tsx src/index.ts\n`,
        );
        process.exit(1);
      }
      call.response = { status: fresh.status, body: redact(fresh.body) };
      continue;
    }
    // Played (it mints the key the rest needs) but not compared: a second
    // creation from the same network is legitimately guarded, not drift.
    if (call.first_run_only) {
      notes.push(`${call.name}: played, not compared (signup guard makes it run-dependent).`);
      continue;
    }
    compared += 1;
    const before = JSON.stringify(sortDeep(stable(call.response)));
    const after = JSON.stringify(sortDeep(stable(fresh)));
    if (before !== after) diffs.push({ name: call.name, before, after });
  }

  if (check) {
    for (const n of notes) console.log(`note: ${n}`);
    if (diffs.length === 0) {
      console.log(`OK — ${compared}/${fixture.calls.length} recorded responses still match ${baseUrl}`);
      return;
    }
    console.error(`DRIFT — ${diffs.length}/${fixture.calls.length} responses changed:\n`);
    for (const d of diffs) {
      console.error(`  ${d.name}`);
      console.error(`    recorded: ${d.before.slice(0, 300)}`);
      console.error(`    live    : ${d.after.slice(0, 300)}\n`);
    }
    console.error('Re-record with:  node sdks/fixtures/record.mjs ' + baseUrl);
    console.error('then re-run both SDK test suites — a README may now be wrong.');
    process.exit(1);
  }

  fixture.recorded_at = new Date().toISOString();
  fixture.recorded_against = baseUrl.includes('127.0.0.1')
    ? 'local server, IBANFORGE_FREE_MODE=true'
    : baseUrl;
  const health = await fetch(new URL('/health', baseUrl)).then((r) => r.json());
  fixture.api_version = health.version;
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
  console.log(
    `Recorded ${fixture.calls.length} responses from ${baseUrl} (API ${health.version}) ` +
      `→ ${FIXTURE_PATH}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
