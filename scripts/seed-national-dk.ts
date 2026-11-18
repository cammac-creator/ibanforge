/**
 * La liste IBAN du Danemark, des îles Féroé et du Groenland : « IBAN Denmark,
 * Greenland and Faroe Islands », un fichier XLSX qu'e-nettet A/S (la société de
 * l'infrastructure commune des banques danoises, avec Finance Denmark comme second
 * contact) publie sur www.iban-denmark.com, page vers laquelle e-nettet.dk/iban/
 * redirige.
 *
 *   SEED_FAMILY=restricted npx tsx scripts/seed-national.ts DK   # chaîne privée seulement
 *
 * Étages (DONNEES-ETAGES) : lit la source (la page, puis le fichier, jamais écrit sur
 * disque), écrit l'argent (les lignes DK, FO et GL de `national_bank_codes`) dans la
 * base que la chaîne privée construit.
 *
 * ## Pourquoi par la surcouche privée (règle du 28/10/2026, case 2)
 *
 * La page ne publie aucune condition de réutilisation (relue le 18/11/2026) : case 2
 * de la grille (docs/data-sources.md). Servie depuis le fichier privé du serveur,
 * source citée avec la date de l'édition, retirée dans les 48 heures sur demande
 * (`RESTRICTED_WITHDRAWN=e-nettet.dk`). Aucune ligne n'entre dans ce dépôt : les
 * tests n'utilisent que des banques inventées.
 *
 * ## Le lien, découvert sur la page
 *
 * Le nom du fichier porte la date de son édition (« …-11-12-2025-v2.0.xlsx ») : une
 * nouvelle édition aura une autre adresse. Le lien est donc relu sur la page à chaque
 * passage ; elle doit en porter exactement un vers un .xlsx d'e-nettet.dk. L'adresse
 * connue (DK_FALLBACK_URL) ne sert que si la PAGE ne répond pas (HTTP, réseau, délai),
 * jamais si elle répond sans le lien attendu : une page qui a changé de forme se lit
 * par un humain, et une vieille adresse qui répond encore servirait en silence une
 * édition périmée (le piège slovaque, en tête de scripts/seed-national.ts).
 *
 * ## La date : celle de l'édition, jamais celle du téléchargement
 *
 * `as_of` est la date que porte le nom du fichier (JJ-MM-AAAA), recoupée avec le
 * texte du lien quand il en porte une ; à défaut, la date de modification inscrite
 * dans le classeur. Une date absente, contradictoire ou dans le futur fait échouer
 * le chargeur. La page dit que la liste est « updated whenever there are changes » :
 * une édition ancienne reste celle en vigueur, et la réponse dit de quand elle date.
 *
 * ## Les plages, développées en codes
 *
 * Chaque ligne donne une plage de numéros de registre (colonnes « From » et « To »,
 * positions 5 à 8 de l'IBAN), le nom de la banque, le pays de l'IBAN (DK, FO ou GL,
 * lu dans la colonne de la ligne, jamais dans le titre de section : des lignes
 * féroïennes figurent aussi dans la section danoise), la ville et le BIC. Chaque code
 * de la plage devient une ligne de `national_bank_codes`, la table où les autres
 * registres partiels vivent déjà : la recherche reste une égalité sur le code.
 *
 * Contrôles, dans cet ordre :
 * - l'en-tête est reconnu par son texte, la feuille ne dépasse pas ses bornes, aucune
 *   colonne inconnue n'est remplie : sinon échec (la forme a changé) ;
 * - une ligne dont un code n'est pas un nombre de 0 à 9999, dont la plage est
 *   inversée ou démesurée (plus de MAX_RANGE codes), dont le pays n'est pas DK, FO
 *   ou GL ou qui n'a pas de nom est écartée et comptée, ses codes ne sont pas servis ;
 * - le BIC est servi s'il a la forme ISO 9362 et le pays de la ligne en lettres 5-6 ;
 *   sinon la ligne est gardée sans BIC, et le chargeur le dit ;
 * - deux lignes qui donnent le même code : identiques, elles n'en font qu'une ; au
 *   même titulaire avec deux BIC, le code est servi sans BIC ; à deux titulaires
 *   différents, le code est AMBIGU, il n'est pas servi, et il est compté.
 *
 * ## Partiel
 *
 * La liste sert à traduire un IBAN en banque et en BIC ; elle ne publie pas
 * l'attribution des numéros de registre. Un code absent garde la réponse d'avant
 * (la carte composite), jamais `not_allocated` (NON_EXHAUSTIVE_REGISTERS, enrich.ts).
 */
