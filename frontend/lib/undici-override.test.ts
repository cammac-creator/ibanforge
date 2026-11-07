import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Le correctif de sécurité demande au moins 7.30.1 dans la branche 7.x.
 * Scalar utilise désormais 8.x : l'ancien override global lui imposait 7.x.
 * Les plages des autres consommateurs permettent déjà le correctif ; le verrou
 * conserve donc leurs versions compatibles sans forcer une majeure commune.
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
      expect(pkg.overrides?.undici, `pinned below 7.30.1 by ${names}`).toBe('^7.30.1');
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

  it('ne force jamais 7.x sur un consommateur qui demande une autre majeure', () => {
    const consumers = undiciConsumers();
    expect(consumers.length).toBeGreaterThan(0);
    if (pkg.overrides?.undici) {
      for (const [path, range] of consumers) {
        expect(range, `${path} demande undici ${range}`).toMatch(/^(\^|~|>=\s*)?7\./);
      }
    }
  });
});
