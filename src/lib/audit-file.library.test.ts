/**
 * Le dépôt de fichier et sa bibliothèque de tableur, vus par les appels qu'il
 * lui fait (11.11.2026).
 *
 * La bibliothèque est remplacée par elle-même, à l'identique, sauf deux points
 * d'observation : ses appels de lecture sont comptés, et l'activation de son
 * zlib natif peut être rendue sans effet, comme quand son propre essai rate en
 * silence. Rien d'autre ne change : chaque lecture passe par la vraie
 * bibliothèque.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const library = vi.hoisted(() => ({
  /** Faux : l'activation du zlib natif ne fait rien, comme un essai raté. */
  nativeZlib: true,
  reads: 0,
}));

vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>();
  const cfb = actual.CFB as unknown as {
    read: (...args: unknown[]) => unknown;
    utils: Record<string, unknown> & { use_zlib(lib: unknown): void };
  };
  return {
    ...actual,
    read: (...args: Parameters<typeof actual.read>) => {
      library.reads++;
      return actual.read(...args);
    },
    CFB: {
      ...cfb,
      read: (...args: unknown[]) => {
        library.reads++;
        return cfb.read(...args);
      },
      utils: {
        ...cfb.utils,
        use_zlib: (lib: unknown) => {
          if (library.nativeZlib) cfb.utils.use_zlib(lib);
        },
      },
    },
  };
});

afterEach(() => {
  library.nativeZlib = true;
});

describe('la décompression native est vérifiée au chargement', () => {
  it('le module refuse de se charger quand le zlib natif n’est pas actif, et se charge sinon', async () => {
    library.nativeZlib = false;
    vi.resetModules();
    await expect(import('./audit-file.js')).rejects.toThrow(/zlib natif/);

    library.nativeZlib = true;
    vi.resetModules();
    const mod = await import('./audit-file.js');
    expect(typeof mod.readTable).toBe('function');
  });
});
