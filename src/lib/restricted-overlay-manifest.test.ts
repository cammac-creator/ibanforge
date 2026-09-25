import { describe, expect, it } from 'vitest';
import {
  MANIFEST_FORMAT,
  compareManifests,
  parseManifest,
  type ManifestFile,
  type OverlayManifest,
} from './restricted-overlay-manifest.js';

/**
 * Le format du manifeste d'une release de la surcouche privée (étape 5) : ce que
 * l'API accepte de lire avant tout téléchargement, et la porte de qualité du
 * dépôt privé. Valeurs inventées.
 */

function file(partial: Partial<ManifestFile> = {}): ManifestFile {
  return {
    name: 'restricted-compliance.sqlite',
    sha256: 'a'.repeat(64),
    bytes: 4096,
    generated_at: '2026-09-27T06:30:00.000Z',
    public_commit: '0123456789abcdef0123456789abcdef01234567',
    members: { un: 5, epc_sepa: 4000, epc_vop: 1200 },
    ...partial,
  };
}

function manifest(files: OverlayManifest['files']): OverlayManifest {
  return {
    format: MANIFEST_FORMAT,
    generated_at: '2026-09-27T06:31:00.000Z',
    public_commit: '0123456789abcdef0123456789abcdef01234567',
    files,
  };
}

describe('parseManifest', () => {
  it('relit un manifeste écrit par le dépôt privé', () => {
    const m = manifest({ compliance: file(), bic: file({ name: 'restricted-bic.sqlite' }) });
    expect(parseManifest(JSON.stringify(m))).toEqual({ ok: true, manifest: m });
  });

  it('refuse tout ce qui n’est pas exactement le format, avec un code court', () => {
    const cases: Array<[unknown, string]> = [
      ['pas du JSON', 'manifest_not_json'],
      [[1, 2], 'manifest_not_object'],
      [{ ...manifest({}), format: 2 }, 'manifest_format'],
      [{ ...manifest({}), generated_at: '27.09.2026' }, 'manifest_generated_at'],
      [{ ...manifest({}), public_commit: 'main' }, 'manifest_public_commit'],
      [{ ...manifest({}), files: [] }, 'manifest_files'],
      [{ ...manifest({}), files: { lu: file() } }, 'manifest_unknown_kind'],
    ];
    for (const [value, error] of cases) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      expect(parseManifest(text), text).toEqual({ ok: false, error });
    }
  });

  it('refuse un fichier mal décrit : nom, empreinte, taille, date, membres', () => {
    const bad: Array<Partial<ManifestFile> | Record<string, unknown>> = [
      { name: '../restricted-bic.sqlite' },
      { name: 'restricted-bic.db' },
      { sha256: 'A'.repeat(64) },
      { sha256: 'a'.repeat(63) },
      { bytes: 0 },
      { bytes: 1.5 },
      { generated_at: 'hier' },
      { public_commit: 'zz' },
      { members: { un: -1 } },
      { members: { 'Un Membre': 1 } },
      { members: [] },
    ];
    for (const partial of bad) {
      const m = manifest({ compliance: { ...file(), ...partial } as ManifestFile });
      expect(parseManifest(JSON.stringify(m)), JSON.stringify(partial)).toEqual({
        ok: false,
        error: 'manifest_file_invalid:compliance',
      });
    }
  });

  it('accepte un commit inconnu (null) et une base absente', () => {
    const m = manifest({ bic: file({ name: 'restricted-bic.sqlite', public_commit: null }) });
    expect(parseManifest(JSON.stringify({ ...m, public_commit: null }))).toMatchObject({
      ok: true,
    });
  });
});

describe('compareManifests, la porte de qualité', () => {
  const previous = manifest({ compliance: file(), bic: file({ name: 'restricted-bic.sqlite' }) });

  it('une release ordinaire passe', () => {
    const next = manifest({
      compliance: file({ members: { un: 4, epc_sepa: 3900, epc_vop: 1250 } }),
      bic: file({ name: 'restricted-bic.sqlite' }),
    });
    expect(compareManifests(previous, next)).toEqual([]);
  });

  it('un fichier ou un membre perdu, une chute brutale : refusés', () => {
    const next = manifest({ compliance: file({ members: { un: 5, epc_sepa: 3000 } }) });
    expect(compareManifests(previous, next)).toEqual([
      'lost_file:bic',
      'shrunk:compliance:epc_sepa:4000->3000',
      'lost_member:compliance:epc_vop',
    ]);
  });

  it('sous SHRINK_GUARD_MIN_ROWS, un pourcentage ne veut rien dire', () => {
    const next = manifest({
      compliance: file({ members: { un: 1, epc_sepa: 4000, epc_vop: 1200 } }),
      bic: file({ name: 'restricted-bic.sqlite' }),
    });
    expect(compareManifests(previous, next)).toEqual([]);
  });

  it('le contrôle manuel laisse passer les baisses, jamais un fichier perdu', () => {
    const next = manifest({ compliance: file({ members: { un: 5 } }) });
    expect(compareManifests(previous, next, { allowShrink: true })).toEqual(['lost_file:bic']);
  });
});
