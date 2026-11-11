/**
 * Creditor-file audit: the engine behind the paid "audit de fichier".
 *
 * A CSV or XLSX of creditors comes in; every row goes through the same
 * validation and enrichment the API serves per call (validateIBAN +
 * enrichResult, in-process, no HTTP, no key, no quota), plus the checks a
 * single-IBAN call cannot make because they need the whole file: duplicates,
 * the BIC the file carries against the BIC the register derives, the address
 * country against the IBAN country, and the ISO 20022 postal-address
 * conformity the SIX deadline of 14.11.2026 makes urgent for Swiss creditor
 * files. Since 29.10.2026, a Swiss or Liechtenstein address (country column CH
 * or LI) also has its postcode and town looked up in the official directory of
 * localities of swisstopo: a warning when the directory contradicts the pair
 * or knows neither half of it, never an error; a postcode it lacks while it
 * lists the town nearby (a post-office box, likely) stays unverified, without
 * a warning (src/lib/ch-localities.ts).
 *
 * Nothing here touches storage: the caller decides what to keep and for how
 * long. Findings carry stable codes; the labels are rendered per language at
 * the edge (workbook, preview) so the engine stays language-free.
 */
import * as zlib from 'node:zlib';
import * as XLSX from 'xlsx';
import { validateIBAN } from './iban.js';
import { createEnrichCache, enrichResult, registerCoverage, type RegisterBasis } from './enrich.js';
import { checkPostalAddress, type AddressScheme } from './address-conformity.js';
import { POSTCODE_LOCALITY_WARNINGS, loadChLocalities } from './ch-localities.js';
import type { IBANValidationResult } from '../types.js';

/**
 * SheetJS décompresse les classeurs avec le zlib natif de Node (10.11.2026).
 *
 * Par défaut, il décompresse avec un décodeur à lui, dont le coût n'est pas
 * celui que la garde de décompression mesure avec zlib. Avec `use_zlib`,
 * SheetJS passe par le même zlib que la garde, sur les mêmes octets : ce
 * qu'elle a mesuré borne ce qu'il fait. L'appel natif n'a pas de plafond de
 * sortie à lui ; c'est `checkUnzippedSize`, toujours appelée avant, qui borne.
 *
 * SheetJS avance dans l'archive avec `bytesRead`, que Node déprécie (DEP0108)
 * et annonce vouloir changer de sens. La classe ci-dessous le fixe aux octets
 * consommés (`bytesWritten`), sans avertissement : un classeur écrit en flux,
 * qui dépend de ce compte, est lu dans les tests (`audit-file.test.ts`). Elle
 * compte aussi les flux qu'elle décompresse : c'est la preuve, lue au
 * chargement, que SheetJS passe bien par elle.
 */
class InflateRawCountingInput extends zlib.InflateRaw {
  static streams = 0;
  constructor(options?: zlib.ZlibOptions) {
    super(options);
    InflateRawCountingInput.streams++;
  }
  get bytesRead(): number {
    return this.bytesWritten;
  }
}

/** Les quelques fonctions de l'archiveur de SheetJS que ce module appelle. */
interface CfbEntry {
  content?: Uint8Array | number[];
}
const CFB = XLSX.CFB as unknown as {
  read(data: Buffer, opts: { type: 'buffer' }): unknown;
  find(cfb: unknown, path: string): CfbEntry | null;
  write(cfb: unknown, opts: { type: 'buffer'; fileType: 'zip'; compression: boolean }): Buffer;
  utils: {
    use_zlib(lib: unknown): void;
    cfb_new(): unknown;
    cfb_add(cfb: unknown, name: string, content: Buffer): void;
  };
};

/**
 * Vérifie, au chargement, que SheetJS décompresse réellement par la classe
 * ci-dessus, et échoue fermé sinon (11.11.2026).
 *
 * `use_zlib` n'échoue jamais à voix haute : si son essai rate, SheetJS l'écrit
 * en console et garde son propre décodeur, et la garde ne bornerait plus ce
 * qu'il fait. Une petite archive compressée est donc relue ici par le même
 * chemin que les classeurs : sans un flux passé par la classe, ou sans le bon
 * contenu, le module refuse de se charger, et l'API avec lui (un déploiement qui
 * ne démarre pas laisse le précédent en place). Rien n'est lu sur le disque.
 */
function assertNativeInflate(): void {
  const expected = Buffer.from('ibanforge native inflate probe');
  const archive = CFB.utils.cfb_new();
  CFB.utils.cfb_add(archive, 'probe.txt', expected);
  const zip = CFB.write(archive, { type: 'buffer', fileType: 'zip', compression: true });
  const before = InflateRawCountingInput.streams;
  let content: CfbEntry['content'];
  try {
    content = CFB.find(CFB.read(zip, { type: 'buffer' }), '/probe.txt')?.content;
  } catch (err) {
    content = undefined;
    console.error('[audit-file] relecture de l’archive d’essai :', (err as Error).message);
  }
  const read = content ? Buffer.from(content) : null;
  if (InflateRawCountingInput.streams === before || !read || !read.equals(expected)) {
    throw new Error(
      '[audit-file] SheetJS ne décompresse pas par le zlib natif (use_zlib sans effet) : ' +
        'le dépôt de fichier refuse de se charger plutôt que de lire sans sa garde.',
    );
  }
}

CFB.utils.use_zlib({ ...zlib, InflateRaw: InflateRawCountingInput });
assertNativeInflate();

export const AUDIT_MAX_ROWS = 20_000;
/**
 * Byte ceiling on an upload, raised from 5 MB on 22/09/2026 so the volume the
 * page SELLS can actually be delivered.
 *
 * The $349 tier is sold as "up to 20,000 rows". A real creditor master runs
 * around 335 bytes per row over eight columns, so 20,000 rows weigh about
 * 6.7 MB — measured that day, a 5 MB cap cut the file at roughly 14,700 rows
 * and the customer met `file_too_large` on a file the price list promised to
 * accept. The ceiling now leaves room for the row cap instead of contradicting
 * it, with margin for a wider sheet (10 MB ≈ 500 bytes per row at the cap).
 *
 * The row cap, not this one, is what bounds the CPU: `readTable` counts lines
 * before decoding a CSV and hands SheetJS `sheetRows`, so a bigger buffer buys
 * an attacker bytes, never parsing work.
 */
export const AUDIT_MAX_BYTES = 10 * 1024 * 1024;
/**
 * How many sheet rows the parser is allowed to materialise: the cap, the
 * header, and one row past the cap so `too_many_rows` still fires on exactly
 * cap + 1 data rows. Everything beyond is never read (see readTable).
 */
export const SHEET_ROWS_CAP = AUDIT_MAX_ROWS + 2;
/**
 * Plafond de ce qu'un classeur peut peser une fois décompressé (SEC-02, audit
 * du 10.11.2026).
 *
 * Un .xlsx est une archive zip : dix mégaoctets compressés pouvaient se
 * décompresser en centaines de mégaoctets, et SheetJS décompresse TOUTES les
 * parties avant de lire quoi que ce soit, sur le fil unique du serveur. Mesuré
 * le 10.11.2026 : un classeur de créanciers de 20 000 lignes sur huit colonnes
 * se décompresse en 6 à 7 Mo, quelle que soit la façon de l'écrire. Soixante
 * mégaoctets laissent une marge de près de dix fois, pour les classeurs larges
 * ou chargés de styles.
 */
export const AUDIT_MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;
/** Parties d'archive admises. Un classeur ordinaire en compte une douzaine. */
export const AUDIT_MAX_ZIP_ENTRIES = 5_000;
/**
 * Plafond de la plage lue dans la feuille, en cases (lignes fois colonnes) :
 * cent colonnes sur toute la hauteur que l'analyseur matérialise (10.11.2026).
 *
 * `sheetRows` borne les lignes, rien ne bornait les colonnes : la lecture
 * remplit chaque case vide de la plage (`defval: ''`), puis le rapport recopie
 * toutes les colonnes source. Un fichier de créanciers tient en huit à trente
 * colonnes ; à ce plafond, un fichier de 20 000 lignes sur cent colonnes passe
 * encore. La hauteur prise est SHEET_ROWS_CAP, pour qu'un fichier d'une ligne
 * de trop reçoive toujours `too_many_rows` et pas ce refus-ci.
 */
export const AUDIT_MAX_COLUMNS_AT_ROW_CAP = 100;
export const AUDIT_MAX_CELLS = SHEET_ROWS_CAP * AUDIT_MAX_COLUMNS_AT_ROW_CAP;
/**
 * Plafond de colonnes d'un fichier quelconque, quel que soit son nombre de
 * lignes (11.11.2026).
 *
 * Le plafond de cases borne le total, pas la forme : une feuille de très peu de
 * lignes pouvait porter un nombre de colonnes sans rapport avec un fichier de
 * créanciers, et l'audit comme le classeur rendu suivent chaque colonne source.
 * Un fichier de créanciers tient en huit à trente colonnes, et un export large
 * reste bien en dessous de quelques centaines : cinq cents colonnes laissent une
 * marge large. Un texte est mesuré avant d'être lu (`delimitedExtent`), un
 * classeur sur ses cellules réelles avant d'être parcouru (`boundSheetRange`).
 * Le plafond de cases reste en place à côté de celui-ci.
 */
export const AUDIT_MAX_COLUMNS = 500;
/**
 * Texte total d'une table lue (11.11.2026) : trente-deux caractères en moyenne
 * sur chaque case du plafond de cases. Un nom, une adresse ou un IBAN tiennent
 * en dessous, et un fichier délimité au plafond d'octets n'y arrive pas. Le
 * rapport recopie chaque case : le texte est mesuré avant l'audit et le rapport.
 */
export const AUDIT_MAX_TEXT_CHARS = 32 * AUDIT_MAX_CELLS;
/**
 * Le plus long texte d'une case (11.11.2026) : le plus qu'une cellule de tableur
 * peut tenir, donc le rapport. Au-delà, le fichier est refusé plutôt que la
 * case tronquée en silence dans le rapport.
 */
export const AUDIT_MAX_CELL_CHARS = 32_767;
/**
 * Price tiers, in US dollars (16/09/2026; the same figures were charged in CHF
 * until then, on Claude-Alain's decision to sell everything in one currency).
 * The tier is decided by the row count, nothing else.
 */
export const AUDIT_TIERS = [
  { max_rows: 5_000, price: 149, code: 'standard' },
  { max_rows: AUDIT_MAX_ROWS, price: 349, code: 'large' },
] as const;
export const AUDIT_CURRENCY = 'USD';
export type AuditTierCode = (typeof AUDIT_TIERS)[number]['code'];

export type AuditLang = 'en' | 'fr' | 'de';

export type FindingCode =
  | 'iban_missing'
  | 'iban_invalid'
  | 'bank_code_not_allocated'
  | 'modulus_check_failed'
  | 'national_check_digits_failed'
  | 'national_check_digits_suspect'
  | 'sepa_not_reachable'
  | 'test_bic'
  | 'bic_mismatch'
  | 'country_mismatch'
  | 'duplicate'
  | 'issuer_not_bank'
  | 'country_risk'
  | 'address_not_structured'
  | 'postcode_locality_mismatch'
  | 'verify_payee_name'
  | 'bank_not_consulted';

export type RowStatus = 'ok' | 'warning' | 'error';

/** Which finding codes stop a payment (error) versus deserve a look (warning). */
const ERROR_CODES: ReadonlySet<FindingCode> = new Set([
  'iban_missing',
  'iban_invalid',
  'bank_code_not_allocated',
  'modulus_check_failed',
  // 26/09/2026 : même pied que le contrôle britannique, comme l'étape
  // `national_check_digits_failed` de next_steps.
  'national_check_digits_failed',
]);

export interface AuditFinding {
  code: FindingCode;
  /** Free-text detail in English, for the workbook's "detail" column and the JSON. */
  detail: string;
}

