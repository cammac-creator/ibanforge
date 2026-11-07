import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Planchers publiés par nodejs/undici le 05.11.2026 :
 * https://github.com/nodejs/undici/security/advisories/GHSA-3g9m-rv3r-w5w2
 * https://github.com/nodejs/undici/security/advisories/GHSA-9v6h-8rgp-m69f
 * Scalar épingle 8.x ; chaque majeure garde son propre correctif compatible.
 */
const ROOT = resolve(__dirname, '..');
const PATCHED: Record<number, number[]> = { 7: [7, 30, 2], 8: [8, 12, 4] };

function atLeastPatched(version: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split('.').map(Number);
  const minimum = PATCHED[parts[0]];
  if (!minimum) return false;
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
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

/** Chaque consommateur et la plage Undici qu’il déclare. */
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

describe('Undici conserve le correctif de sécurité et ses majeures compatibles', () => {
  it('signale un consommateur qui épingle une version antérieure au correctif', () => {
    const pinning = undiciConsumers().filter(([, range]) => /^\d+\.\d+\.\d+$/.test(range));
    const stillOld = pinning.filter(([, range]) => !atLeastPatched(range));
    if (stillOld.length > 0) {
      const names = stillOld.map(([path]) => path).join(', ');
      for (const [path, range] of stillOld) {
        const major = Number(range.split('.')[0]);
        expect(PATCHED[major], `${path} demande une majeure à relire : ${range}`).toBeDefined();
        expect(pkg.overrides?.[`undici@${major}`], `version vulnérable épinglée par ${names}`).toBe(`^${PATCHED[major].join('.')}`);
      }
    }
  });

  it('ne contient aucune copie antérieure au correctif', () => {
    const copies = Object.entries(lock.packages).filter(
      ([path]) => path === 'node_modules/undici' || path.endsWith('/node_modules/undici'),
    );
    expect(copies.length).toBeGreaterThan(0);
    for (const [path, { version }] of copies) {
      expect(atLeastPatched(version ?? ''), `${path} ${version}`).toBe(true);
    }
  });

  it('ne force aucune majeure sur les consommateurs d’une autre majeure', () => {
    expect(undiciConsumers().length).toBeGreaterThan(0);
    expect(pkg.overrides?.undici).toBeUndefined();
    expect(pkg.overrides?.['undici@7']).toBe('^7.30.2');
    expect(pkg.overrides?.['undici@8']).toBe('^8.12.4');
  });

  it.each(['7.30.1', '8.0.0', '8.12.3', '8.12.4-beta.1', '9.0.0', ''])('refuse la version vulnérable ou non relue %s', version => {
    expect(atLeastPatched(version)).toBe(false);
  });

  it.each(['7.30.2', '7.31.0', '8.12.4', '8.13.0'])('accepte le correctif compatible %s', version => {
    expect(atLeastPatched(version)).toBe(true);
  });
});
