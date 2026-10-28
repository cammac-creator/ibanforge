/**
 * Le registre mongol : le registre unifié des participants au système de paiement
 * (« Төлбөрийн системийн оролцогчдын нэгдсэн бүртгэл ») que la Banque de Mongolie
 * (Монголбанк) publie en PDF sur sa page « ҮТС-ийн оролцогчийн код ».
 *
 *   SEED_FAMILY=restricted npx tsx scripts/seed-national.ts MN   # chaîne privée seulement
 *
 * ## Pourquoi par la surcouche privée (règle du 28/10/2026, case 2)
 *
 * Le site ne publie aucune condition de réutilisation, seulement un « Copyright » :
 * case 2 de la grille (docs/data-sources.md). Servi depuis le fichier privé du
 * serveur, source citée avec le jour de lecture, retiré dans les 48 heures sur
 * demande (`RESTRICTED_WITHDRAWN=mongolbank.mn`). Aucune ligne n'entre dans ce
 * dépôt : les tests n'utilisent que des participants inventés.
 *
 * ## Le code, et pourquoi c'est celui de l'IBAN
 *
 * La colonne « Банк код » porte quatre chiffres : les positions 5 à 8 de l'IBAN
 * mongol. Une banque le confirme en publiant un IBAN d'exemple dont ces quatre
 * chiffres sont le code que le registre lui donne (docs/data-sources.md).
 *
 * ## 🚨 Quel BIC servir : la colonne SWIFT seule, lue à sa POSITION
 *
 * Le tableau a trois colonnes de BIC : RTGS et ACH+ (identifiants des systèmes
 * nationaux) et SWIFT. Elles diffèrent parfois pour une même banque, et les
 * participants non bancaires n'en ont qu'une, celle d'ACH+. Prendre « le dernier BIC
 * de la ligne » servirait comme BIC SWIFT des adresses absentes du réseau SWIFT, et un
 * virement international partirait vers rien. Chaque BIC est donc rangé dans la
 * colonne dont l'en-tête est le plus proche de sa position dans le texte de
 * `pdftotext -layout` ; seul celui de la colonne SWIFT est servi, les autres lignes
 * ont `bic: null` (le nom seul). Un BIC loin de toute colonne fait échouer le
 * chargeur.
 *
 * ## Ce qui est écarté
 *
 * Les banques en liquidation, que le registre marque « ЭХА » (administrateur de
 * liquidation) : elles n'ouvrent plus de comptes, le chargeur les écarte et le dit.
 *
 * ## Le nom
 *
 * En cyrillique, tel que publié (même règle que les noms bulgares) : aucune
 * translittération n'est inventée ici.
 *
 * ## Le texte
 *
 * `pdftotext -layout` (poppler : `brew install poppler`, `apt-get install
 * poppler-utils`), aucune bibliothèque PDF n'étant ajoutée aux dépendances, comme
 * pour la Serbie (scripts/seed-rs-register.ts). Le lien du PDF porte une empreinte qui
 * change avec le fichier : il est relu sur la page à chaque passage.
 *
 * ## Partiel
 *
 * Le registre nomme les participants au système de paiement, pas l'attribution de
 * l'espace des codes : un code absent garde la réponse d'avant, jamais
 * `not_allocated` (NON_EXHAUSTIVE_REGISTERS, enrich.ts).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MN_PAGE = 'https://www.mongolbank.mn/mn/p/1306';
const MN_ORIGIN = 'https://www.mongolbank.mn';

/** Le crédit stocké avec chaque ligne. */
export const MN_SOURCE =
  'Bank of Mongolia (Mongolbank), unified register of payment system participants';

export interface MongoliaEntry {
  code: string;
  name: string;
  bic: string | null;
  street: null;
  post_code: null;
  town: null;
  lei: null;
  source: string;
  as_of: string;
}

/** Le seul lien de PDF de la page, sous `/file/<empreinte>/files/`. Plusieurs ou aucun : échec. */
export function mongoliaPdfUrl(html: string): string {
  const links = new Set(
    [...html.matchAll(/(?:href|src)="(\/file\/[0-9a-f]{32}\/files\/[^"]+\.pdf)"/gi)].map(
      (m) => m[1],
    ),
  );
  if (links.size !== 1)
    throw new Error(
      `MN: expected one participants PDF on ${MN_PAGE}, found ${links.size}; layout changed`,
    );
  return `${MN_ORIGIN}${[...links][0]}`;
}

const COLUMNS = ['RTGS БИК', 'ACH+ БИК', 'SWIFT БИК'] as const;
type Column = 'rtgs' | 'ach' | 'swift';
const COLUMN_KEYS: Record<(typeof COLUMNS)[number], Column> = {
  'RTGS БИК': 'rtgs',
  'ACH+ БИК': 'ach',
  'SWIFT БИК': 'swift',
};
/** Au-delà de cet écart avec l'en-tête le plus proche, un BIC n'est dans aucune colonne. */
const MAX_DRIFT = 5;