export interface AuditColumnMap {
  iban: number;
  name?: number;
  bic?: number;
  street?: number;
  building?: number;
  postal?: number;
  city?: number;
  country?: number;
}

export interface AuditRow {
  /** 1-based line in the source sheet, header excluded. */
  line: number;
  iban_input: string;
  iban: string | null;
  status: RowStatus;
  findings: AuditFinding[];
  country: string | null;
  bank_name: string | null;
  bic_registry: string | null;
  bic_file: string | null;
  sepa_reachable: boolean | null;
  address_verdict: 'pass' | 'fail' | 'not_applicable' | null;
  /**
   * Whether the IBAN's country has a register that settles a NEGATIVE, and its
   * name. Carried per row because a creditor file mixes countries and the
   * answer changes country by country: in Germany "not in the register" means
   * the code is not allocated, in Italy it means nothing at all. Without it
   * every clean line read the same, and a reader was free to take our silence
   * about an Italian bank code for a clearance.
   */
  register_basis: RegisterBasis;
  register: string | null;
  next_steps: string[];
}

export interface AuditSummary {
  rows: number;
  ok: number;
  warning: number;
  error: number;
  by_code: Partial<Record<FindingCode, number>>;
  /** One line per IBAN country met, with what its register is worth. */
  countries: Array<{
    code: string;
    rows: number;
    register_basis: RegisterBasis;
    register: string | null;
  }>;
  /** Rows whose country has no register that settles a negative. */
  rows_without_authoritative_register: number;
  columns_detected: Array<keyof AuditColumnMap>;
  address_checked: boolean;
  tier: AuditTierCode;
  price: number;
  /** ISO 4217 code of `price`: USD since 16/09/2026. */
  currency: string;
}

export interface AuditResult {
  headers: string[];
  columns: AuditColumnMap;
  rows: AuditRow[];
  source_rows: string[][];
  summary: AuditSummary;
}

export class AuditFileError extends Error {
  constructor(
    public readonly code:
      'unreadable' | 'empty' | 'too_many_rows' | 'no_iban_column' | 'file_too_large',
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/** Parse a CSV or XLSX buffer into a header row and string cells. */
export function readTable(buffer: Buffer, filename = ''): { headers: string[]; rows: string[][] } {
  let wb: XLSX.WorkBook;
  try {
    // Le format se décide sur le contenu, avant toute autre borne (10.11.2026).
    // Une archive zip va au lecteur de classeur quel que soit son nom : lue
    // comme du texte, elle passerait quand même par le lecteur zip de SheetJS,
    // qui reconnaît la signature, mais sans la garde de décompression. Un XLS
    // binaire (signature OLE) va de même au lecteur de classeur. Tout le reste
    // doit être du texte délimité, lu comme tel, ou il est refusé.
    const isZip = looksLikeZip(buffer);
    if (isZip || looksLikeOle(buffer)) {
      if (isZip) checkUnzippedSize(buffer);
      else refuseMeasure({ ...emptyMeasure(), linkCells: xlsLinkCells(buffer) });
      // `cellFormula: false` : l'audit ne lit que les valeurs. Les formules ne
      // sont plus analysées du tout, et leur coût disparaît avec elles
      // (10.11.2026).
      wb = XLSX.read(buffer, {
        type: 'buffer',
        raw: true,
        cellDates: false,
        sheetRows: SHEET_ROWS_CAP,
        cellFormula: false,
        // Seule la première feuille est lue plus bas : les autres ne sont
        // plus analysées du tout (elles restent décompressées, d'où la garde).
        sheets: 0,
      });
    } else {
      const decoded = textOf(buffer, filename);
      if (!decoded) throw notAcceptedFormat('not a spreadsheet or delimited text');
      // Un fichier de balisage est refusé avant d'être compté : découper en
      // morceaux un fichier qui serait refusé ensuite ne servirait à rien.
      refuseMarkup(decoded.text);
      // Count before parsing. The row cap used to be applied after the whole
      // sheet had been materialised, so a 4.5 MB workbook of 150 000 rows cost
      // ~1.3 s of synchronous CPU before its 400 — on a keyless route, enough
      // for one address to stall the single instance (adversarial review of
      // 07/09/2026, finding A1). `sheetRows` makes SheetJS stop reading at the
      // cap; for UTF-8 text the line count of the buffer is the same bound,
      // taken without parsing it. In UTF-16 a newline byte can sit inside
      // another character, so the decoded text is counted instead.
      if (countLines(decoded.utf16 ? decoded.text : buffer) > AUDIT_MAX_ROWS + 1) {
        throw new AuditFileError(
          'too_many_rows',
          `The file has more than ${AUDIT_MAX_ROWS} lines; the audit takes at most ${AUDIT_MAX_ROWS} rows.`,
        );
      }
      wb = readDelimitedText(decoded.text);
    }
  } catch (e) {
    // 🚨 Our own verdicts leave by the front door. The `too_many_rows` guard a
    // few lines up throws INSIDE this try, so until 22/09/2026 this catch
    // reclassified it as `unreadable` — a file of 20,001 valid rows was told
    // its format was broken, which blames the customer for a limit that is
    // ours and hides the one instruction that fixes it ("split the file").
    // Only a parser failure is an unreadable file.
    if (e instanceof AuditFileError) throw e;
    throw new AuditFileError(
      'unreadable',
      `The file could not be read as CSV or XLSX (${(e as Error).message}).`,
    );
  }
  const first = wb.SheetNames[0];
  if (!first) throw new AuditFileError('empty', 'The workbook has no sheet.');
  const sheet = wb.Sheets[first];
  boundSheetRange(sheet);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  const table = aoa.map((r) => (Array.isArray(r) ? r : []).map((v) => cellToString(v)));
  // Drop fully empty rows and trailing empty columns.
  const nonEmpty = table.filter((r) => r.some((v) => v !== ''));
  if (nonEmpty.length === 0) throw new AuditFileError('empty', 'The sheet is empty.');
  // Le texte de la table, mesuré avant l'audit et le rapport (11.11.2026).
  let text = 0;
  for (const r of nonEmpty) {
    for (const v of r) {
      if (v.length > AUDIT_MAX_CELL_CHARS) {
        throw new AuditFileError(
          'file_too_large',
          `A cell holds more than ${AUDIT_MAX_CELL_CHARS} characters, the most a spreadsheet cell holds, ` +
            'so the report could not carry it. Shorten that cell and upload the file again.',
        );
      }
      text += v.length;
    }
  }
  if (!within(text, AUDIT_MAX_TEXT_CHARS)) {
    throw new AuditFileError(
      'file_too_large',
      `The table holds more than ${AUDIT_MAX_TEXT_CHARS} characters of text; the audit reads at most that much. ` +
        'Remove the columns or notes the audit does not need and upload the file again.',
    );
  }
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const padded = nonEmpty.map((r) => [...r, ...Array.from({ length: width - r.length }, () => '')]);
  const headers = padded[0]!.map((h, i) => (h.trim() === '' ? `col_${i + 1}` : h.trim()));
  const rows = padded.slice(1);
  if (rows.length === 0)
    throw new AuditFileError('empty', 'The sheet has a header but no data rows.');
  if (rows.length > AUDIT_MAX_ROWS) {
    throw new AuditFileError(
      'too_many_rows',
      `The sheet has ${rows.length} rows; the audit takes at most ${AUDIT_MAX_ROWS}.`,
    );
  }
  return { headers, rows };
}

/**
 * Une mesure acceptée : un nombre fini, sous son plafond (11.11.2026). Chaque
 * comparaison avec un plafond passe par ici : une mesure invalide vaut refus.
 */
function within(value: number, cap: number): boolean {
  return Number.isFinite(value) && value <= cap;
}

/** Le refus d'une mesure invalide, sans autre détail. */
function invalidMeasure(): AuditFileError {
  return new AuditFileError(
    'file_too_large',
    'The sheet is larger than the audit reads. Remove the unused rows and columns and upload it again.',
  );
}

/**
 * Refuse une étendue plus large que AUDIT_MAX_COLUMNS, ou plus grande que
 * AUDIT_MAX_CELLS : `file_too_large`, avec la largeur ou l'étendue en clair.
 */
function checkExtent(rows: number, columns: number): void {
  if (!Number.isFinite(rows) || !Number.isFinite(columns)) throw invalidMeasure();
  if (!within(columns, AUDIT_MAX_COLUMNS)) {
    throw new AuditFileError(
      'file_too_large',
      `The sheet has ${columns} columns; the audit reads at most ${AUDIT_MAX_COLUMNS} columns. ` +
        'Remove the unused columns and upload it again.',
    );
  }
  if (!within(rows * columns, AUDIT_MAX_CELLS)) {
    throw new AuditFileError(
      'file_too_large',
      `The sheet spans ${rows} rows by ${columns} columns; ` +
        `the audit reads at most ${AUDIT_MAX_COLUMNS_AT_ROW_CAP} columns over ${AUDIT_MAX_ROWS} rows. ` +
        'Remove the unused columns and upload it again.',
    );
  }
}

/**
 * Borne la plage que la lecture parcourt (10.11.2026), voir AUDIT_MAX_CELLS et,
 * depuis le 11.11.2026, AUDIT_MAX_COLUMNS.
 *
 * Sous les deux plafonds, rien ne change : la plage reste celle que SheetJS a
 * lue, la balise `<dimension>` d'un classeur comprise, colonnes vides de fin
 * comprises. Au-dessus de l'un ou de l'autre, la plage est rognée à la dernière
 * ligne et à la dernière colonne qui portent vraiment une cellule : une plage
 * annoncée sans cellules derrière n'est plus parcourue. Si la plage rognée
 * dépasse encore un plafond, le fichier est trop large pour l'audit :
 * `file_too_large`. Vaut pour le classeur comme pour le XLS, dont une cellule
 * peut être placée au-delà des 256 colonnes d'Excel ; un texte est déjà mesuré
 * avant d'être lu (`readDelimitedText`).
 */
export function boundSheetRange(sheet: XLSX.WorkSheet | undefined): void {
  const ref = sheet?.['!ref'];
  if (!sheet || !ref) return;
  const declared = XLSX.utils.decode_range(ref);
  const rowsOf = (r: XLSX.Range) => r.e.r - r.s.r + 1;
  const columnsOf = (r: XLSX.Range) => r.e.c - r.s.c + 1;
  if (
    within(rowsOf(declared) * columnsOf(declared), AUDIT_MAX_CELLS) &&
    within(columnsOf(declared), AUDIT_MAX_COLUMNS)
  )
    return;
  let lastRow = -1;
  let lastCol = -1;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > lastRow) lastRow = r;
    if (c > lastCol) lastCol = c;
  }
  const trimmed = {
    s: declared.s,
    e: { r: Math.min(declared.e.r, lastRow), c: Math.min(declared.e.c, lastCol) },
  };
  if (trimmed.e.r < trimmed.s.r || trimmed.e.c < trimmed.s.c) {
    // Aucune cellule dans la plage : la lecture rendra une feuille vide.
    delete sheet['!ref'];
    return;
  }
  checkExtent(rowsOf(trimmed), columnsOf(trimmed));
  sheet['!ref'] = XLSX.utils.encode_range(trimmed);
}

/**
 * Newlines in the raw bytes, or in a decoded text — an upper bound on rows,
 * counted without parsing.
 */
