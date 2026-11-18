/**
 * La liste turque : « TCMB Ödeme Sistemleri Katılımcıları », les participants des
 * systèmes de paiement de la banque centrale de Turquie (TCMB), un PDF lié depuis la
 * page de son système EFT.
 *
 *   SEED_FAMILY=restricted npx tsx scripts/seed-national.ts TR   # chaîne privée seulement
 *
 * ## Pourquoi par la surcouche privée (règle du 28/10/2026, case 2)
 *
 * Les conditions du site (« Kullanım Şartları », lues le 18/11/2026) : « Sitede yer alan
 * bilgiler, kaynak gösterilmek suretiyle yayımlanabilir; ancak bu bilgilerin ticari
 * amaçlarla kullanımı TCMB’nin yazılı iznine tabidir. » (l'information peut être publiée
 * avec sa source, mais son usage commercial est soumis à l'accord écrit de la TCMB). Case 2
 * de la grille (docs/data-sources.md) : servie depuis le fichier privé du serveur, source
 * citée avec le jour de lecture, retirée dans les 48 heures sur demande
 * (`RESTRICTED_WITHDRAWN=tcmb.gov.tr`). Aucune ligne n'entre dans ce dépôt : les tests
 * n'utilisent que des participants inventés.
 *
 * ## Le code, et pourquoi c'est celui de l'IBAN
 *
 * La colonne « Kod » porte quatre chiffres ; le code de banque de l'IBAN turc en a cinq
 * (positions 5 à 9). Le communiqué IBAN de la TCMB dit que les codes de banque sont
 * « determined and announced by the Central Bank », et son IBAN d'exemple porte 00001 :
 * le code de participant de la TCMB elle-même, 0001, précédé d'un zéro. C'est la lecture
 * retenue, et le crédit servi la dit (src/lib/tr-credit.ts) : chaque code est stocké
 * comme l'IBAN le porte, un zéro devant.
 *
 * ## Ce qui est écarté
 *
 * Les participants numérotés à partir de 0800 : dans l'édition lue, ce ne sont pas des
 * banques (le dépositaire central, la poste). La lecture « un zéro devant » n'est vérifiée
 * que sur des banques ; elle n'est pas étendue au-delà. Le chargeur les écarte et le dit.
 * La liste du système FAST, qui ajoute des établissements de paiement et de monnaie
 * électronique, n'est pas lue, pour la même raison.
 *
 * ## Le nom
 *
 * Tel que publié, en majuscules turques, sans les marques de note (« (*) » à « (****) »)
 * qui renvoient aux remarques du pied de page.
 *
 * ## Le texte
 *
 * `pdftotext -layout` (poppler), comme pour la Mongolie (scripts/seed-national-mn.ts) :
 * aucune bibliothèque PDF n'est ajoutée aux dépendances. Le lien du PDF porte un
 * identifiant qui peut changer avec le fichier : il est relu sur la page à chaque passage.
 * La page et le PDF sont lus sous plafond et avec un délai (scripts/bounded-read.ts).
 *
 * ## La date
 *
 * Le PDF ne porte aucune date de publication : `as_of` est le jour de lecture, et le
 * crédit le dit comme tel (« read by IBANforge on »), jamais « publié le ».
 *
 * ## Partiel
 *
 * La liste nomme les participants des systèmes de la TCMB, pas tous les titulaires d'un
 * code de banque d'IBAN turc : un code absent garde la réponse d'avant, jamais
 * `not_allocated` (enrich.ts, decideBankCode). Elle passe APRÈS les clés de la TBB
 * (`map_tr`) : elle ne nomme que les codes qu'elles ne portent pas.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCappedBody } from './bounded-read.js';

/** La page du système EFT, qui porte le lien du PDF des participants. */
export const TR_PAGE =
  'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB%20TR/Main%20Menu/Temel%20Faaliyetler/Odeme%20Sistemleri/Turkiyedeki%20Odeme%20Sistemleri/Elektronik%20Fon%20Transfer%20%28EFT%29%20Sistemi';
const TR_ORIGIN = 'https://www.tcmb.gov.tr';

/** Le crédit stocké avec chaque ligne ; le jour de lecture est ajouté par trCredit. */
export const TR_SOURCE =
  'Central Bank of the Republic of Türkiye (TCMB), list of participants in the TCMB payment systems (TCMB Ödeme Sistemleri Katılımcıları), https://www.tcmb.gov.tr';

/** Le premier code de participant qui n'est pas servi (voir l'en-tête). */
export const FIRST_UNSERVED_CODE = 800;

/** Plafonds : la page et le PDF lus en novembre 2026 en sont une petite fraction. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

export interface TurkeyEntry {
  /** Le code tel que l'IBAN le porte : un zéro, puis le code de participant. */
  code: string;
  name: string;
  bic: null;
  street: null;
  post_code: null;
  town: null;
  lei: null;
  source: string;
  as_of: string;
}

