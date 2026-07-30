/**
 * The version of this package lives in three places, and only one of them is
 * maintained by tooling.
 *
 * `npm version patch` bumps package.json and package-lock.json. It does not
 * know server.json exists, and server.json carries the version twice: once at
 * the top level and once inside the npm package entry. That file is the sole
 * input to `mcp-publisher`, so when it drifts the MCP Registry publishes the
 * stale number while npm serves the new one, and the release workflow reports
 * success either way because publishing an older version is not an error.
 *
 * That is exactly what happened on 2026-07-30: npm went to 1.4.1, the registry
 * received 1.4.0, and every check was green.
 *
 * This overlaps with src/routes/server-json.test.ts in the API suite, and both
 * are worth keeping: that one compares mcp/server.json against the ROOT
 * package.json (plus the root server.json and the README badge), this one
 * against mcp/package.json. Different pairs. This job is also the only one that
 * runs when a change touches mcp/ alone, since it installs nothing from the
 * repo root.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(resolve(HERE, '..', name), 'utf8'));

const pkg = read('package.json') as { name: string; version: string };
const server = read('server.json') as {
  version: string;
  packages: Array<{ identifier: string; version: string }>;
};

describe('the published version is the same number everywhere', () => {
  it('server.json declares the version package.json does', () => {
    expect(
      server.version,
      'server.json top-level version drifted from package.json; the MCP Registry would publish the stale one',
    ).toBe(pkg.version);
  });

  it('the npm package entry inside server.json declares it too', () => {
    const npmEntry = server.packages.find((p) => p.identifier === pkg.name);
    expect(npmEntry, `server.json lists no npm package named ${pkg.name}`).toBeDefined();
    expect(
      npmEntry?.version,
      'server.json packages[].version drifted from package.json; installers would be pointed at the wrong tarball',
    ).toBe(pkg.version);
  });
});
