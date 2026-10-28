import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// AGENTS.md, rule 3: the production image pins an exact 22.x patch. The floating
// `22-slim` let a builder keep a cached base layer, so the Node version actually
// served could not be read from the deployed commit. Dependabot's docker entry
// bumps the patch; it must ignore majors, since Node 24 breaks better-sqlite3.
describe('API image Node version', () => {
  const docker = readFileSync(resolve(ROOT, 'Dockerfile'), 'utf8');
  const froms = docker.split('\n').filter((line) => line.startsWith('FROM '));

  it('pins every stage to one exact 22.x patch', () => {
    expect(froms.length).toBeGreaterThanOrEqual(2);
    const versions = froms.map((line) => /^FROM node:(22\.\d+\.\d+)-slim(\s|$)/.exec(line)?.[1]);
    expect(versions).not.toContain(undefined);
    expect(new Set(versions).size).toBe(1);
  });

  it('is watched by Dependabot, majors ignored', () => {
    const dependabot = readFileSync(resolve(ROOT, '.github/dependabot.yml'), 'utf8');
    const entry = dependabot.split('- package-ecosystem: ').find((e) => e.startsWith('"docker"'));
    expect(entry).toBeDefined();
    expect(entry).toMatch(/directory: "\/"/);
    expect(entry).toMatch(/dependency-name: "node"/);
    expect(entry).toMatch(/version-update:semver-major/);
  });
});
