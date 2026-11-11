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
import * as XLSX from 'xlsx';

const library = vi.hoisted(() => ({
  /** Faux : l'activation du zlib natif ne fait rien, comme un essai raté. */
  nativeZlib: true,
  reads: 0,
  /** Le dernier classeur que la lecture a rendu. */
  lastWorkbook: null as unknown,
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
      library.lastWorkbook = actual.read(...args);
      return library.lastWorkbook;
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

const { readTable, AuditFileError, AUDIT_MAX_COLUMNS, AUDIT_MAX_ROWS } =
  await import('./audit-file.js');

afterEach(() => {
  library.nativeZlib = true;
});

const VALID_CH = 'CH1000230000000012345';

/** Le code du refus de `fn`, et le nombre d'appels de lecture faits à la bibliothèque. */
function refusalOf(fn: () => unknown): { code: string; reads: number } {
  const before = library.reads;
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AuditFileError);
    return { code: (e as InstanceType<typeof AuditFileError>).code, reads: library.reads - before };
  }
  throw new Error('aucun refus');
}

describe('un texte refusé l’est avant tout appel à la bibliothèque', () => {
  const lines = (n: number) => ['IBAN', ...Array.from({ length: n }, () => VALID_CH)].join('\n');
  const header = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`).join(';');

  it.each([
    ['balisage', Buffer.from('<table><tr><td>IBAN</td></tr></table>'), 'export.csv', 'unreadable'],
    ['ni archive, ni classeur, ni texte', Buffer.alloc(64, 0), 'export.xls', 'unreadable'],
    ['trop de lignes', Buffer.from(lines(AUDIT_MAX_ROWS + 1)), 'export.csv', 'too_many_rows'],
    [
      'trop de colonnes',
      Buffer.from(`${header(AUDIT_MAX_COLUMNS + 1)}\n${VALID_CH}`),
      'export.csv',
      'file_too_large',
    ],
  ])('%s : refusé sans que la bibliothèque soit appelée', (_label, file, name, code) => {
    expect(refusalOf(() => readTable(file, name))).toEqual({ code, reads: 0 });
  });

  it('un texte accepté, lui, est bien lu par la bibliothèque (le compte n’est pas vide)', () => {
    const before = library.reads;
    expect(readTable(Buffer.from(lines(2)), 'export.csv').rows).toHaveLength(2);
    expect(library.reads - before).toBe(1);
  });
});

/**
 * Les formules ne sont pas analysées (10.11.2026) : l'audit lit les valeurs que
 * le classeur a gardées. Vérifié sur le classeur que la bibliothèque rend, en
 * comptant, sans chronomètre.
 */
describe('les formules ne sont pas analysées', () => {
  it('lit les valeurs gardées et laisse les formules, matricielles comprises, hors du classeur lu', () => {
    const rows = 20;
    const columns = 5;
    const ws = XLSX.utils.aoa_to_sheet([['IBAN']]);
    for (let r = 1; r <= rows; r++) {
      for (let c = 0; c < columns; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        ws[ref] =
          c % 2 === 0
            ? { t: 'n', v: 1, f: '1', F: `${ref}:${ref}` }
            : { t: 'n', v: 2, f: `${XLSX.utils.encode_col(c - 1)}${r + 1}+1` };
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows, c: columns - 1 } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Feuil1');
    const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    // Le fichier porte bien ses formules : la bibliothèque, lue sans les options
    // de l'audit, les rend.
    const withFormulas = XLSX.read(file, { type: 'buffer', cellFormula: true });
    const formulas = (book: XLSX.WorkBook) =>
      Object.entries(book.Sheets[book.SheetNames[0]!]!).filter(
        ([key, cell]) => !key.startsWith('!') && ('f' in cell || 'F' in cell),
      ).length;
    expect(formulas(withFormulas)).toBe(rows * columns);

    const t = readTable(file, 'formules.xlsx');
    expect(t.rows).toHaveLength(rows);
    expect(t.rows[0]!.slice(0, 2)).toEqual(['1', '2']);
    expect(formulas(library.lastWorkbook as XLSX.WorkBook)).toBe(0);
  });
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