const ROW = /^\s*(\d{1,3})\s+(\d{4})\s+(.*)$/u;
/** Un BIC mongol à huit caractères, la forme que portent les trois colonnes. */
const BIC = /^[A-Z]{4}MN[A-Z0-9]{2}$/;
const LIQUIDATION = /(^|\s)ЭХА(\s|$)/u;

export interface MongoliaRow {
  n: number;
  code: string;
  name: string;
  bics: Partial<Record<Column, string>>;
}

/**
 * Les lignes du tableau, depuis le texte de `pdftotext -layout`. Échoue plutôt que
 * deviner : en-tête absent, numéros de ligne qui ne se suivent pas, BIC hors des
 * colonnes, mot inconnu après le nom, code en double.
 */
export function parseMongoliaText(text: string): MongoliaRow[] {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (l) => l.includes('Банк код') && COLUMNS.every((c) => l.includes(c)),
  );
  if (headerIndex < 0) throw new Error('MN: table header not found, layout changed');
  const header = lines[headerIndex];
  const starts = COLUMNS.map((c) => ({ column: COLUMN_KEYS[c], at: header.indexOf(c) }));
  const rows: MongoliaRow[] = [];
  const codes = new Set<string>();
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() === '') continue;
    const m = ROW.exec(line);
    if (!m) {
      // La légende (RTGS, ACH+, SWIFT et leur sens) clôt le tableau.
      if (/^\s*(RTGS|ACH\+|SWIFT)\s/.test(line)) break;
      throw new Error('MN: a table line does not read as a participant row');
    }
    const n = Number(m[1]);
    if (n !== rows.length + 1) throw new Error(`MN: row ${rows.length + 1} expected, read ${n}`);
    const code = m[2];
    if (codes.has(code)) throw new Error(`MN: code ${code} listed twice`);
    codes.add(code);
    // Le reste de la ligne : le nom, puis le compte au RTGS (des chiffres), puis les
    // BIC. Le nom s'arrête au premier compte ou BIC ; ses mots sont rejoints par un
    // seul espace.
    const restStart = line.length - m[3].length;
    const bics: Partial<Record<Column, string>> = {};
    const nameParts: string[] = [];
    let afterName = false;
    for (const word of m[3].matchAll(/\S+/gu)) {
      const at = restStart + word.index;
      const value = word[0];
      if (/^\d{6,12}$/.test(value)) {
        afterName = true;
        continue;
      }
      if (BIC.test(value)) {
        afterName = true;
        const nearest = starts.reduce((best, s) =>
          Math.abs(s.at - at) < Math.abs(best.at - at) ? s : best,
        );
        if (Math.abs(nearest.at - at) > MAX_DRIFT)
          throw new Error(`MN: code ${code}, a BIC sits outside every BIC column`);
        if (bics[nearest.column])
          throw new Error(`MN: code ${code}, two BICs in the ${nearest.column} column`);
        bics[nearest.column] = value;
        continue;
      }
      if (afterName) throw new Error(`MN: code ${code}, an unknown word after the name`);
      nameParts.push(value);
    }
    const name = nameParts.join(' ');
    if (!name) throw new Error(`MN: code ${code} has no name`);
    rows.push({ n, code, name, bics });
  }
  if (rows.length === 0) throw new Error('MN: no participant row under the header');
  return rows;
}

/** Les lignes servies : sans les banques en liquidation, avec le seul BIC SWIFT. */
export function buildMongoliaRegister(
  rows: MongoliaRow[],
  readOn: string,
): { entries: MongoliaEntry[]; notes: string[] } {
  const notes: string[] = [];
  const entries: MongoliaEntry[] = [];
  for (const row of rows) {
    if (LIQUIDATION.test(row.name)) {
      notes.push(`${row.code}: in liquidation (ЭХА), left out`);
      continue;
    }
    entries.push({
      code: row.code,
      name: row.name,
      bic: row.bics.swift ?? null,
      street: null,
      post_code: null,
      town: null,
      lei: null,
      source: MN_SOURCE,
      as_of: readOn,
    });
  }
  return { entries, notes };
}

/** Le texte du PDF par `pdftotext -layout` (poppler). Échoue clairement si l'outil manque. */
export function pdfLayoutText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibanforge-mn-'));
  try {
    const file = join(dir, 'participants.pdf');
    writeFileSync(file, pdf);
    const run = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    if (run.error)
      throw new Error(`MN: pdftotext (poppler) is required to read the PDF (${run.error.message})`);
    if (run.status !== 0) throw new Error(`MN: pdftotext failed (code ${run.status})`);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!res.ok) throw new Error(`MN: ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Le registre lu en ligne : la page, son PDF, le texte, les lignes servies. */
export async function readMongoliaLive(
  get: (url: string) => Promise<Buffer> = fetchBuffer,
  readOn: string = new Date().toISOString().slice(0, 10),
): Promise<{ entries: MongoliaEntry[]; notes: string[] }> {
  const page = (await get(MN_PAGE)).toString('utf8');
  const pdf = await get(mongoliaPdfUrl(page));
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new Error('MN: the participants link did not serve a PDF');
  return buildMongoliaRegister(parseMongoliaText(pdfLayoutText(pdf)), readOn);
}
