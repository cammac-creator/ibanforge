import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LU_PUBLICATION, LU_SOURCE, lookupLuCode } from './lu-register.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibf-lu-runtime-'));
  directories.push(dir);
  const path = join(dir, 'lu-register.json');
  writeFileSync(
    path,
    JSON.stringify({
      schema: 1,
      source: LU_SOURCE,
      publication: LU_PUBLICATION,
      published: '2026-08-18',
      sha256: 'a'.repeat(64),
      entries: [{ code: '001', name: 'Établissement fictif Alpha', bic: 'ALPHLULL' }],
    }),
  );
  vi.stubEnv('LU_REGISTER_PATH', path);
  return path;
}

describe('enrichissement LU depuis un fichier privé', () => {
  it('reste inactif sans configuration', () => {
    vi.stubEnv('LU_REGISTER_PATH', '');
    expect(lookupLuCode('001')).toBeNull();
  });
  it('sert la correspondance directe et sa provenance sur le résultat IBAN', () => {
    file();
    const result = validateIBAN('LU280019400644750000');
    enrichResult(result);
    expect(result.valid).toBe(true);
    expect(result.bic).toMatchObject({
      code: 'ALPHLULL',
      bank_name: 'Établissement fictif Alpha',
      basis: 'national_register',
    });
    expect(result.bic?.source).toContain('published 2026-08-18');
    expect(result.bank_code_check).toMatchObject({
      status: 'verified',
      authoritative: false,
      as_of: '2026-08',
      institution: { name: 'Établissement fictif Alpha', country: 'LU' },
    });
    expect(result.bank_code_check?.register).toContain(LU_SOURCE);
  });
  it('une absence ne devient pas une non-attribution', () => {
    file();
    expect(lookupLuCode('987')).toBeNull();
    const result = validateIBAN('LU110029400644750000');
    expect(result.valid).toBe(true);
    enrichResult(result);
    expect(result.bank_code_check?.reason).not.toBe('not_allocated');
    expect(result.bank_code_check?.authoritative).not.toBe(true);
  });
  it('un fichier configuré manquant ou corrompu produit une indisponibilité, pas un rejet', () => {
    const path = file();
    writeFileSync(path, '{invalide');
    const result = validateIBAN('LU280019400644750000');
    enrichResult(result);
    expect(result.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'lookup_failed',
      authoritative: false,
    });
    rmSync(path);
    expect(() => lookupLuCode('001')).toThrow();
  });
});