export function countLines(content: Buffer | string): number {
  const at =
    typeof content === 'string' ? (i: number) => content.charCodeAt(i) : (i: number) => content[i];
  let n = 0;
  for (let i = 0; i < content.length; i++) if (at(i) === 0x0a) n++;
  // A final line without a trailing newline is still a line.
  if (content.length > 0 && at(content.length - 1) !== 0x0a) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Formats lus : archive de classeur, XLS binaire, texte délimité (10.11.2026)
// ---------------------------------------------------------------------------

/**
 * Le refus d'un contenu qui n'est aucun des formats que le site annonce : CSV,
 * TSV et autre texte délimité, XLSX, XLS.
 */
function notAcceptedFormat(what: string): AuditFileError {
  return new AuditFileError(
    'unreadable',
    `The file could not be read as CSV or XLSX (${what}). ` +
      'The audit reads CSV, TSV and other delimited text, XLSX and XLS: save the file as CSV or XLSX and upload it again.',
  );
}

/** La signature d'un fichier OLE, celle d'un XLS binaire, sur ses huit octets comme `readSync` la lit. */
export function looksLikeOle(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0xd0cf11e0 &&
    buffer.readUInt32BE(4) === 0xa1b11ae1
  );
}

/**
 * Le texte d'un fichier qui n'est ni une archive ni un XLS binaire : UTF-16
 * quand il commence par la marque d'ordre des octets petit-boutiste (l'export
 * « texte Unicode » d'Excel), UTF-8 sinon, sous un nom de fichier texte ou quand
 * son début est imprimable. `null` pour un contenu qui n'est pas du texte : il
 * n'est aucun des formats lus, et il est refusé sans être ouvert.
 */
function textOf(buffer: Buffer, filename: string): { text: string; utf16: boolean } | null {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.toString('utf16le', 2), utf16: true };
  }
  if (/\.(csv|txt|tsv)$/i.test(filename) || looksLikeText(buffer)) {
    return { text: buffer.toString('utf8'), utf16: false };
  }
  return null;
}

/**
 * Refuse un fichier de balisage : un texte qui commence par « < », après une
 * marque d'ordre des octets et des blancs (10.11.2026).
 *
 * Tableau HTML, tableur XML, OpenDocument à plat : aucun n'est un format que le
 * site annonce. Lu comme du texte délimité, un tel fichier ne donnerait aucune
 * colonne d'IBAN ; le refus dit plutôt ce que l'audit lit. La décision porte sur
 * le début du contenu, comme celle de SheetJS : un CSV dont une cellule contient
 * du balisage reste lu. Un texte dont la toute première cellule commence par
 * « < » est refusé avec le balisage ; un en-tête de colonnes ne commence pas
 * ainsi.
 */
export function refuseMarkup(text: string): void {
  let at = 0;
  while (at < text.length && '﻿\t\n\r '.includes(text.charAt(at))) at++;
  if (text.charAt(at) === '<') throw notAcceptedFormat('markup file');
}

/** Les séparateurs que SheetJS devine, et leur rang quand deux comptes sont égaux. */
const SEPARATOR_RANK = new Map([
  [',', 3],
  ['\t', 2],
  [';', 1],
  ['|', 0],
]);

/**
 * Le séparateur que SheetJS devinerait (`guess_sep`) : le plus fréquent hors
 * guillemets dans les 1024 premiers caractères, au rang le plus haut en cas
 * d'égalité, la virgule à défaut.
 */
