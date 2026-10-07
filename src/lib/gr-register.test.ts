import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GR_IMPORTANT_NOTE,
  GR_PUBLICATION,
  GR_SOURCE,
  grRegisterName,
  lookupGrCode,
} from './gr-register.js';
import { enrichResult, registerCoverage } from './enrich.js';
import { validateIBAN } from './iban.js';
import { registerCountries } from './positioning.js';

/**
 * Le registre grec servi depuis un fichier privé (07/10/2026). Les lignes sont
 * INVENTÉES : aucune donnée HEBIC n'entre dans ce dépôt public.
 */

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  directories.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibf-gr-runtime-'));
  directories.push(dir);
  const path = join(dir, 'gr-register.json');
  writeFileSync(
    path,
    JSON.stringify({
      schema: 1,
      source: GR_SOURCE,
      publication: GR_PUBLICATION,
      edition: '2099 Q2',
      read_on: '2099-03-04',
      sha256: 'a'.repeat(64),
      entries: [
        {
          code: '011',
          name: 'Τράπεζα Άλφα Παράδειγμα Α.Ε.',
          street: 'ΟΔΟΣ ΠΑΡΑΔΕΙΓΜΑΤΟΣ 1',
          post_code: '10000',
          town: 'ΑΘΗΝΑ',
        },
      ],
    }),
  );
  vi.stubEnv('GR_REGISTER_PATH', path);
  return path;
}

/** A Greek IBAN with this bank code and valid mod-97 check digits. */
function greekIban(bankCode: string): string {
  const bban = `${bankCode}01250000000012300695`;
  const digits = `${bban}GR00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `GR${String(98 - rest).padStart(2, '0')}${bban}`;
}

describe('registre grec HEBIC depuis un fichier privé', () => {
  it('reste inactif sans configuration, et la Grèce répond comme avant', () => {
    vi.stubEnv('GR_REGISTER_PATH', '');
    expect(lookupGrCode('011')).toBeNull();
    const result = validateIBAN(greekIban('011'));
    expect(result.valid).toBe(true);
    enrichResult(result);
    expect(result.bank_code_check?.register ?? '').not.toContain('HEBIC');
    expect(registerCountries().partial).not.toContain('GR');
  });

  it('nomme le titulaire, avec le crédit exact et l’Important Note en entier', () => {
    file();
    const result = validateIBAN(greekIban('011'));
    expect(result.valid).toBe(true);
    enrichResult(result);
    expect(result.bank_code_check).toMatchObject({
      value: '011',
      status: 'verified',
      match: 'register',
      authoritative: false,
      as_of: '2099-03',
      institution: {
        name: 'Τράπεζα Άλφα Παράδειγμα Α.Ε.',
        street: 'ΟΔΟΣ ΠΑΡΑΔΕΙΓΜΑΤΟΣ 1',
        post_code: '10000',
        town: 'ΑΘΗΝΑ',
        country: 'GR',
      },
    });
    const register = result.bank_code_check?.register ?? '';
    expect(register.startsWith('Source: Hellenic Bank Association (HEBIC)')).toBe(true);
    expect(register).toContain(`"${GR_IMPORTANT_NOTE}"`);
    expect(register).toBe(grRegisterName('2099 Q2', '2099-03-04'));
    // L'édition et le jour de lecture, jamais une date de publication.
    expect(register).toContain('edition 2099 Q2');
    expect(register).toContain('read by IBANforge on 2099-03-04');
    expect(register).not.toMatch(/published/i);
  });

  it('reproduit la note de la HBA mot pour mot', () => {
    expect(GR_IMPORTANT_NOTE).toBe(
      'HBA is not responsible for the accuracy of the data given by the banks. HBA has the right to make any adjustments when necessary and is not responsible for any misuse of the Greek Banking System (HEBIC) index',
    );
  });

  it('une absence retombe sur la réponse d’avant, jamais une non-attribution', () => {
    vi.stubEnv('GR_REGISTER_PATH', '');
    const before = validateIBAN(greekIban('987'));
    enrichResult(before);
    file();
    expect(lookupGrCode('987')).toBeNull();
    const after = validateIBAN(greekIban('987'));
    expect(after.valid).toBe(true);
    enrichResult(after);
    expect(after.bank_code_check).toEqual(before.bank_code_check);
    expect(after.bank_code_check?.reason).not.toBe('not_allocated');
    expect(after.bank_code_check?.reason).not.toBe('national_register_unavailable');
    expect(after.bank_code_check?.authoritative).not.toBe(true);
  });

  it('n’est jamais un registre qui fait foi, branché ou non', () => {
    vi.stubEnv('GR_REGISTER_PATH', '');
    expect(registerCoverage('GR').basis).not.toBe('authoritative');
    file();
    expect(registerCoverage('GR').basis).not.toBe('authoritative');
    expect(registerCountries().authoritative).not.toContain('GR');
    expect(registerCountries().partial).toContain('GR');
  });

  it('un fichier configuré corrompu produit une indisponibilité, pas un rejet', () => {
    const path = file();
    writeFileSync(path, '{invalide');
    const result = validateIBAN(greekIban('011'));
    enrichResult(result);
    expect(result.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'lookup_failed',
      authoritative: false,
    });
  });
});