import * as XLSX from 'xlsx';

/** La page qui publie le lien du fichier (e-nettet.dk/iban/ y redirige). */
export const DK_PAGE = 'https://www.iban-denmark.com/';

/** L'adresse relevée le 06/11/2026, en repli si la page ne répond pas. */
export const DK_FALLBACK_URL =
  'https://www.e-nettet.dk/wp-content/uploads/2025/12/IBAN-Denmark-Greenland-and-Faroe-Islands-11-12-2025-v2.0.xlsx';

/** Le crédit stocké avec chaque ligne ; la date de l'édition va dans `as_of`. */
export const DK_SOURCE =
  'e-nettet A/S, IBAN Denmark, Greenland and Faroe Islands (www.iban-denmark.com)';

export const DK_COUNTRIES = ['DK', 'FO', 'GL'] as const;
export type DkCountry = (typeof DK_COUNTRIES)[number];

/** Une plage plus large n'est pas une banque : une coquille (0001-9999) volerait tout l'espace. */
export const MAX_RANGE = 1000;

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_XLSX_BYTES = 5 * 1024 * 1024;
/** Les bornes de la feuille, contrôlées avant de la lire ligne à ligne. */
const MAX_SHEET_ROWS = 20_000;
const MAX_SHEET_COLUMNS = 40;

const UA = 'IBANforge register refresh (+https://ibanforge.com)';

export interface DkEntry {
  code: string;
  name: string;
  bic: string | null;
  street: null;
  post_code: null;
  town: string | null;
  lei: null;
  source: string;
  as_of: string;
}

/** Une ligne de données du classeur, telle que lue (avant contrôle). */
export interface DkRow {
  /** Numéro de la ligne dans la feuille, pour les notes. */
  line: number;
  from: unknown;
  to: unknown;
  name: unknown;
  country: unknown;
  city: unknown;
  bic: unknown;
}

export interface DkStats {
  /** Lignes de données lues sous l'en-tête (titres de section exclus). */
  rows: number;
  /** Lignes écartées (code illisible, plage inversée ou démesurée, pays inconnu, sans nom). */
  rows_rejected: number;
  /** Lignes par pays d'IBAN. */
  rows_by_country: Record<DkCountry, number>;
  /** Codes que les plages acceptées couvrent, répétitions comprises. */
  codes_expanded: number;
  /** Codes donnés deux fois à l'identique, fondus en un. */
  duplicates_merged: number;
  /** Codes donnés à deux titulaires différents : non servis. */
  ambiguous: number;
  /** Codes servis, par pays. */
  served: Record<DkCountry, number>;
  /** Codes servis sans BIC (BIC mal formé ou d'un autre pays, ou deux BIC pour un titulaire). */
  without_bic: number;
}

export interface DkRegister {
  entries: Record<DkCountry, DkEntry[]>;
  stats: DkStats;
  notes: string[];
}

function isDkCountry(value: string): value is DkCountry {
  return (DK_COUNTRIES as readonly string[]).includes(value);
}

/** Un code de quatre chiffres, ou null s'il n'en a pas la forme (Excel les écrit en nombres). */
function code4(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 9999 ? raw : null;
  const text = String(raw ?? '').trim();
  return /^\d{1,4}$/.test(text) ? Number(text) : null;
}

