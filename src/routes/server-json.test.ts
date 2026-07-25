import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The repo carries TWO server.json files and only ONE of them is ever
 * published: .github/workflows/release-publish.yml runs mcp-publisher with
 * `working-directory: mcp`, so the MCP Registry gets mcp/server.json. The root
 * server.json is documentation.
 *
 * They silently diverged. On 2026-07-03 the root file said "Pre-payout IBAN
 * screening for AI agents" while mcp/server.json still said "IBAN validation,
 * BIC/SWIFT lookup, ..." — so the registry, a discovery surface assistants
 * read before recommending anything, advertised IBANforge as a generic IBAN
 * API and lost the positioning the 1.3.2 entry had. Nobody noticed because
 * the file that looks authoritative is the one nobody publishes.
 *
 * These tests fail the build when the two drift apart again.
 * Audit reco-IA 2026-07-25.
 */
const here = dirname(fileURLToPath(import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(resolve(here, '../..', p), 'utf-8'));

const root = readJson('server.json');
const published = readJson('mcp/server.json');
const pkg = readJson('package.json');

describe('the two server.json files stay in sync', () => {
  it.each(['name', 'version', 'websiteUrl', 'description'])(
    'root and mcp/ agree on %s',
    (field) => {
      expect(published[field]).toEqual(root[field]);
    },
  );

  it('both carry the version actually being released', () => {
    expect(published.version).toBe(pkg.version);
    expect(root.version).toBe(pkg.version);
  });

  it('the npm package pinned in the published manifest matches the release', () => {
    const npmPkg = published.packages.find(
      (p: { registryType: string }) => p.registryType === 'npm',
    );
    expect(npmPkg?.identifier).toBe('ibanforge-mcp');
    expect(npmPkg?.version).toBe(pkg.version);
  });
});

describe('the published manifest carries the positioning, not a generic blurb', () => {
  it('states what makes the product different, not just what it does', () => {
    // The registry rejected anything over 100 chars (commit 445d3aa), so this
    // one line has to earn its place: screening intent + the two moats.
    expect(published.description.length).toBeLessThanOrEqual(100);
    expect(published.description).toMatch(/pre-payout/i);
    expect(published.description).toMatch(/sanctions/i);
    expect(published.description).toMatch(/swiss/i);
  });

  it('points assistants at both transports', () => {
    expect(published.remotes?.[0]?.url).toBe('https://api.ibanforge.com/mcp');
    expect(published.packages?.[0]?.transport?.type).toBe('stdio');
  });
});
