import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// AGENTS.md, rule 3: every image pins an exact patch of its Node line. A
// floating tag (`22-slim`, `24-slim`) let a builder keep a cached base layer or
// pick up a new release nobody chose, so the Node version actually served could
// not be read from the deployed commit. Dependabot's docker entries bump the
// patch, one entry per directory; they must ignore majors, since a major is a
// decision (Node 24 breaks better-sqlite3 in the API image).
//
// Each image is checked on its own: Dependabot opens one pull request per
// directory, so the API and the MCP image may sit on different 22.x patches for
// a while. Within one Dockerfile, every stage carries the same tag.
const IMAGES = [
  { name: 'API', dockerfile: 'Dockerfile', directory: '/', major: 22 },
  { name: 'site', dockerfile: 'frontend/Dockerfile', directory: '/frontend', major: 24 },
  { name: 'MCP server', dockerfile: 'mcp/Dockerfile', directory: '/mcp', major: 22 },
] as const;

const dependabot = readFileSync(resolve(ROOT, '.github/dependabot.yml'), 'utf8');
const dockerEntries = dependabot
  .split('- package-ecosystem: ')
  .filter((entry) => entry.startsWith('"docker"'));

describe.each(IMAGES)(
  '$name image Node version ($dockerfile)',
  ({ dockerfile, directory, major }) => {
    const docker = readFileSync(resolve(ROOT, dockerfile), 'utf8');
    const froms = docker.split('\n').filter((line) => line.startsWith('FROM '));

    it(`pins every stage to one exact ${major}.x patch`, () => {
      expect(froms.length).toBeGreaterThanOrEqual(2);
      const exact = new RegExp(`^FROM node:(${major}\\.\\d+\\.\\d+)-slim(\\s|$)`);
      const versions = froms.map((line) => exact.exec(line)?.[1]);
      expect(versions).not.toContain(undefined);
      expect(new Set(versions).size).toBe(1);
    });

    it(`is watched by Dependabot in ${directory}, majors ignored`, () => {
      const entries = dockerEntries.filter((entry) =>
        entry.includes(`directory: "${directory}"\n`),
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatch(/dependency-name: "node"/);
      expect(entries[0]).toMatch(/version-update:semver-major/);
    });
  },
);