/** Les espaces répétés réduits à un seul ; rien d'autre ne change dans un nom. */
function clean(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ISO_BIC = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** Le BIC publié, s'il a la forme ISO 9362 et le pays de la ligne ; sinon null et la raison. */
export function dkBic(
  raw: unknown,
  country: DkCountry,
): { bic: string | null; dropped: 'malformed' | 'other_country' | null } {
  const value = String(raw ?? '')
    .replace(/\s/g, '')
    .toUpperCase();
  if (value === '') return { bic: null, dropped: null };
  if (!ISO_BIC.test(value)) return { bic: null, dropped: 'malformed' };
  if (value.slice(4, 6) !== country) return { bic: null, dropped: 'other_country' };
  return { bic: value, dropped: null };
}

/** Une date JJ-MM-AAAA (ou JJ MM AAAA) en ISO, si c'est une vraie date. */
function isoFromDayMonthYear(day: string, month: string, year: string): string | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}

/** La date d'édition que porte le nom du fichier (« …-11-12-2025-v2.0.xlsx »), ou null. */
export function editionFromUrl(url: string): string | null {
  const file = decodeURIComponent(url.split('/').pop() ?? '');
  const m = /(?:^|[^\d])(\d{1,2})-(\d{1,2})-(\d{4})(?:[^\d]|$)/.exec(file);
  return m ? isoFromDayMonthYear(m[1], m[2], m[3]) : null;
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all);
}

export interface DkListLink {
  url: string;
  /** La date de l'édition, ISO, lue dans le nom du fichier ; null s'il n'en porte pas. */
  edition: string | null;
}

/**
 * Le seul lien de la page vers un fichier .xlsx d'e-nettet.dk. Aucun, ou deux
 * différents : échec (la page a changé). Le texte du lien, quand il porte une date,
 * doit dire la même que le nom du fichier.
 */
export function dkListLink(html: string, pageUrl: string = DK_PAGE): DkListLink {
  const found = new Map<string, string[]>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(m[1]), pageUrl);
    } catch {
      continue;
    }
    if (!/\.xlsx$/i.test(url.pathname)) continue;
    if (url.hostname !== 'www.e-nettet.dk' && url.hostname !== 'e-nettet.dk') continue;
    url.protocol = 'https:';
    const text = clean(decodeEntities(m[2].replace(/<[^>]*>/g, ' ')));
    found.set(url.href, [...(found.get(url.href) ?? []), text]);
  }
  if (found.size !== 1)
    throw new Error(
      `DK: expected one IBAN list (.xlsx on e-nettet.dk) on ${pageUrl}, found ${found.size}; layout changed`,
    );
  const [[url, texts]] = [...found];
  const edition = editionFromUrl(url);
  for (const text of texts) {
    const m = /(?:^|[^\d])(\d{1,2})[ .\-/](\d{1,2})[ .\-/](\d{4})(?:[^\d]|$)/.exec(text);
    const said = m ? isoFromDayMonthYear(m[1], m[2], m[3]) : null;
    if (said && edition && said !== edition)
      throw new Error(`DK: the link text says ${said}, the file name ${edition}; refusing`);
  }
  return { url, edition };
}

/** Le texte d'un en-tête, sans retour à la ligne, en minuscules. */
function headerText(value: unknown): string {
  return clean(value).toLowerCase();
}

/** La ligne d'en-tête : la plage (début, fin), la banque, le pays, la ville, le BIC. */
function isHeader(row: unknown[]): boolean {
  const h = row.map(headerText);
  return (
    /range from/.test(h[0] ?? '') &&
    /range to/.test(h[1] ?? '') &&
    /bank/.test(h[2] ?? '') &&
    /country/.test(h[3] ?? '') &&
    /city/.test(h[4] ?? '') &&
    /bic/.test(h[5] ?? '')
  );
}

/** Un titre de section (« From », « To », « DENMARK ») : sauté. */
function isSectionTitle(row: unknown[]): boolean {
  return headerText(row[0]) === 'from' && headerText(row[1]) === 'to';
}

export interface DkWorkbook {
  rows: DkRow[];
  /** La date de modification inscrite dans le classeur, ISO, ou null. */
  modified: string | null;
}