function guessSeparator(text: string): string {
  const counts = new Map<string, number>();
  let quoted = false;
  const head = text.slice(0, 1024);
  for (let i = 0; i < head.length; i++) {
    const ch = head.charAt(i);
    if (ch === '"') quoted = !quoted;
    else if (!quoted && SEPARATOR_RANK.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ',';
  let bestCount = 0;
  for (const [ch, n] of counts) {
    if (n > bestCount || (n === bestCount && SEPARATOR_RANK.get(ch)! > SEPARATOR_RANK.get(best)!)) {
      best = ch;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Le séparateur et le texte que le lecteur de texte délimité de SheetJS lira :
 * une ligne `sep=` en tête, suivie d'une fin de ligne, donne le séparateur et
 * n'est pas lue ; sinon le séparateur est deviné et tout le texte est lu.
 */
function delimitedLayout(text: string): { separator: string; body: string } {
  if (text.startsWith('sep=')) {
    if (text.charCodeAt(5) === 0x0d && text.charCodeAt(6) === 0x0a) {
      return { separator: text.charAt(4), body: text.slice(7) };
    }
    if (text.charCodeAt(5) === 0x0d || text.charCodeAt(5) === 0x0a) {
      return { separator: text.charAt(4), body: text.slice(6) };
    }
  }
  return { separator: guessSeparator(text), body: text };
}

/**
 * L'étendue de la feuille que le lecteur de texte délimité de SheetJS
 * (`dsv_to_sheet_str`) tirera de `body`, rognée aux cellules qu'il crée comme
 * `boundSheetRange` la rogne : la dernière ligne et la colonne la plus lointaine
 * qui portent une cellule (11.11.2026).
 *
 * Un seul passage sur le texte, sans rien créer, selon les règles de ce lecteur :
 * des guillemets ne protègent que le champ qu'ils ouvrent ; CR, LF et CRLF
 * finissent une ligne ; un champ vide, ou fait d'un ou deux guillemets seuls, ne
 * crée pas de cellule ; la lecture s'arrête à SHEET_ROWS_CAP lignes.
 * `audit-file.test.ts` compare cette mesure aux cellules que SheetJS crée.
 */
export function delimitedExtent(
  body: string,
  separator: string,
): { rows: number; columns: number } {
  const sep = separator.charCodeAt(0);
  let rows = 0;
  let columns = 0;
  let row = 0;
  let column = 0;
  let start = 0;
  let first = body.charCodeAt(0);
  let quoted = false;
  // Le champ [start, end) crée-t-il une cellule ? Un CR final ne compte pas, et
  // un champ fait d'un ou deux guillemets seuls se lit vide.
  const fill = (end: number) => {
    let length = end - start;
    if (length > 0 && body.charCodeAt(start + length - 1) === 0x0d) length--;
    if (length === 0) return;
    if (length <= 2 && first === 0x22 && body.charCodeAt(start + length - 1) === 0x22) return;
    rows = Math.max(rows, row + 1);
    columns = Math.max(columns, column + 1);
  };
  for (let end = 0; end < body.length; end++) {
    const cc = body.charCodeAt(end);
    if (cc === 0x22) {
      if (first === 0x22) quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (cc === 0x0d) {
      if (body.charCodeAt(end + 1) === 0x0a) end++;
    } else if (cc !== sep && cc !== 0x0a) {
      continue;
    }
    fill(end);
    start = end + 1;
    first = body.charCodeAt(start);
    if (cc === sep) {
      column++;
    } else {
      column = 0;
      if (++row >= SHEET_ROWS_CAP) return { rows, columns };
    }
  }
  if (body.length > start) fill(body.length);
  return { rows, columns };
}

/**
 * Lit un texte comme du texte délimité, et rien d'autre (10.11.2026).
 *
 * Sur une chaîne, SheetJS choisit encore son lecteur d'après les premiers
 * caractères : des formats de tableur anciens et le balisage se reconnaissent à
 * leur début, et aucun n'est un format annoncé. Une ligne `sep=` en tête, la
 * convention d'Excel que SheetJS comprend, le fait passer par son lecteur de
 * texte délimité, qui retire cette ligne avant de lire : le séparateur annoncé
 * est celui qu'il aurait deviné, la lecture d'un texte ordinaire reste celle
 * d'avant (`audit-file.test.ts` le vérifie contre SheetJS laissé à lui-même).
 * Un texte qui porte déjà sa ligne `sep=` est lu tel quel, par le même lecteur.
 *
 * Depuis le 11.11.2026, le texte est mesuré avant d'être lu : une étendue au-delà
 * de AUDIT_MAX_COLUMNS ou de AUDIT_MAX_CELLS est refusée sans qu'aucune cellule
 * soit créée (`delimitedExtent`), avec le refus que `boundSheetRange` aurait
 * donné après la lecture.
 */
export function readDelimitedText(text: string): XLSX.WorkBook {
  const { separator, body } = delimitedLayout(text);
  const extent = delimitedExtent(body, separator);
  checkExtent(extent.rows, extent.columns);
  const source = text.startsWith('sep=') ? text : `sep=${separator}\n${text}`;
  return XLSX.read(source, {
    type: 'string',
    raw: true,
    sheetRows: SHEET_ROWS_CAP,
    cellFormula: false,
  });
}

// ---------------------------------------------------------------------------
// Garde de décompression (SEC-02, audit du 10.11.2026)
// ---------------------------------------------------------------------------

/** Le tri de SheetJS (`readSync`) : « PK », puis deux octets inférieurs à 9. */
export function looksLikeZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer.readUInt16BE(0) === 0x504b &&
    buffer.readUInt8(2) < 0x09 &&
    buffer.readUInt8(3) < 0x09
  );
}

function unzippedTooLarge(): AuditFileError {
  return new AuditFileError(
    'file_too_large',
    `The workbook expands to more than ${AUDIT_MAX_UNZIPPED_BYTES / 1024 / 1024} MB once unzipped; the audit reads at most that much.`,
  );
}

function unreadableArchive(why: string): AuditFileError {
  return new AuditFileError('unreadable', `The file could not be read as CSV or XLSX (${why}).`);
}

/** Un entier de 64 bits, petit-boutiste, comme SheetJS le lit. */
function readU64(buffer: Buffer, at: number): number {
  return buffer.readUInt32LE(at) + buffer.readUInt32LE(at + 4) * 2 ** 32;
}

/**
 * Les tailles d'un champ ZIP64 (identifiant 0x0001) d'un bloc « extra », lues
 * comme SheetJS les lit (`parse_extra_field`) : la taille décompressée puis la
 * compressée, huit octets chacune, sans regarder quel champ d'en-tête valait
 * 0xFFFFFFFF. Ce qui dépasse le bloc est ignoré, comme SheetJS l'ignore.
 */
function zip64Sizes(buffer: Buffer, start: number, end: number): { usz: number; csz: number } {
  const out = { usz: 0, csz: 0 };
  for (let at = start; at <= end - 4;) {
    const type = buffer.readUInt16LE(at);
    const body = at + 4;
    if (type === 0x0001) {
      if (body + 8 <= end) out.usz = Math.max(out.usz, readU64(buffer, body));
      if (body + 16 <= end) out.csz = Math.max(out.csz, readU64(buffer, body + 8));
    }
    at = body + buffer.readUInt16LE(at + 2);
  }
  return out;
}

/** Le chemin sous lequel SheetJS range une partie (`cfb_add`), puis la cherche (`safegetzipfile`). */
function sheetjsPath(name: string): string {
  const root = 'Root Entry/';
  const full = name.startsWith(root) ? name : (root + name).replace('//', '/');
  return full.replace(/^Root Entry[/]/, '').toLowerCase();
}

/**
 * Refuse, avant que SheetJS décompresse quoi que ce soit, une archive dont la
 * lecture coûterait plus que le budget de l'audit.
 *
 * Ce qui est refusé :
 *  - plus de AUDIT_MAX_UNZIPPED_BYTES une fois décompressée, en comptant chaque
 *    enregistrement du répertoire au plus grand de ses tailles déclarées
 *    (répertoire, en-tête local, champs ZIP64), de sa taille réelle et des
 *    octets compressés qu'il lit ; la taille réelle est mesurée par zlib, qui
 *    s'arrête au reste du budget. Les tailles déclarées ne suffisent pas : ce
 *    sont celles de l'en-tête local que SheetJS utilise, et elles peuvent être
 *    nulles dans un classeur légitime écrit en flux ;
 *  - des enregistrements qui, ensemble, liraient plus d'octets que l'archive
 *    n'en contient : dans un zip régulier, chaque partie a ses propres octets ;
 *  - plus de AUDIT_MAX_ZIP_ENTRIES parties ;
 *  - toute archive qui n'est pas un classeur Office Open XML : OpenDocument
 *    (à plat, il est refusé par `refuseMarkup`), Numbers, archive emboîtée (`Index.zip`,
 *    que SheetJS relirait sans cette garde) ; aucun n'est un CSV ou un XLSX.
 * Une taille déclarée fausse ne fait jamais refuser à elle seule une partie
 * honnête.
 *
 * Le parcours suit celui de SheetJS : dernière signature de fin de répertoire,
 * nombre d'entrées du disque courant, en-tête local à l'adresse que donne le
 * répertoire. Une partie chiffrée ou d'une méthode inconnue arrête le parcours :
 * SheetJS lève son erreur à cet endroit, avant de décompresser. SheetJS
 * décompresse ensuite avec le même zlib, sur les mêmes octets (`use_zlib`, en
 * tête de ce fichier) : ce que la garde a mesuré borne ce qu'il fait.
 */
export function checkUnzippedSize(buffer: Buffer): void {
  const len = buffer.length;
  let eocd = len - 4;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0 || eocd + 20 > len) throw unreadableArchive('no zip directory');
  const count = buffer.readUInt16LE(eocd + 8);
  if (count > AUDIT_MAX_ZIP_ENTRIES) {
    throw new AuditFileError(
      'file_too_large',
      `The workbook holds more than ${AUDIT_MAX_ZIP_ENTRIES} parts; the audit reads one sheet of creditors.`,
    );
  }
  let total = 0;
  // Octets de l'archive lus par l'ensemble des enregistrements : au plus `len`
  // pour un zip régulier, dont les parties ne se recouvrent pas.
  let read = 0;
  const overlapping = () => unreadableArchive('overlapping zip entries');
  const paths = new Set<string>();
  // Le premier refus de mesure, rendu après le parcours : son message dépend du
  // nombre de parties de feuille de l'archive.
  let failure: MeasureFailure | null = null;
  let sheetParts = 0;
  let at = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    // Répertoire central.
    if (at + 46 > len) throw unreadableArchive('truncated zip directory');
    const cdUsz = buffer.readUInt32LE(at + 24);
    const cdName = buffer.toString(
      'latin1',
      at + 46,
      Math.min(len, at + 46 + buffer.readUInt16LE(at + 28)),
    );
    const extraStart = at + 46 + buffer.readUInt16LE(at + 28);
    const extraEnd = extraStart + buffer.readUInt16LE(at + 30);
    const local = buffer.readUInt32LE(at + 42);
    if (extraEnd > len) throw unreadableArchive('truncated zip directory');
    const cd64 = zip64Sizes(buffer, extraStart, extraEnd);
    at = extraEnd + buffer.readUInt16LE(at + 32);
    // En-tête local.
    if (local + 30 > len) throw unreadableArchive('truncated zip entry');
    const flags = buffer.readUInt16LE(local + 6);
    const method = buffer.readUInt16LE(local + 8);
    const localCsz = buffer.readUInt32LE(local + 18);
    const localUsz = buffer.readUInt32LE(local + 22);
    const nameEnd = local + 30 + buffer.readUInt16LE(local + 26);
    const data = nameEnd + buffer.readUInt16LE(local + 28);
    if (data > len) throw unreadableArchive('truncated zip entry');
    if (flags & 0x2041 || (method !== 0 && method !== 8)) {
      if (failure) throw measureFailureError(failure, sheetParts);
      return;
    }
    const local64 = zip64Sizes(buffer, nameEnd, data);
    const entryName = buffer.toString('latin1', local + 30, nameEnd);
    const path = sheetjsPath(entryName);
    paths.add(path);

    const remaining = AUDIT_MAX_UNZIPPED_BYTES - total;
    let charge = Math.max(cdUsz, cd64.usz, localUsz, local64.usz);
    if (charge > remaining) throw unzippedTooLarge();
    let readHere: number;
    // Les octets que SheetJS lira pour cette partie, mesurés plus bas.
    let content: Buffer;
    if (method === 8) {
      // zlib ne reçoit que ce qu'il reste à lire de l'archive : un flux qui
      // en demanderait davantage recouvre forcément une autre partie.
      let produced: number;
      try {
        const out = zlib.inflateRawSync(buffer.subarray(data, data + (len - read)), {
          info: true,
          maxOutputLength: Math.max(1, remaining),
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        produced = out.buffer.length;
        readHere = out.engine.bytesWritten;
        content = out.buffer;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw unzippedTooLarge();
        // Coupé par la limite ci-dessus, et non par la fin réelle de l'archive.
        if (read > data && (e as NodeJS.ErrnoException).code === 'Z_BUF_ERROR') throw overlapping();
        throw unreadableArchive((e as Error).message);
      }
      charge = Math.max(charge, produced, readHere);
    } else {
      // Stockée sans compression : SheetJS en garde une vue, sans copie, de la
      // taille compressée qu'il retient, ZIP64 du répertoire compris.
      readHere = Math.min(Math.max(localCsz, local64.csz, cd64.csz), len - data);
      charge = Math.max(charge, readHere);
      content = buffer.subarray(data, data + readHere);
    }
    read += readHere;
    if (read > len) throw overlapping();
    total += charge;
    if (total > AUDIT_MAX_UNZIPPED_BYTES) throw unzippedTooLarge();
    // Ce que la partie ferait créer, compté dans les octets que zlib vient de
    // rendre, sans copie (11.11.2026).
    const verdict = measurePart(content, [entryName, cdName]);
    if (verdict.sheet) sheetParts++;
    if (verdict.error) failure ??= { name: entryName, sheet: verdict.sheet, error: verdict.error };
  }

  const has = (file: string) => {
    const f = file.toLowerCase().replace(/[/]/g, '\\');
    return paths.has(f) || paths.has(f.replace(/\\/g, '/'));
  };
  // L'ordre des essais de SheetJS (`parse_zip` du classeur) : OpenDocument,
  // puis Numbers, puis Office Open XML ; le reste part vers `Index.zip`.
  if (has('META-INF/manifest.xml') || has('objectdata.xml')) {
    throw unreadableArchive('OpenDocument file');
  }
  if (has('Index/Document.iwa')) throw unreadableArchive('Numbers file');
  if (!has('[Content_Types].xml')) throw unreadableArchive('Unsupported ZIP file');
  if (failure) throw measureFailureError(failure, sheetParts);
}

/** Le premier refus de mesure d'une archive, et la partie qui l'a causé. */
interface MeasureFailure {
  name: string;
  sheet: boolean;
  error: AuditFileError;
}

/**
 * Le refus d'une mesure, avec un message exact : celui de la feuille elle-même
 * quand elle est la seule partie de feuille de l'archive ; sinon un message qui
 * nomme la partie en cause, puisque chaque feuille est mesurée et que seule la
 * première est lue. Le code reste celui du refus d'origine (11.11.2026) : le
 * site lit `too_many_rows` comme « découper le fichier », `file_too_large`
 * comme « retirer ce qui déborde ».
 */
function measureFailureError(f: MeasureFailure, sheetParts: number): AuditFileError {
  if (f.sheet && sheetParts === 1) return f.error;
  // Le nom vient de l'archive : court, et fait seulement de caractères simples.
  const name = f.name.slice(0, 120).replace(/[^A-Za-z0-9/._-]/g, '?');
  return new AuditFileError(
    f.error.code,
    `The workbook part ${name} goes beyond what the audit reads: ${f.error.message} ` +
      'Every sheet of a workbook is measured and only the first is read: if this part is not ' +
      'your creditor list, remove it and upload the file again.',
  );
}

// ---------------------------------------------------------------------------
// Mesure d'une feuille avant lecture (11.11.2026)
// ---------------------------------------------------------------------------

/**
 * Ce qu'une partie de classeur fera créer ou parcourir à SheetJS : `rows`, les
 * lignes qui portent au moins une cellule ; `columns`, les cellules de la ligne
 * qui en porte le plus ; `cells`, toutes les cellules ; `linkCells`, les cases
 * que couvrent les plages de liens, comptées comme des cellules.
 *
 * Depuis le 11.11.2026, `rows`, `columns` et `cells` ne comptent que les
 * cellules que SheetJS peut garder. Une cellule vide mise en forme (balise qui
 * se ferme seule, sans type, suivie d'une autre cellule ou d'une fin de ligne)
 * ne crée rien, mais la lecture la parcourt : elle n'entre que dans
 * `allColumns` et `allCells`, qui ont leurs propres bornes, larges, pour qu'une
 * feuille mise en forme loin sous ses données reste lue comme avant.
 */
export interface SheetMeasure {
  rows: number;
  columns: number;
  cells: number;
  allColumns: number;
  allCells: number;
  linkCells: number;
}

const emptyMeasure = (): SheetMeasure => ({
  rows: 0,
  columns: 0,
  cells: 0,
  allColumns: 0,
  allCells: 0,
  linkCells: 0,
});

/** La largeur d'une feuille Excel : aucune ligne d'un vrai classeur ne la dépasse, cellules vides comprises. */
const EXCEL_MAX_COLUMNS = 16_384;
/** Les cellules vides mises en forme qu'une feuille peut porter, toutes lignes comprises. */
const AUDIT_MAX_FORMATTED_CELLS = 4 * AUDIT_MAX_CELLS;

const isWordByte = (c: number | undefined) =>
  c !== undefined &&
  ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f);
const isSpaceByte = (c: number | undefined) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Le nom local d'une balise qui commence en `at`, préfixe `\w+:` sauté comme SheetJS le saute. */
function localName(b: Buffer, at: number): [number, number] {
  let end = at;
  while (isWordByte(b[end])) end++;
  if (end === at || b[end] !== 0x3a) return [at, end];
  let local = end + 1;
  while (isWordByte(b[local])) local++;
  return [end + 1, local];
}

function nameIs(b: Buffer, [start, end]: [number, number], name: string): boolean {
  if (end - start !== name.length) return false;
  for (let k = 0; k < name.length; k++) if (b[start + k] !== name.charCodeAt(k)) return false;
  return true;
}

/**
 * Les cases d'une plage écrite à partir de `from`, lue comme SheetJS la lit
 * (`safe_decode_range`) : lettres majuscules puis chiffres, deux-points, de même
 * pour la fin. Une seule référence vaut une case, une plage inversée aucune.
 */
function rangeCells(b: Buffer, from: number, end: number): number {
  let i = from;
  let cc = 0;
  const part = (base: number, low: number, high: number, radix: number) => {
    let idx = 0;
    for (; i < end; i++) {
      cc = b[i]! - base;
      if (cc < low || cc > high) break;
      idx = radix * idx + cc;
    }
    return idx - 1;
  };
  const sc = part(64, 1, 26, 26);
  const sr = part(48, 0, 9, 10);
  if (i === end || cc !== 10) return 1;
  i++;
  const ec = part(64, 1, 26, 26);
  const er = part(48, 0, 9, 10);
  return Math.max(0, er - sr + 1) * Math.max(0, ec - sc + 1);
}

/**
 * Les cases que couvre une balise de lien, de `from` à la fin de la balise : la
 * plus grande des plages que donnerait l'une de ses valeurs d'attribut, ce qui
 * comprend celle que SheetJS lit. Une balise qui rencontre « < » avant « > »
 * n'est pas lue par SheetJS ; le parcours s'arrête donc au premier des deux.
 */
function linkCellsOf(b: Buffer, from: number): number {
  let largest = 0;
  for (let k = from; k < b.length && b[k] !== 0x3e && b[k] !== 0x3c; k++) {
    if (b[k] !== 0x3d) continue;
    let v = k + 1;
    while (isSpaceByte(b[v])) v++;
    if (b[v] === 0x22 || b[v] === 0x27) v++;
    largest = Math.max(largest, rangeCells(b, v, b.length));
  }
  return largest;
}

/**
 * Le début de la zone des données : juste après la première balise ouvrante
 * `sheetData`, préfixe compris, comme SheetJS la trouve (`str_match_xml_ns`) ;
 * -1 sans elle. Un passage, sans retour arrière au-delà d'un préfixe.
 */
function dataStart(b: Buffer): number {
  for (let i = b.indexOf('sheetData'); i !== -1; i = b.indexOf('sheetData', i + 1)) {
    let open = i - 1;
    if (b[open] === 0x3a) {
      let w = open - 1;
      while (isWordByte(b[w])) w--;
      if (w === open - 1) continue;
      open = w;
    }
    if (b[open] !== 0x3c || isWordByte(b[i + 9])) continue;
    for (let k = i + 9; k < b.length && b[k] !== 0x3c; k++) if (b[k] === 0x3e) return k + 1;
  }
  return -1;
}

/** Une balise ouvrante de cellule en `at` (sur « < »), comme SheetJS la découpe : la fin de son nom, ou -1. */
function cellStart(b: Buffer, at: number): number {
  if (b[at] !== 0x3c) return -1;
  const name = localName(b, at + 1);
  const next = b[name[1]];
  return nameIs(b, name, 'c') && (next === 0x2f || next === 0x3e || isSpaceByte(next))
    ? name[1]
    : -1;
}

/** Une fin de ligne en `at` (sur « < »), écrite exactement comme SheetJS la reconnaît. */
function rowEnd(b: Buffer, at: number): boolean {
  if (b[at] !== 0x3c || b[at + 1] !== 0x2f) return false;
  const name = localName(b, at + 2);
  return nameIs(b, name, 'row') && b[name[1]] === 0x3e;
}

/** Les blancs d'une expression régulière JavaScript (`\s`) sur un texte lu octet pour octet. */
const isRegexSpaceByte = (c: number | undefined) =>
  c === 0x20 || (c !== undefined && c >= 0x09 && c <= 0x0d) || c === 0xa0;

/**
 * La balise [from, end) porte-t-elle un type ? Comme SheetJS lit ses attributs
 * (`parsexmltag`) : un nom précédé d'un blanc et suivi de « = », pris après son
 * premier « : », ou avant son premier « _ » quand il n'en a pas, en minuscules.
 * Chaque « nom = » de la balise est examiné, entre guillemets compris : ce qui
 * ne peut que trouver un type de plus.
 */
function hasTypeAttribute(b: Buffer, from: number, end: number): boolean {
  const isT = (c: number | undefined) => c === 0x74 || c === 0x54;
  for (let p = from; p < end; p++) {
    // L'octet qui suit le nom de cellule compte comme un blanc, quel qu'il soit :
    // la lecture suit le découpage de la bibliothèque.
    if (p !== from && !isRegexSpaceByte(b[p])) continue;
    const start = p + 1;
    let colon = -1;
    let underscore = -1;
    // Le nom [start, stop) : après son premier « : », ou avant son premier « _ ».
    const isTypeName = (stop: number) =>
      colon !== -1
        ? stop === colon + 2 && isT(b[colon + 1])
        : (underscore === -1 ? stop : underscore) === start + 1 && isT(b[start]);
    let q = start;
    // Un nom peut contenir « = » : chaque « = » du nom peut le terminer.
    for (
      ;
      q < end &&
      b[q] !== 0x22 &&
      b[q] !== 0x3f &&
      b[q] !== 0x3e &&
      b[q] !== 0x2f &&
      !isRegexSpaceByte(b[q]);
      q++
    ) {
      if (b[q] === 0x3d && q > start && isTypeName(q)) return true;
      if (b[q] === 0x3a && colon === -1) colon = q;
      if (b[q] === 0x5f && underscore === -1 && q > start) underscore = q;
    }
    if (q === start) continue;
    let eq = q;
    while (eq < end && isRegexSpaceByte(b[eq])) eq++;
    if (b[eq] === 0x3d && isTypeName(q)) return true;
  }
  return false;
}

/**
 * Une cellule vide mise en forme, dont la balise commence en `from` (fin de son
 * nom) : elle se ferme seule, ne porte aucun type (`hasTypeAttribute`), et n'est
 * suivie que d'une autre cellule ou d'une fin de ligne. Toute autre cellule est
 * tenue pour une cellule que SheetJS peut garder.
 */
function formattedEmptyCell(b: Buffer, from: number): boolean {
  let k = from;
  while (k < b.length && b[k] !== 0x3e && b[k] !== 0x3c) k++;
  if (b[k] !== 0x3e || b[k - 1] !== 0x2f || hasTypeAttribute(b, from, k)) return false;
  const next = b.indexOf(0x3c, k + 1);
  return next !== -1 && (cellStart(b, next) !== -1 || rowEnd(b, next));
}

/**
 * Mesure une partie XML de classeur en un passage sur ses octets, sans la
 * convertir en texte, en suivant le découpage de SheetJS (`parse_ws_xml_data`) :
 * les cellules ne sont cherchées qu'à partir de la zone des données
 * (`sheetData`) ; une ligne finit à une balise fermante de ligne écrite
 * exactement comme SheetJS la reconnaît, jamais à une autre ; toute balise
 * ouvrante de cellule compte. Les plages de liens sont mesurées dans toute la
 * partie. Ce qui ne peut que compter plus que SheetJS ne crée est assumé : la
 * mesure borne, elle ne lit pas.
 */
export function measureSheetPart(b: Buffer): SheetMeasure {
  const data = dataStart(b);
  const m = emptyMeasure();
  let inRow = 0;
  let allInRow = 0;
  const endRow = () => {
    if (inRow > 0) {
      m.rows++;
      m.columns = Math.max(m.columns, inRow);
    }
    m.allColumns = Math.max(m.allColumns, allInRow);
    inRow = 0;
    allInRow = 0;
  };
  // Le texte qui suit la balise d'une ligne, avant toute cellule, compte comme
  // une cellule : la lecture suit le découpage de la bibliothèque.
  const leadingText = (from: number) => {
    let end = b.indexOf(0x3e, from);
    while (end !== -1 && b[end - 1] === 0x2f) end = b.indexOf(0x3e, end + 1);
    if (end === -1) return;
    let p = end + 1;
    while (p < b.length && isRegexSpaceByte(b[p])) p++;
    if (p < b.length && b[p] !== 0x3c) {
      inRow++;
      allInRow++;
      m.cells++;
      m.allCells++;
    }
  };
  if (data !== -1) leadingText(data);
  for (let i = b.indexOf(0x3c); i !== -1; i = b.indexOf(0x3c, i + 1)) {
    const inData = data !== -1 && i >= data;
    if (b[i + 1] === 0x2f) {
      if (inData && rowEnd(b, i)) {
        endRow();
        leadingText(b.indexOf(0x3e, i) + 1);
      }
      continue;
    }
    const cell = inData ? cellStart(b, i) : -1;
    if (cell !== -1) {
      allInRow++;
      m.allCells++;
      if (!formattedEmptyCell(b, cell)) {
        inRow++;
        m.cells++;
      }
      continue;
    }
    const name = localName(b, i + 1);
    if (nameIs(b, name, 'hyperlink') && isSpaceByte(b[name[1]])) {
      m.linkCells += linkCellsOf(b, name[1]);
    }
  }
  endRow();
  return m;
}

/** Les enregistrements de feuille XLSB que SheetJS range comme cellules (`parse_ws_bin`). */
const BINARY_CELL_RECORDS = new Set([
  0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12,
  0x3e,
]);

/**
 * Mesure une partie binaire (XLSB) en suivant les enregistrements comme SheetJS
 * les suit (`recordhopper`) : une ligne commence à chaque en-tête de ligne, une
 * cellule est un enregistrement de cellule, et la plage d'un lien se lit en
 * quatre entiers de 32 bits. Appliquée à toute partie `.bin`, pour la borner ;
 * qu'elle soit une feuille se décide à part (`isBinarySheet`).
 */
function measureBinarySheetPart(b: Buffer): SheetMeasure {
  const m = emptyMeasure();
  let inRow = 0;
  let allInRow = 0;
  const endRow = () => {
    if (inRow > 0) {
      m.rows++;
      m.columns = Math.max(m.columns, inRow);
    }
    m.allColumns = Math.max(m.allColumns, allInRow);
    inRow = 0;
    allInRow = 0;
  };
  for (let at = 0; at < b.length;) {
    let type = b[at++] ?? 0;
    if (type & 0x80) type = (type & 0x7f) + (((b[at++] ?? 0) & 0x7f) << 7);
    let byte = b[at++] ?? 0;
    let length = byte & 0x7f;
    for (let n = 1; n < 4 && byte & 0x80; n++) length += ((byte = b[at++] ?? 0) & 0x7f) << (7 * n);
    if (type === 0x00) endRow();
    else if (BINARY_CELL_RECORDS.has(type)) {
      inRow++;
      allInRow++;
      m.cells++;
      m.allCells++;
    } else if (type === 0x01 || type === 0x0c) {
      // Cellule vide : SheetJS ne la garde pas, mais la parcourt.
      allInRow++;
      m.allCells++;
    } else if (type === 0x01ee && at + 16 <= b.length) {
      const rows = b.readUInt32LE(at + 4) - b.readUInt32LE(at) + 1;
      const cols = b.readUInt32LE(at + 12) - b.readUInt32LE(at + 8) + 1;
      m.linkCells += Math.max(0, rows) * Math.max(0, cols);
    }
    at += length;
  }
  endRow();
  return m;
}

/** L'enregistrement qui ouvre une feuille XLSB (`BrtBeginSheet`). */
const BINARY_BEGIN_SHEET = 0x81;

/**
 * Une partie `.bin` est-elle une feuille (11.11.2026) ? Oui sous `worksheets/`,
 * ou quand son premier enregistrement ouvre une feuille. Les annexes binaires
 * d'un vrai classeur (réglages d'impression, objets) ne le sont pas, même quand
 * des octets s'y lisent comme des lignes ou des cellules : comptées comme
 * feuilles, elles faisaient perdre au refus d'un classeur d'une seule feuille
 * son message et son code d'origine (`measureFailureError`).
 */
function isBinarySheet(b: Buffer, names: string[]): boolean {
  if (names.some((n) => /(^|\/)worksheets\//i.test(n))) return true;
  if (b.length === 0) return false;
  let type = b[0]!;
  if (type & 0x80) type = (type & 0x7f) + (((b[1] ?? 0) & 0x7f) << 7);
  return type === BINARY_BEGIN_SHEET;
}

/**
 * Refuse une mesure au-delà des plafonds, avec les refus que `boundSheetRange`
 * donnerait après la lecture : trop de colonnes, une étendue trop grande, ou
 * trop de lignes quand une feuille trop grande en compte plus que l'audit n'en
 * prend. Chaque comparaison accepte seulement une mesure finie sous son
 * plafond (`within`) : une mesure invalide vaut refus.
 */
function refuseMeasure(m: SheetMeasure): void {
  const measures = [m.rows, m.columns, m.cells, m.allColumns, m.allCells, m.linkCells];
  if (!measures.every(Number.isFinite)) throw invalidMeasure();
  if (!within(m.columns, AUDIT_MAX_COLUMNS)) {
    checkExtent(m.rows, m.columns);
    throw invalidMeasure();
  }
  if (!within(m.allColumns, EXCEL_MAX_COLUMNS)) {
    checkExtent(m.rows, m.allColumns);
    throw invalidMeasure();
  }
  if (!within(m.cells, AUDIT_MAX_CELLS)) {
    if (!within(m.rows, AUDIT_MAX_ROWS + 1)) {
      throw new AuditFileError(
        'too_many_rows',
        `The sheet has more than ${AUDIT_MAX_ROWS} rows; the audit takes at most ${AUDIT_MAX_ROWS}.`,
      );
    }
    checkExtent(m.rows, m.columns);
    throw invalidMeasure();
  }
  if (!within(m.allCells, AUDIT_MAX_FORMATTED_CELLS)) {
    throw new AuditFileError(
      'file_too_large',
      `The sheet holds more than ${AUDIT_MAX_FORMATTED_CELLS} formatted empty cells; ` +
        'clear the formatting outside the data and upload it again.',
    );
  }
  if (!within(m.linkCells, AUDIT_MAX_CELLS)) {
    throw new AuditFileError(
      'file_too_large',
      `The sheet holds more than ${AUDIT_MAX_CELLS} cells; the audit reads at most ` +
        `${AUDIT_MAX_COLUMNS_AT_ROW_CAP} columns over ${AUDIT_MAX_ROWS} rows. Remove the unused cells and upload it again.`,
    );
  }
}

/**
 * Mesure une partie décompressée par la garde, avant que SheetJS la lise :
 * toute partie comme XML, une partie `.bin` aussi comme XLSB. Une partie qui
 * s'annonce en UTF-16 est refusée : SheetJS la décoderait avant de la lire, et
 * Excel écrit les siennes en UTF-8. Rend si la partie porte une feuille, et le
 * refus de sa mesure s'il y en a un.
 */
function measurePart(
  content: Buffer,
  names: string[],
): { sheet: boolean; error: AuditFileError | null } {
  const [b0, b1, b2] = [content[0], content[1], content[2]];
  if (
    (b0 === 0xff && b1 === 0xfe) ||
    (b0 === 0xfe && b1 === 0xff) ||
    (b1 === 0xfe && b2 === 0xff)
  ) {
    throw unreadableArchive('UTF-16 part');
  }
  const xml = measureSheetPart(content);
  const binary = names.some((n) => n.toLowerCase().endsWith('.bin'))
    ? measureBinarySheetPart(content)
    : null;
  const sheet =
    dataStart(content) !== -1 ||
    (binary !== null && binary.rows + binary.allCells > 0 && isBinarySheet(content, names));
  try {
    refuseMeasure(xml);
    if (binary) refuseMeasure(binary);
    return { sheet, error: null };
  } catch (e) {
    if (e instanceof AuditFileError) return { sheet, error: e };
    throw e;
  }
}

/**
 * Les cases que couvrent les plages de liens d'un XLS (11.11.2026), comptées
 * comme des cellules : le flux du classeur est cherché comme SheetJS le cherche
 * (`parse_xlscfb`), puis suivi enregistrement par enregistrement. Le reste d'un
 * XLS n'est pas compressé : ce qu'il fait créer suit sa taille.
 */
export function xlsLinkCells(buffer: Buffer): number {
  const cfb = CFB.read(buffer, { type: 'buffer' });
  const content = (CFB.find(cfb, '/Workbook') ?? CFB.find(cfb, '/Book'))?.content;
  if (!content) return 0;
  const b = Buffer.isBuffer(content) ? content : Buffer.from(content);
  let cells = 0;
  for (let at = 0; at + 4 <= b.length;) {
    const type = b.readUInt16LE(at);
    const body = at + 4;
    // Classeur chiffré : la suite ne se lit pas en clair, et SheetJS refuse
    // lui-même à cet endroit un fichier protégé par mot de passe.
    if (type === 0x002f) break;
    // Lien : la plage ouvre l'enregistrement ; infobulle : elle suit deux octets.
    const ref = type === 0x01b8 ? body : type === 0x0800 ? body + 2 : -1;
    if (ref !== -1 && ref + 8 <= b.length) {
      const rows = b.readUInt16LE(ref + 2) - b.readUInt16LE(ref) + 1;
      const cols = b.readUInt16LE(ref + 6) - b.readUInt16LE(ref + 4) + 1;
      cells += Math.max(0, rows) * Math.max(0, cols);
    }
    at = body + b.readUInt16LE(at + 2);
  }
  return cells;
}

function looksLikeText(buffer: Buffer): boolean {
  // XLSX is a zip (PK header); XLS starts with the OLE signature. Anything
  // else that is mostly printable is treated as delimited text.
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return false;
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf) return false;
  const sample = buffer.subarray(0, 512);
  let printable = 0;
  for (const b of sample)
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  return sample.length > 0 && printable / sample.length > 0.9;
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// ---------------------------------------------------------------------------
// Finding the columns
// ---------------------------------------------------------------------------

const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADER_HINTS: Record<Exclude<keyof AuditColumnMap, 'iban'>, RegExp[]> = {
  name: [
    /^(name|nom|beneficiaire|beneficiary|creancier|creditor|supplier|fournisseur|lieferant|empfaenger|empfanger|payee|raison sociale|firma|company|societe)\b/,
  ],
  bic: [/^(bic|swift|bic swift|swift bic|bic code)\b/],
  street: [/^(street|rue|strasse|str|address line 1|adresse|address|anschrift|strt nm)\b/],
  building: [/^(building|bldg|number|numero|hausnummer|no|nr|bldg nb)\b/],
  postal: [/^(zip|postal code|postcode|post code|plz|npa|cp|code postal|pst cd|postleitzahl)\b/],
  city: [/^(city|ville|ort|town|lieu|localite|stadt|twn nm)\b/],
  country: [/^(country|pays|land|ctry|country code|iso country)\b/],
};

/** Decide which column holds what. The IBAN column is found by content when no header says it. */
export function detectColumns(headers: string[], rows: string[][]): AuditColumnMap {
  const normalized = headers.map(norm);
  let iban = normalized.findIndex((h) => /^iban\b/.test(h) || /\biban\b/.test(h));
  if (iban === -1) {
    // Content scan: the column whose first 50 non-empty cells look most like IBANs.
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < headers.length; c++) {
      let hits = 0;
      let seen = 0;
      for (const r of rows) {
        const v = (r[c] ?? '').replace(/\s+/g, '').toUpperCase();
        if (v === '') continue;
        seen++;
        if (IBAN_SHAPE.test(v)) hits++;
        if (seen >= 50) break;
      }
      if (seen > 0 && hits / seen > 0.5 && hits > bestScore) {
        best = c;
        bestScore = hits;
      }
    }
    iban = best;
  }
  if (iban === -1) {
    throw new AuditFileError(
      'no_iban_column',
      'No column holds IBANs: name one "IBAN" or make sure the account column contains IBANs.',
    );
  }
  const map: AuditColumnMap = { iban };
  for (const key of Object.keys(HEADER_HINTS) as Array<keyof typeof HEADER_HINTS>) {
    const idx = normalized.findIndex(
      (h, i) => i !== iban && HEADER_HINTS[key].some((re) => re.test(h)),
    );
    if (idx !== -1) map[key] = idx;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Auditing the rows
// ---------------------------------------------------------------------------

function schemeFor(country: string | null): AddressScheme | null {
  if (!country) return null;
  if (country === 'CH' || country === 'LI') return 'sps';
  if (country === 'US') return null; // no IBAN there; never reached
  return 'hvps_plus';
}

function countryOfInput(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(v)) return v;
  const names: Record<string, string> = {
    SUISSE: 'CH',
    SCHWEIZ: 'CH',
    SWITZERLAND: 'CH',
    SVIZZERA: 'CH',
    FRANCE: 'FR',
    FRANKREICH: 'FR',
    ALLEMAGNE: 'DE',
    DEUTSCHLAND: 'DE',
    GERMANY: 'DE',
    ITALIE: 'IT',
    ITALIEN: 'IT',
    ITALY: 'IT',
    ITALIA: 'IT',
    AUTRICHE: 'AT',
    OSTERREICH: 'AT',
    AUSTRIA: 'AT',
    LIECHTENSTEIN: 'LI',
    BELGIQUE: 'BE',
    BELGIEN: 'BE',
    BELGIUM: 'BE',
    'PAYS-BAS': 'NL',
    NIEDERLANDE: 'NL',
    NETHERLANDS: 'NL',
    ESPAGNE: 'ES',
    SPANIEN: 'ES',
    SPAIN: 'ES',
    PORTUGAL: 'PT',
    LUXEMBOURG: 'LU',
    LUXEMBURG: 'LU',
    'ROYAUME-UNI': 'GB',
    'UNITED KINGDOM': 'GB',
    GROSSBRITANNIEN: 'GB',
    UK: 'GB',
  };
  return names[v.normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? null;
}

export function auditTable(
  headers: string[],
  rows: string[][],
  columns?: AuditColumnMap,
): AuditResult {
  const cols = columns ?? detectColumns(headers, rows);
  const cache = createEnrichCache();
  const seen = new Map<string, number>();
  const out: AuditRow[] = [];
  const hasAddress =
    cols.postal !== undefined || cols.city !== undefined || cols.street !== undefined;

  rows.forEach((r, i) => {
    const line = i + 1;
    const rawIban = (r[cols.iban] ?? '').trim();
    const findings: AuditFinding[] = [];
    const row: AuditRow = {
      line,
      iban_input: rawIban,
      iban: null,
      status: 'ok',
      findings,
      country: null,
      bank_name: null,
      bic_registry: null,
      bic_file: cols.bic !== undefined ? (r[cols.bic] ?? '').trim().toUpperCase() || null : null,
      sepa_reachable: null,
      address_verdict: null,
      register_basis: 'none',
      register: null,
      next_steps: [],
    };
    if (rawIban === '') {
      findings.push({ code: 'iban_missing', detail: 'The IBAN cell is empty.' });
    } else {
      const result: IBANValidationResult = validateIBAN(rawIban);
      if (!result.valid) {
        findings.push({
          code: 'iban_invalid',
          detail: result.error_detail ?? result.error ?? 'The IBAN does not validate.',
        });
      } else {
        enrichResult(result, cache);
        const compact = rawIban.replace(/\s+/g, '').toUpperCase();
        row.iban = compact;
        row.country = result.country?.code ?? compact.slice(0, 2);
        // Read from the country, not from this answer: the question the column
        // answers is "could a register have contradicted this line at all",
        // which is true of the country whether or not this particular code was
        // found. `bank_code_check` beside it says what happened to THIS code.
        const coverage = registerCoverage(row.country);
        row.register_basis = coverage.basis;
        row.register = coverage.register;
        // Saint-Marin (21/10/2026) : quand la banque de la ligne vient de la
        // liste de la BCSM, l'attribution qu'elle a acceptée par écrit va AVEC le
        // jour de lecture. La réponse porte ce crédit daté ; le nom du pays, lui,
        // ne lit aucune ligne et n'a pas de date. Un code absent de la liste
        // n'utilise rien de la BCSM et garde le nom du pays.
        const check = result.bank_code_check;
        // Israël et Mongolie (28/10/2026) : même règle, le crédit daté de la ligne.
        if (
          (row.country === 'SM' || row.country === 'IL' || row.country === 'MN') &&
          check?.status === 'verified' &&
          check.match === 'register'
        ) {
          row.register = check.register ?? row.register;
        }
        row.bank_name = result.bic?.bank_name ?? result.issuer?.name ?? null;
        row.bic_registry = result.bic?.code ?? null;
        row.sepa_reachable = result.risk_indicators?.sepa_reachable ?? result.sepa?.member ?? null;
        row.next_steps = (result.next_steps ?? []).map((s) => s.code);

        const dup = seen.get(compact);
        if (dup !== undefined) {
          findings.push({ code: 'duplicate', detail: `Same IBAN as line ${dup}.` });
        } else {
          seen.set(compact, line);
        }
        if (
          result.bank_code_check?.status === 'not_in_register' &&
          result.bank_code_check.authoritative
        ) {
          findings.push({
            code: 'bank_code_not_allocated',
            detail: `Bank code ${result.bank_code_check.value} is absent from the national register.`,
          });
        }
        // 29/09/2026: a bank code nothing could be read against (no bank-code
        // data we may use for the country, or a register not loaded) says
        // nothing about the bank. A line without any other finding used to come
        // out `ok`, which a reader takes for a checked bank.
        if (result.bank_code_check?.status === 'unavailable') {
          findings.push({
            code: 'bank_not_consulted',
            detail:
              result.bank_code_check.reason === 'no_reference_data_for_country'
                ? `No bank-code data we may use for ${row.country}: the bank behind code ${result.bank_code_check.value} was not identified.`
                : `The reference data for bank code ${result.bank_code_check.value} could not be consulted.`,
          });
        }
        if (result.modulus_check && result.modulus_check.passed === false) {
          findings.push({
            code: 'modulus_check_failed',
            detail: 'The account number fails the UK modulus check.',
          });
        }
        // La clé nationale du BBAN (FR, MC, BE, IT, SM, ES, DE) : le détail du
        // module dit quels chiffres ne concordent pas, sans jamais donner la
        // bonne clé. Allemagne, méthode publiée sans numéro de test
        // (`verified_by: independent_implementation`, 06.10.2026) : un
        // avertissement, jamais une erreur, comme l'étape de next_steps.
        if (
          result.national_check_digits?.status === 'fail' &&
          result.national_check_digits.verified_by === 'independent_implementation'
        ) {
          findings.push({
            code: 'national_check_digits_suspect',
            detail: result.national_check_digits.detail ?? 'The German account check digit fails.',
          });
        } else if (result.national_check_digits?.status === 'fail') {
          findings.push({
            code: 'national_check_digits_failed',
            detail:
              result.national_check_digits.detail ??
              'The national check key inside the BBAN does not match: this account number cannot have been issued as written.',
          });
        }
        if (row.sepa_reachable === false) {
          findings.push({
            code: 'sepa_not_reachable',
            detail: 'No SEPA credit transfer to this account: outside the SEPA zone.',
          });
        }
        if (result.risk_indicators?.test_bic) {
          findings.push({
            code: 'test_bic',
            detail: 'The BIC on record is a test BIC (position 8 is 0).',
          });
        }
        if (result.risk_indicators && result.risk_indicators.country_risk !== 'standard') {
          findings.push({
            code: 'country_risk',
            detail: `Country risk ${result.risk_indicators.country_risk}.`,
          });
        }
        if (
          result.issuer?.type &&
          result.issuer.type !== 'bank' &&
          result.issuer.type !== 'digital_bank'
        ) {
          findings.push({
            code: 'issuer_not_bank',
            detail: `Held at a ${result.issuer.type.replace('_', ' ')}: ${result.issuer.name}.`,
          });
        }
        if (row.bic_file && row.bic_registry) {
          const a = row.bic_file.replace(/\s+/g, '').slice(0, 8);
          const b = row.bic_registry.slice(0, 8);
          if (a !== b) {
            findings.push({
              code: 'bic_mismatch',
              detail: `File says ${row.bic_file}, the register derives ${row.bic_registry}.`,
            });
          }
        }
        if (cols.country !== undefined) {
          const c = countryOfInput(r[cols.country] ?? '');
          if (c && row.country && c !== row.country) {
            findings.push({
              code: 'country_mismatch',
              detail: `Address country ${c}, IBAN country ${row.country}.`,
            });
          }
        }
        if (hasAddress) {
          const scheme = schemeFor(row.country);
          if (scheme) {
            const check = checkPostalAddress(scheme, {
              strt_nm: cols.street !== undefined ? r[cols.street] || undefined : undefined,
              bldg_nb: cols.building !== undefined ? r[cols.building] || undefined : undefined,
              pst_cd: cols.postal !== undefined ? r[cols.postal] || undefined : undefined,
              twn_nm: cols.city !== undefined ? r[cols.city] || undefined : undefined,
              ctry:
                cols.country !== undefined
                  ? (countryOfInput(r[cols.country] ?? '') ?? undefined)
                  : (row.country ?? undefined),
            });
            row.address_verdict = check.conforms ? 'pass' : 'fail';
            // NPA et localité (29.10.2026). Seulement quand la colonne pays du
            // fichier dit CH ou LI : sans elle, le pays est celui de l'IBAN, et
            // un créancier autrichien (NPA à quatre chiffres aussi) titulaire
            // d'un compte suisse serait comparé au répertoire suisse à tort.
            const stated =
              cols.country !== undefined ? countryOfInput(r[cols.country] ?? '') : null;
            const locality = check.postcode_locality;
            if (
              (stated === 'CH' || stated === 'LI') &&
              locality &&
              POSTCODE_LOCALITY_WARNINGS.has(locality.status)
            ) {
              findings.push({
                code: 'postcode_locality_mismatch',
                detail: `${locality.detail} Source: ${locality.source}`,
              });
            }
            if (!check.conforms) {
              const what = check.findings
                .filter((f) => f.verdict === 'fail')
                .map((f) => f.rule)
                .slice(0, 3)
                .join(', ');
              findings.push({
                code: 'address_not_structured',
                detail: `Postal address does not meet ${scheme === 'sps' ? 'the Swiss structured-address rules (SIX, 14.11.2026)' : 'ISO 20022 structured-address rules'}${what ? `: ${what}` : ''}.`,
              });
            }
          }
        }
      }
    }
    row.status = findings.some((f) => ERROR_CODES.has(f.code))
      ? 'error'
      : findings.length > 0
        ? 'warning'
        : 'ok';
    out.push(row);
  });

  const byCode: Partial<Record<FindingCode, number>> = {};
  const countries = new Map<string, number>();
  for (const row of out) {
    for (const f of row.findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
    if (row.country) countries.set(row.country, (countries.get(row.country) ?? 0) + 1);
  }
  // The one line a reader needs before trusting a page of green: how much of
  // this file no register could have contradicted. A row whose IBAN did not
  // validate has no country and is counted nowhere here.
  const withoutAuthoritative = out.filter(
    (r) => r.country !== null && r.register_basis !== 'authoritative',
  ).length;
  const tier = tierFor(out.length);
  const summary: AuditSummary = {
    rows: out.length,
    ok: out.filter((r) => r.status === 'ok').length,
    warning: out.filter((r) => r.status === 'warning').length,
    error: out.filter((r) => r.status === 'error').length,
    by_code: byCode,
    countries: [...countries.entries()]
      .map(([code, n]) => ({ code, rows: n, ...registerCoverage(code) }))
      .map(({ code, rows, basis, register }) => ({
        code,
        rows,
        register_basis: basis,
        register,
      }))
      .sort((a, b) => b.rows - a.rows),
    rows_without_authoritative_register: withoutAuthoritative,
    columns_detected: (Object.keys(cols) as Array<keyof AuditColumnMap>).filter(
      (k) => cols[k] !== undefined,
    ),
    address_checked: hasAddress,
    tier: tier.code,
    price: tier.price,
    currency: AUDIT_CURRENCY,
  };
  return { headers, columns: cols, rows: out, source_rows: rows, summary };
}

export function tierFor(rows: number): (typeof AUDIT_TIERS)[number] {
  return AUDIT_TIERS.find((t) => rows <= t.max_rows) ?? AUDIT_TIERS[AUDIT_TIERS.length - 1]!;
}

/** Full audit from a raw upload. */
export function auditFile(buffer: Buffer, filename = ''): AuditResult {
  const { headers, rows } = readTable(buffer, filename);
  return auditTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Rendering: labels, preview, workbook
// ---------------------------------------------------------------------------

const LABELS: Record<AuditLang, Record<FindingCode, string>> = {
  en: {
    iban_missing: 'IBAN missing',
    iban_invalid: 'IBAN invalid',
    bank_code_not_allocated: 'Bank code not in the national register',
    modulus_check_failed: 'UK account checksum fails',
    national_check_digits_failed: 'National check key fails',
    national_check_digits_suspect: 'German account check digit fails (warning)',
    sepa_not_reachable: 'Not reachable by SEPA transfer',
    test_bic: 'Test BIC',
    bic_mismatch: 'BIC in file differs from the register',
    country_mismatch: 'Address country differs from IBAN country',
    duplicate: 'Duplicate IBAN',
    issuer_not_bank: 'Held at a payment institution, not a bank',
    country_risk: 'Elevated country risk',
    address_not_structured: 'Address not structured (ISO 20022)',
    postcode_locality_mismatch: 'Postcode and town not listed together (swisstopo directory)',
    verify_payee_name: 'Verify the payee name (VoP)',
    bank_not_consulted: 'Bank not consulted',
  },
  fr: {
    iban_missing: 'IBAN manquant',
    iban_invalid: 'IBAN invalide',
    bank_code_not_allocated: 'Code banque absent du registre national',
    modulus_check_failed: 'Contrôle de compte britannique en échec',
    national_check_digits_failed: 'Clé de contrôle nationale en échec',
    national_check_digits_suspect: 'Clé du compte allemand en échec (avertissement)',
    sepa_not_reachable: "Hors de portée d'un virement SEPA",
    test_bic: 'BIC de test',
    bic_mismatch: 'BIC du fichier différent du registre',
    country_mismatch: "Pays de l'adresse différent du pays de l'IBAN",
    duplicate: 'IBAN en doublon',
    issuer_not_bank: 'Compte chez un établissement de paiement, pas une banque',
    country_risk: 'Risque pays élevé',
    address_not_structured: 'Adresse non structurée (ISO 20022)',
    postcode_locality_mismatch: 'NPA et localité non répertoriés ensemble (répertoire swisstopo)',
    verify_payee_name: 'Vérifier le nom du bénéficiaire (VoP)',
    bank_not_consulted: 'Banque non consultée',
  },
  de: {
    iban_missing: 'IBAN fehlt',
    iban_invalid: 'IBAN ungültig',
    bank_code_not_allocated: 'Bankleitzahl nicht im nationalen Register',
    modulus_check_failed: 'Britische Kontoprüfziffer fehlgeschlagen',
    national_check_digits_failed: 'Nationale Prüfziffer fehlgeschlagen',
    national_check_digits_suspect: 'Deutsche Kontoprüfziffer fehlgeschlagen (Warnung)',
    sepa_not_reachable: 'Per SEPA-Überweisung nicht erreichbar',
    test_bic: 'Test-BIC',
    bic_mismatch: 'BIC in der Datei weicht vom Register ab',
    country_mismatch: 'Adressland weicht vom IBAN-Land ab',
    duplicate: 'Doppelte IBAN',
    issuer_not_bank: 'Konto bei einem Zahlungsinstitut, nicht bei einer Bank',
    country_risk: 'Erhöhtes Länderrisiko',
    address_not_structured: 'Adresse nicht strukturiert (ISO 20022)',
    postcode_locality_mismatch: 'PLZ und Ort nicht zusammen verzeichnet (Verzeichnis swisstopo)',
    verify_payee_name: 'Empfängernamen prüfen (VoP)',
    bank_not_consulted: 'Bank nicht geprüft',
  },
};

const STATUS_LABELS: Record<AuditLang, Record<RowStatus, string>> = {
  en: { ok: 'OK', warning: 'Check', error: 'Do not pay' },
  fr: { ok: 'OK', warning: 'À vérifier', error: 'Ne pas payer' },
  de: { ok: 'OK', warning: 'Prüfen', error: 'Nicht zahlen' },
};

const COLS: Record<AuditLang, string[]> = {
  en: [
    'Status',
    'Findings',
    'Bank (register)',
    'BIC (register)',
    'IBAN country',
    'SEPA',
    'Address ISO 20022',
    'National register',
    'Detail',
  ],
  fr: [
    'Statut',
    'Constats',
    'Banque (registre)',
    'BIC (registre)',
    'Pays IBAN',
    'SEPA',
    'Adresse ISO 20022',
    'Registre national',
    'Détail',
  ],
  de: [
    'Status',
    'Befunde',
    'Bank (Register)',
    'BIC (Register)',
    'IBAN-Land',
    'SEPA',
    'Adresse ISO 20022',
    'Nationales Register',
    'Detail',
  ],
};

/**
 * What the "National register" column says, per country and per language.
 *
 * Three states because a boolean would merge the two that matter: a country
 * with no register at all (our silence says nothing) and a country whose
 * register names a holder but never denies one (a hit is worth something, a
 * miss is still nothing). Only `authoritative` licenses reading an absence as
 * "this bank code does not exist".
 */
const REGISTER_LABELS: Record<AuditLang, Record<RegisterBasis, string>> = {
  en: {
    authoritative: 'yes — a miss means the code is not allocated',
    partial: 'partial — a hit names the holder, a miss proves nothing',
    none: 'none — no register consulted for this country',
  },
  fr: {
    authoritative: 'oui — une absence vaut code non attribué',
    partial: 'partiel — une présence nomme le titulaire, une absence ne prouve rien',
    none: 'aucun — pas de registre consulté pour ce pays',
  },
  de: {
    authoritative: 'ja — ein Fehlen bedeutet: Code nicht vergeben',
    partial: 'teilweise — ein Treffer nennt den Inhaber, ein Fehlen beweist nichts',
    none: 'keines — für dieses Land wird kein Register abgefragt',
  },
};

export function registerLabel(basis: RegisterBasis, lang: AuditLang): string {
  return REGISTER_LABELS[lang][basis];
}

export function findingLabel(code: FindingCode, lang: AuditLang): string {
  return LABELS[lang][code];
}

export function statusLabel(status: RowStatus, lang: AuditLang): string {
  return STATUS_LABELS[lang][status];
}

/** Mask an IBAN for the free preview: country, check digits, last four. */
export function maskIban(iban: string | null, input: string): string {
  const v = (iban ?? input).replace(/\s+/g, '').toUpperCase();
  if (v.length < 8) return v === '' ? '' : '****';
  return `${v.slice(0, 4)} **** ${v.slice(-4)}`;
}

export interface PreviewRow {
  line: number;
  iban_masked: string;
  status: RowStatus;
  findings: FindingCode[];
  bank_name: string | null;
  /**
   * Present in the FREE preview on purpose. It is the one thing that changes
   * how a clean line should be read, and hiding it behind the paywall would
   * sell reassurance: without it, an Italian row with no finding looks exactly
   * like a German one that a register actually confirmed.
   */
  register_basis: RegisterBasis;
}

/** The free look: the first rows that need attention, masked, then the first OK ones. */
export function previewRows(result: AuditResult, limit = 20): PreviewRow[] {
  const flagged = result.rows.filter((r) => r.status !== 'ok');
  const fine = result.rows.filter((r) => r.status === 'ok');
  return [...flagged, ...fine].slice(0, limit).map((r) => ({
    line: r.line,
    iban_masked: maskIban(r.iban, r.iban_input),
    status: r.status,
    findings: r.findings.map((f) => f.code),
    bank_name: r.bank_name,
    register_basis: r.register_basis,
  }));
}

/** The paid deliverable: the source columns, then the audit columns, plus a summary sheet. */
export function buildWorkbook(
  result: AuditResult,
  lang: AuditLang,
  generatedAt = new Date(),
): Buffer {
  const l = LABELS[lang];
  // Chaque cellule du rapport tient dans ce qu'une cellule admet : une cellule
  // calculée plus longue est tronquée (11.11.2026).
  const fit = (s: string) =>
    s.length > AUDIT_MAX_CELL_CHARS ? `${s.slice(0, AUDIT_MAX_CELL_CHARS - 1)}…` : s;
  const header = [...result.headers, ...COLS[lang]].map(fit);
  const body = result.rows.map((row, i) => {
    const src = result.source_rows[i] ?? [];
    const cells = [
      ...result.headers.map((_, c) => src[c] ?? ''),
      STATUS_LABELS[lang][row.status],
      row.findings.map((f) => l[f.code]).join(' ; '),
      row.bank_name ?? '',
      row.bic_registry ?? '',
      row.country ?? '',
      row.sepa_reachable === null ? '' : row.sepa_reachable ? 'SEPA' : 'non-SEPA',
      row.address_verdict === null
        ? ''
        : row.address_verdict === 'pass'
          ? 'OK'
          : row.address_verdict === 'fail'
            ? 'KO'
            : 'n/a',
      // Blank for a row with no country: an unreadable IBAN has no register
      // question, and writing "none" there would read as a verdict.
      row.country === null ? '' : REGISTER_LABELS[lang][row.register_basis],
      row.findings.map((f) => f.detail).join(' | '),
    ];
    return cells.map(fit);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = header.map((h, i) => ({
    wch: i < result.headers.length ? Math.min(34, Math.max(10, h.length + 2)) : 22,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    lang === 'fr' ? 'Audit' : lang === 'de' ? 'Prüfung' : 'Audit',
  );

  const s = result.summary;
  const t = SUMMARY_LABELS[lang];
  const summaryRows: Array<[string, string | number]> = [
    [t.generated, generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    [t.rows, s.rows],
    [t.ok, s.ok],
    [t.warning, s.warning],
    [t.error, s.error],
    ['', ''],
    [t.by_finding, ''],
    ...(Object.entries(s.by_code) as Array<[FindingCode, number]>)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => [l[code], n] as [string, number]),
    ['', ''],
    [t.by_country, ''],
    // Country, row count, and what that country's register is worth — the
    // three belong on one line, because "42 rows in IT" reads as coverage
    // until you know no Italian register was consulted.
    ...s.countries.map(
      (c) => [`${c.code} — ${REGISTER_LABELS[lang][c.register_basis]}`, c.rows] as [string, number],
    ),
    ['', ''],
    [t.registers, ''],
    [t.registers_note, s.rows_without_authoritative_register],
    ['', ''],
    [t.method, ''],
    [t.method_1, ''],
    [t.method_2, ''],
    [t.method_3, ''],
    [localityMethodLine(lang), ''],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws2['!cols'] = [{ wch: 60 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws2, t.sheet);
  // Compressé (11.11.2026), comme Excel écrit ses classeurs : le rapport attend
  // son paiement dans la base, et compressé il y prend bien moins de place. Le
  // zlib natif, branché en tête de ce fichier, s'en charge.
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

const SUMMARY_LABELS: Record<AuditLang, Record<string, string>> = {
  en: {
    sheet: 'Summary',
    generated: 'Generated',
    rows: 'Rows audited',
    ok: 'OK',
    warning: 'To check',
    error: 'Do not pay',
    by_finding: 'Findings by type',
    by_country: 'Rows by IBAN country',
    registers: 'National registers',
    registers_note:
      'Rows in a country with no register that settles a negative (an unknown bank code there is not a proven one)',
    method: 'Method',
    method_1:
      'Structure and check digits (ISO 13616), bank code against the national register, BIC and bank name from the register (SIX, Bundesbank, EBA and others, see ibanforge.com/sources).',
    method_2:
      'SEPA reachability by country; Verification of Payee flag from the EPC register where served.',
    method_3:
      'Postal address checked against the Swiss Payment Standards structured-address rules (CH/LI) or ISO 20022 HVPS+ (other countries) when address columns are present.',
  },
  fr: {
    sheet: 'Synthèse',
    generated: 'Généré le',
    rows: 'Lignes contrôlées',
    ok: 'OK',
    warning: 'À vérifier',
    error: 'Ne pas payer',
    by_finding: 'Constats par type',
    by_country: "Lignes par pays de l'IBAN",
    registers: 'Registres nationaux',
    registers_note:
      "Lignes dans un pays sans registre qui tranche une absence (un code banque inconnu n'y est pas un code prouvé faux)",
    method: 'Méthode',
    method_1:
      'Structure et clé de contrôle (ISO 13616), code banque contre le registre national, BIC et nom de banque tirés du registre (SIX, Bundesbank, EBA et autres, voir ibanforge.com/sources).',
    method_2:
      'Joignabilité SEPA par pays ; signal Verification of Payee tiré du registre EPC là où il est servi.',
    method_3:
      "Adresse postale contrôlée contre les règles d'adresse structurée des Swiss Payment Standards (CH/LI) ou ISO 20022 HVPS+ (autres pays) quand des colonnes d'adresse sont présentes.",
  },
  de: {
    sheet: 'Zusammenfassung',
    generated: 'Erstellt am',
    rows: 'Geprüfte Zeilen',
    ok: 'OK',
    warning: 'Prüfen',
    error: 'Nicht zahlen',
    by_finding: 'Befunde nach Typ',
    by_country: 'Zeilen nach IBAN-Land',
    registers: 'Nationale Register',
    registers_note:
      'Zeilen in einem Land ohne Register, das ein Fehlen entscheidet (ein dort unbekannter Bankcode ist kein widerlegter Bankcode)',
    method: 'Methode',
    method_1:
      'Struktur und Prüfziffer (ISO 13616), Bankleitzahl gegen das nationale Register, BIC und Bankname aus dem Register (SIX, Bundesbank, EBA und weitere, siehe ibanforge.com/sources).',
    method_2:
      'SEPA-Erreichbarkeit nach Land; Verification-of-Payee-Hinweis aus dem EPC-Register, wo vorhanden.',
    method_3:
      'Postadresse gegen die Regeln für strukturierte Adressen der Swiss Payment Standards (CH/LI) bzw. ISO 20022 HVPS+ (andere Länder) geprüft, wenn Adressspalten vorhanden sind.',
  },
};

/**
 * La ligne de méthode du contrôle NPA et localité, avec la version du
 * répertoire et la mention que swisstopo exige pour toute diffusion.
 */
function localityMethodLine(lang: AuditLang): string {
  const table = loadChLocalities();
  const v = table ? table.version.split('-').reverse().join('.') : null;
  const credit = '©swisstopo';
  if (lang === 'fr') {
    return (
      'NPA et localité des adresses suisses et liechtensteinoises (colonne pays CH ou LI) comparés au répertoire ' +
      `officiel des localités de l'Office fédéral de topographie swisstopo${v ? `, version du ${v}` : ' (non chargé sur ce serveur)'}, ${credit} : ` +
      "un avertissement quand le répertoire donne ce NPA pour d'autres localités ou dans l'autre pays, ou n'y connaît " +
      'ni le NPA ni la localité dans cette zone postale ; jamais une erreur. Un NPA absent du répertoire, alors que la ' +
      'localité y figure sous un autre NPA de la même zone postale (probablement une case postale), reste non vérifié, ' +
      "sans avertissement : l'absence d'avertissement ne vaut pas vérification. La rue n'est pas contrôlée."
    );
  }
  if (lang === 'de') {
    return (
      'PLZ und Ort von Adressen in der Schweiz und in Liechtenstein (Länderspalte CH oder LI) mit dem amtlichen ' +
      `Ortschaftenverzeichnis des Bundesamts für Landestopografie swisstopo verglichen${v ? `, Stand ${v}` : ' (auf diesem Server nicht geladen)'}, ${credit}: ` +
      'eine Warnung, wenn das Verzeichnis die PLZ anderen Orten oder dem anderen Land zuordnet oder in diesem ' +
      'Postleitzahlgebiet weder die PLZ noch den Ort kennt; nie ein Fehler. Eine PLZ, die im Verzeichnis fehlt, während ' +
      'der Ort dort unter einer anderen PLZ desselben Postleitzahlgebiets steht (wahrscheinlich ein Postfach), bleibt ' +
      'ungeprüft, ohne Warnung: das Fehlen einer Warnung ist keine Bestätigung. Die Strasse wird nicht geprüft.'
    );
  }
  return (
    'Postcode and town of Swiss and Liechtenstein addresses (country column CH or LI) compared with the official ' +
    `directory of localities of the Federal Office of Topography swisstopo${v ? `, version of ${v}` : ' (not loaded on this server)'}, ${credit}: ` +
    'a warning when the directory lists the postcode for other towns or in the other country, or lists neither the ' +
    'postcode nor the town in that postal area; never an error. A postcode missing from the directory, while the town ' +
    'is listed there under another postcode of the same postal area (likely a post-office box), stays unverified, ' +
    'without a warning: the absence of a warning does not mean the pair was verified. The street is not checked.'
  );
}
