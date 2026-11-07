import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Planchers publiés dans GHSA-866g-f22w-33x8, relus le 07.11.2026 :
// https://github.com/advisories/GHSA-866g-f22w-33x8
// La branche 5.x de Scalar doit conserver ses interfaces, sans surcharge 4.x.
const MINIMUM: Record<number, number[]> = { 3: [3, 0, 28], 4: [4, 0, 33], 5: [5, 0, 1] };
function corrected(version: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split('.').map(Number);
  const minimum = MINIMUM[parts[0]];
  if (!minimum) return false;
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] !== minimum[i]) return parts[i] > minimum[i];
  }
  return true;
}

describe('provider-utils conserve le correctif dans chaque majeure', () => {
  it('vérifie chaque copie réellement verrouillée', () => {
    const root = resolve(__dirname, '..');
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith('node_modules/@ai-sdk/provider-utils'));
    expect(copies.length).toBeGreaterThan(0);
    for (const [path, entry] of copies) expect(corrected(entry.version ?? ''), `${path} ${entry.version}`).toBe(true);
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.overrides?.['@ai-sdk/provider-utils']).toBeUndefined();
  });
  it.each(['3.0.27', '4.0.32', '5.0.0', '5.0.1-beta.1', '6.0.0', ''])('refuse %s', version => {
    expect(corrected(version)).toBe(false);
  });
  it.each(['3.0.28', '4.0.33', '5.0.1', '5.0.61'])('accepte %s', version => {
    expect(corrected(version)).toBe(true);
  });
});