/** Les lignes de données du classeur, sous l'en-tête. Échoue si la forme a changé. */
export function readDkWorkbook(buffer: Buffer): DkWorkbook {
  if (buffer.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004')
    throw new Error('DK: the IBAN list link did not serve an XLSX file');
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false });
  if (wb.SheetNames.length !== 1)
    throw new Error(`DK: expected one sheet, found ${wb.SheetNames.length}; layout changed`);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const ref = sheet?.['!ref'];
  if (!ref) throw new Error('DK: the sheet is empty');
  const range = XLSX.utils.decode_range(ref);
  const height = range.e.r - range.s.r + 1;
  const width = range.e.c - range.s.c + 1;
  if (
    !Number.isFinite(height) ||
    !Number.isFinite(width) ||
    height > MAX_SHEET_ROWS ||
    width > MAX_SHEET_COLUMNS
  )
    throw new Error('DK: the sheet is larger than any edition of the list; refusing');
  const all = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerAt = all.findIndex((row) => Array.isArray(row) && isHeader(row));
  if (headerAt < 0) throw new Error('DK: table header not found, layout changed');
  const rows: DkRow[] = [];
  for (let i = headerAt + 1; i < all.length; i++) {
    const row = all[i] ?? [];
    if (row.every((v) => v === null || clean(v) === '')) continue;
    if (isSectionTitle(row)) continue;
    if (row.slice(6).some((v) => v !== null && clean(v) !== ''))
      throw new Error(`DK: sheet line ${i + 1} fills a column beyond the BIC; layout changed`);
    rows.push({
      line: i + 1,
      from: row[0],
      to: row[1],
      name: row[2],
      country: row[3],
      city: row[4],
      bic: row[5],
    });
  }
  if (rows.length === 0) throw new Error('DK: no row under the table header');
  // La propriété du classeur, lue en Date par la bibliothèque ; illisible, elle ne date rien.
  const stamp: unknown = wb.Props?.ModifiedDate;
  const modified =
    stamp instanceof Date && Number.isFinite(stamp.getTime())
      ? stamp.toISOString().slice(0, 10)
      : null;
  return { rows, modified };
}

interface Candidate {
  name: string;
  bic: string | null;
  town: string | null;
  line: number;
}

/**
 * Les codes servis, par pays, depuis les lignes lues. Ne lève pas pour une ligne
 * fautive : elle est écartée et comptée (une coquille de l'éditeur ne doit pas priver
 * tout le pays de son registre) ; le plancher du chargeur garde d'un fichier vidé.
 */
export function buildDkRegister(rows: readonly DkRow[], edition: string): DkRegister {
  const notes: string[] = [];
  const stats: DkStats = {
    rows: rows.length,
    rows_rejected: 0,
    rows_by_country: { DK: 0, FO: 0, GL: 0 },
    codes_expanded: 0,
    duplicates_merged: 0,
    ambiguous: 0,
    served: { DK: 0, FO: 0, GL: 0 },
    without_bic: 0,
  };
  const byKey = new Map<string, { country: DkCountry; code: string; candidates: Candidate[] }>();
  for (const row of rows) {
    const from = code4(row.from);
    const to = code4(row.to);
    const country = clean(row.country).toUpperCase();
    const name = clean(row.name);
    const reject = (why: string) => {
      stats.rows_rejected++;
      notes.push(`sheet line ${row.line}: ${why}, left out`);
    };
    if (from === null || to === null) {
      reject('a bank identifier is not a number from 0 to 9999');
      continue;
    }
    if (from > to) {
      reject('the range ends before it starts');
      continue;
    }
    if (to - from + 1 > MAX_RANGE) {
      reject(`the range spans more than ${MAX_RANGE} codes`);
      continue;
    }
    if (!isDkCountry(country)) {
      reject('the country is not DK, FO or GL');
      continue;
    }
    if (!name) {
      reject('no bank name');
      continue;
    }
    stats.rows_by_country[country]++;
    const { bic, dropped } = dkBic(row.bic, country);
    if (dropped) notes.push(`sheet line ${row.line}: published BIC dropped (${dropped})`);
    const town = clean(row.city) || null;
    for (let n = from; n <= to; n++) {
      stats.codes_expanded++;
      const code = String(n).padStart(4, '0');
      const key = `${country}:${code}`;
      const slot = byKey.get(key) ?? { country, code, candidates: [] };
      slot.candidates.push({ name, bic, town, line: row.line });
      byKey.set(key, slot);
    }
  }

  const entries: Record<DkCountry, DkEntry[]> = { DK: [], FO: [], GL: [] };
  const ambiguousLines = new Set<string>();
  for (const { country, code, candidates } of byKey.values()) {
    const [first] = candidates;
    let bic = first.bic;
    let town = first.town;
    if (candidates.length > 1) {
      const holders = new Set(candidates.map((c) => c.name.toUpperCase()));
      if (holders.size > 1) {
        stats.ambiguous++;
        ambiguousLines.add(
          `${country}, sheet lines ${[...new Set(candidates.map((c) => c.line))].join(' and ')}`,
        );
        continue;
      }
      stats.duplicates_merged++;
      // Le même titulaire : un BIC seulement si toutes les lignes donnent le même.
      if (new Set(candidates.map((c) => c.bic)).size > 1) bic = null;
      if (new Set(candidates.map((c) => c.town)).size > 1) town = null;
    }
    if (!bic) stats.without_bic++;
    stats.served[country]++;
    entries[country].push({
      code,
      name: first.name,
      bic,
      street: null,
      post_code: null,
      town,
      lei: null,
      source: DK_SOURCE,
      as_of: edition,
    });
  }
  for (const where of ambiguousLines)
    notes.push(`${where}: the same code given to two holders, not served`);
  for (const country of DK_COUNTRIES) entries[country].sort((a, b) => a.code.localeCompare(b.code));
  return { entries, stats, notes };
}