/** Ce qu'un lien de la page désigne, décodé ; null si l'adresse ne se décode pas. */
function decodedPath(href: string): string | null {
  try {
    return decodeURIComponent(href.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * Le seul lien du PDF des participants : un PDF du gestionnaire de contenu de la TCMB
 * dont le nom porte « Ödeme Sistemleri Katılımcıları » (la liste FAST s'appelle autrement).
 * Plusieurs ou aucun : échec. Les liens sont lus en un seul passage linéaire.
 */
export function turkeyPdfUrl(html: string): string {
  const links = new Set<string>();
  for (const m of html.matchAll(/href="([^"]{1,1000})"/g)) {
    const href = m[1];
    if (!href.startsWith('/wps/wcm/connect/')) continue;
    const path = decodedPath(href.split('?')[0]);
    if (!path || !path.toLowerCase().endsWith('.pdf')) continue;
    if (!path.includes('Ödeme Sistemleri Katılımcıları')) continue;
    links.add(href);
  }
  if (links.size !== 1)
    throw new Error(
      `TR: expected one participants PDF on the EFT page, found ${links.size}; layout changed`,
    );
  return `${TR_ORIGIN}${[...links][0]}`;
}

/** Une ligne du tableau : numéro d'ordre, code à quatre chiffres, nom. */
const ROW = /^\s*(\d{1,3})\s+(\d{4})\s+(\S.*?)\s*$/u;
/** L'en-tête des colonnes (« Kod », « Banka Adı »), qui peut se répéter sur une page suivante. */
const HEADER = /^\s*Kod\s+Banka\s+Ad/u;
/** Le titre du document (« … KATILIMCILARI (2026) »), répété lui aussi en tête de page. */
const TITLE = /^\s*TCMB\s+ÖDEME\s+SİSTEMLERİ\s+KATILIMCILARI\b/u;
/** Les marques de note en fin de nom : « (*) » à « (****) ». */
const NOTE_MARK = /\s*\(\*{1,6}\)\s*$/u;

export interface TurkeyRow {
  n: number;
  /** Le code de participant, quatre chiffres, tel que publié. */
  participant: string;
  name: string;
}

/**
 * Les lignes du tableau, depuis le texte de `pdftotext -layout`. Échoue plutôt que
 * deviner : en-tête absent, ligne inconnue entre deux lignes du tableau, numéros d'ordre
 * qui ne se suivent pas, code en double, nom vide.
 */
export function parseTurkeyText(text: string): TurkeyRow[] {
  const lines = text.split(/\r?\n|\f/);
  const headerIndex = lines.findIndex((l) => HEADER.test(l));
  if (headerIndex < 0) throw new Error('TR: table header not found, layout changed');
  const rows: TurkeyRow[] = [];
  const codes = new Set<string>();
  let ended = false;
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() === '' || HEADER.test(line) || TITLE.test(line)) continue;
    const m = ROW.exec(line);
    if (!m) {
      // Le pied de page (les remarques datées) clôt le tableau.
      if (rows.length === 0) throw new Error('TR: a line under the header is not a participant');
      ended = true;
      continue;
    }
    if (ended) throw new Error('TR: a participant row after the end of the table');
    const n = Number(m[1]);
    if (n !== rows.length + 1) throw new Error(`TR: row ${rows.length + 1} expected, read ${n}`);
    const participant = m[2];
    if (codes.has(participant)) throw new Error(`TR: code ${participant} listed twice`);
    codes.add(participant);
    const name = m[3].replace(NOTE_MARK, '').replace(/\s+/gu, ' ').trim();
    if (!name) throw new Error(`TR: code ${participant} has no name`);
    rows.push({ n, participant, name });
  }
  if (rows.length === 0) throw new Error('TR: no participant row under the header');
  return rows;
}

/** Les lignes servies : les participants numérotés sous 0800, au code de l'IBAN. */
export function buildTurkeyRegister(
  rows: TurkeyRow[],
  readOn: string,
): { entries: TurkeyEntry[]; notes: string[] } {
  const notes: string[] = [];
  const entries: TurkeyEntry[] = [];
  for (const row of rows) {
    if (Number(row.participant) >= FIRST_UNSERVED_CODE) {
      notes.push(`${row.participant}: numbered 0800 or above, not a bank, left out`);
      continue;
    }
    entries.push({
      code: `0${row.participant}`,
      name: row.name,
      bic: null,
      street: null,
      post_code: null,
      town: null,
      lei: null,
      source: TR_SOURCE,
      as_of: readOn,
    });
  }
  entries.sort((a, b) => a.code.localeCompare(b.code));
  return { entries, notes };
}

/** Le texte du PDF par `pdftotext -layout` (poppler). Échoue clairement si l'outil manque. */
export function pdfLayoutText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibanforge-tr-'));
  try {
    const file = join(dir, 'participants.pdf');
    writeFileSync(file, pdf);
    const run = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: TIMEOUT_MS,
    });
    if (run.error)
      throw new Error(`TR: pdftotext (poppler) is required to read the PDF (${run.error.message})`);
    if (run.status !== 0) throw new Error(`TR: pdftotext failed (code ${run.status})`);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Une lecture plafonnée : l'adresse et le plafond d'octets ; lève `HTTP <statut>` sur un refus. */
export type TrFetch = (url: string, maxBytes: number) => Promise<Buffer>;

async function fetchCapped(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TR: ${url} -> HTTP ${res.status}`);
  return readCappedBody(res, maxBytes, `TR: ${url}`);
}

/** La liste lue en ligne : la page, son PDF, le texte, les lignes servies. */
export async function readTurkeyLive(
  get: TrFetch = fetchCapped,
  readOn: string = new Date().toISOString().slice(0, 10),
  toText: (pdf: Buffer) => string = pdfLayoutText,
): Promise<{ entries: TurkeyEntry[]; notes: string[]; url: string }> {
  const page = (await get(TR_PAGE, MAX_PAGE_BYTES)).toString('utf8');
  const url = turkeyPdfUrl(page);
  const pdf = await get(url, MAX_PDF_BYTES);
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-')
    throw new Error('TR: the participants link did not serve a PDF');
  const rows = parseTurkeyText(toText(pdf));
  return { ...buildTurkeyRegister(rows, readOn), url };
}
