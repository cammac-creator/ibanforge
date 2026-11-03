import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `undici`, held at or above the patched 7.30.1 by an `overrides` entry.
 *
 * Eight advisories (high and medium) were open against 7.29.1 on 3 November
 * 2026, fixed in 7.30.1. `@scalar/json-magic` 0.16.0, under the API reference
 * page, pins exactly `7.29.1`, so neither `npm update` nor a lockfile edit can
 * lift it: the override in `package.json` does.
 *
 * When to remove the override: once no package in the lockfile declares an
 * `undici` range that excludes 7.30.1 (the test below names the ones that still
 * do), delete the entry and run `npm install`; the first two tests then still
 * hold through the ranges alone.
 *
 * The override is global. It must never hold a consumer below the major it
 * asks for: the last test fails the day a package of the tree declares an
 * `undici` range outside 7.x, so the override is revisited rather than
 * silently forcing 7.x on it.
 */
const ROOT = resolve(__dirname, '..');
const PATCHED = [7, 30, 1];

function atLeastPatched(version: string): boolean {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < PATCHED.length; i++) {
    if (parts[i] !== PATCHED[i]) return parts[i] > PATCHED[i];
  }
  return true;
}

type LockEntry = {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockEntry>;
};
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  overrides?: Record<string, unknown>;
};

/** Every package of the tree that declares an `undici` range, with that range. */
function undiciConsumers(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    for (const deps of [entry.dependencies, entry.optionalDependencies, entry.peerDependencies]) {
      const range = deps?.undici;
      if (range) found.push([path, range]);
    }
  }
  return found;
}

describe('undici, held at or above the patched 7.30.1', () => {
  it('is overridden in package.json while a consumer still pins an older release', () => {
    const pinning = undiciConsumers().filter(([, range]) => /^\d+\.\d+\.\d+$/.test(range));
    const stillOld = pinning.filter(([, range]) => !atLeastPatched(range));
    if (stillOld.length > 0) {
      const names = stillOld.map(([path]) => path).join(', ');
      expect(pkg.overrides?.undici, `pinned below 7.30.1 by ${names}`).toBe('^7.30.1');
    }
  });

  it('has a single copy in the lockfile, at 7.30.1 or above', () => {
    const copies = Object.entries(lock.packages).filter(
      ([path]) => path === 'node_modules/undici' || path.endsWith('/node_modules/undici'),
    );
    expect(copies.map(([path]) => path)).toEqual(['node_modules/undici']);
    for (const [path, { version }] of copies) {
      expect(atLeastPatched(version ?? ''), `${path} ${version}`).toBe(true);
    }
  });

  it('never holds a consumer outside the 7.x it asks for', () => {
    const consumers = undiciConsumers();
    expect(consumers.length).toBeGreaterThan(0);
    for (const [path, range] of consumers) {
      expect(range, `${path} asks for undici ${range}`).toMatch(/^(\^|~|>=\s*)?7\./);
    }
  });
});