/** Une lecture plafonnée : l'adresse et le plafond d'octets ; lève `HTTP <statut>` sur un refus. */
export type DkFetch = (url: string, maxBytes: number) => Promise<Buffer>;

async function fetchCapped(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`DK: ${url} -> HTTP ${res.status}`);
  const tooLarge = () => new Error(`DK: ${url} is larger than ${maxBytes} bytes; refusing`);
  const declared = res.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw tooLarge();
  if (!res.body) {
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw tooLarge();
    return body;
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export interface DkLiveRead extends DkRegister {
  /** L'adresse du fichier lu, et si elle vient de la page ou du repli. */
  url: string;
  via: 'page' | 'fallback';
  edition: string;
}

/**
 * La liste lue en ligne : la page, son lien, le fichier, les codes servis.
 * `today` (ISO) borne la date d'édition : une édition « future » est refusée.
 */
export async function readDenmarkLive(
  get: DkFetch = fetchCapped,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DkLiveRead> {
  let link: DkListLink;
  let via: 'page' | 'fallback' = 'page';
  let page: string | null = null;
  try {
    page = (await get(DK_PAGE, MAX_PAGE_BYTES)).toString('utf8');
  } catch {
    // La page seule ne répond pas : l'adresse connue, dont le nom porte sa date.
    // Son propre refus (HTTP 503 compris) remonte tel quel au chargeur.
    via = 'fallback';
  }
  if (page !== null) link = dkListLink(page);
  else link = { url: DK_FALLBACK_URL, edition: editionFromUrl(DK_FALLBACK_URL) };
  const workbook = readDkWorkbook(await get(link.url, MAX_XLSX_BYTES));
  const edition = link.edition ?? workbook.modified;
  if (!edition) throw new Error('DK: the edition date is neither in the file name nor in the file');
  if (edition > today) throw new Error(`DK: edition dated ${edition}, after today; refusing`);
  const built = buildDkRegister(workbook.rows, edition);
  const notes = [...built.notes];
  if (via === 'fallback') notes.unshift(`page ${DK_PAGE} unreachable, read the known address`);
  if (!link.edition) notes.unshift('no date in the file name: edition dated by the workbook');
  else if (workbook.modified && workbook.modified !== link.edition)
    notes.push(`file name says ${link.edition}, workbook last modified ${workbook.modified}`);
  return { ...built, notes, url: link.url, via, edition };
}
