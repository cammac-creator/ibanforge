import fs from 'fs';
import path from 'path';

/**
 * The public register pages (/blz/{blz}, /iid/{iid}, /sk/{code}, /it/{code})
 * read a JSON exported by `npm run pages:export` in the API repository, which
 * calls the API in-process for every code: the "what the API answers" block on
 * each page is the route's own answer, not a re-implementation. See
 * scripts/export-register-pages.ts.
 *
 * /at/{code}, /be/{code} and /sm/{code} have no exported file since the
 * withdrawal step (25/09/2026): those registers are served by the API from a
 * private overlay and may not be copied into this public repository. Their pages
 * ask the API at request time (lib/register-live.ts).
 */

export interface BlzRegister {
  blz: string;
  name: string;
  short_name: string | null;
  bic: string | null;
  post_code: string | null;
  town: string | null;
  retired: boolean;
  successor_blz: string | null;
  as_of: string;
}

export interface BlzEntry {
  register: BlzRegister;
  example_iban: string;
  api: Record<string, unknown>;
  related: string[];
}

export interface IidRegister {
  iid: string;
  name: string;
  town: string | null;
  post_code: string | null;
  iid_type: number | null;
  headquarters_iid: string | null;
  redirect_iid: string | null;
  qr_iid: string | null;
  bic: string | null;
  valid_on: string;
}

export interface IidEntry {
  register: IidRegister;
  example_iban: string;
  api: Record<string, unknown>;
  related: string[];
}

/**
 * The identity an IID page shows in its title, description and subtitle.
 *
 * The SIX BankMaster publishes 26 IIDs (measured on the 2026-09-01 file) with no
 * name, no town and no BIC of their own: merged institutions whose number is
 * redirected to a successor (`redirect_iid`). Until 2026-09-07 those pages
 * interpolated the empty fields as they were, and Google was served titles
 * such as "IID 04835 (numéro de clearing) : , " — twenty-six junk pages in the
 * sitemap. The API already answers such a number with the successor's identity
 * and a `redirected_from` note, so the page carries the same: the target's
 * name, town and BIC, and the redirection said in words.
 */
export interface IidIdentity {
  name: string;
  town: string;
  bic: string;
  /** The IID the register redirects this number to; null for a number that names an institution itself. */
  redirectedTo: string | null;
}

export function iidIdentity(entry: IidEntry): IidIdentity {
  const r = entry.register;
  if (r.name.trim()) return { name: r.name, town: r.town ?? "", bic: r.bic ?? "", redirectedTo: null };
  const api = entry.api as {
    institution?: { name?: string };
    address?: { town?: string | null };
    bic?: string | null;
  };
  if (r.redirect_iid) {
    return { name: api.institution?.name ?? "", town: api.address?.town ?? "", bic: api.bic ?? "", redirectedTo: r.redirect_iid };
  }
  return { name: "", town: "", bic: "", redirectedTo: null };
}

export interface SkRegister {
  code: string;
  name: string;
  bic: string | null;
  /**
   * The register's own effective date, in full, not the year-month the API
   * stamps. The NBS terms make citing the source a condition of reuse, and the
   * citation names an edition — so the page prints this date beside `source`
   * rather than rebuilding a credit the seeder already wrote.
   */
  as_of: string;
  /** The credit string stored with the rows: authority, directory, version. */
  source: string;
}

export interface SkEntry {
  register: SkRegister;
  example_iban: string;
  api: Record<string, unknown>;
  related: string[];
}

/**
 * L'Italie (25/09/2026) : deux sortes de pages dans un même fichier. Un code EN
 * VIGUEUR, que la Banca d'Italia inscrit aujourd'hui (siège légal en Italie et
 * LEI quand elle le publie), et un code RADIÉ, dont la page dit la date et le
 * successeur légal. Le registre est partiel : la réponse de l'API porte
 * `authoritative: false` dans les deux cas, et les pages le disent.
 */
export type ItRegister =
  | {
      code: string;
      status: "in_force";
      name: string;
      street: string | null;
      post_code: string | null;
      town: string | null;
      lei: string | null;
      /** L'édition, en entier : la date du fichier de la Banca d'Italia. */
      as_of: string;
      /** Le crédit stocké avec les lignes : auteur, jeu, licence CC BY 4.0. */
      source: string;
    }
  | {
      code: string;
      status: "retired";
      /** Le DERNIER titulaire, tel que le registre l'écrivait. */
      name: string;
      /** Dernier jour où le registre porte ce code pour ce titulaire. */
      retired_on: string;
      successor_code: string | null;
      successor_name: string | null;
      as_of: string;
      source: string;
    };

export interface ItEntry {
  register: ItRegister;
  example_iban: string;
  api: Record<string, unknown>;
  related: string[];
}

interface RegisterFile<T> {
  generated_at: string;
  source: string;
  count: number;
  batch1: string[];
  entries: Record<string, T>;
}

let deCache: RegisterFile<BlzEntry> | null = null;
let chCache: RegisterFile<IidEntry> | null = null;
let skCache: RegisterFile<SkEntry> | null = null;
let itCache: RegisterFile<ItEntry> | null = null;

function read<T>(file: string): RegisterFile<T> {
  const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'registers', file), 'utf-8');
  return JSON.parse(raw) as RegisterFile<T>;
}

export function deBlzFile(): RegisterFile<BlzEntry> {
  if (!deCache) deCache = read<BlzEntry>('de-blz.json');
  return deCache;
}

export function chIidFile(): RegisterFile<IidEntry> {
  if (!chCache) chCache = read<IidEntry>('ch-iid.json');
  return chCache;
}

export function skBankFile(): RegisterFile<SkEntry> {
  if (!skCache) skCache = read<SkEntry>('sk-bank.json');
  return skCache;
}

/**
 * The credit the NBS terms require, from the register file itself.
 *
 * Built here rather than in each page so the two Slovak pages, and anything
 * added later, cite one string. The date is the register's effective date, not
 * our export date: the citation names an edition.
 */
export function skCredit(r: SkRegister): string {
  return `Zdroj: ${r.source} (${r.as_of})`;
}

/**
 * San Marino's credit on its live page, and why its date is worded differently
 * from Slovakia's. The BCSM publishes no edition and no revision date, so the
 * month the API stamps is the month WE read the page; a bare "(2026-09)" would
 * read as the source's own date and quietly overstate it. The register name and
 * the month come from the API's answer (lib/register-live.ts).
 */
export function smLiveCredit(entry: { source: string | null; register: string; as_of: string | null }): string {
  const source = entry.source ?? entry.register;
  return entry.as_of ? `Source: ${source} (read in ${entry.as_of})` : `Source: ${source}`;
}

export function itBankFile(): RegisterFile<ItEntry> {
  if (!itCache) itCache = read<ItEntry>('it-bank.json');
  return itCache;
}

/**
 * Le crédit que la licence CC BY 4.0 demande, depuis le fichier lui-même :
 * l'auteur, le jeu et la licence (stockés avec les lignes), l'édition, et
 * l'indication des modifications. Même texte que nationalRegisterCredit('IT')
 * de l'API, exprès : un crédit, deux surfaces.
 */
export function itCredit(r: ItRegister): string {
  return `Source: ${r.source}, edition ${r.as_of}; normalised and joined by IBANforge`;
}

/**
 * Les codes ABI ont cinq chiffres, et le registre les écrit sans zéro de tête
 * (`3111` pour 03111) : on complète, comme l'API (`normaliseCode('IT', …)`),
 * pour qu'une adresse tapée comme la source l'écrit ne tombe pas sur une 404.
 */
export function getItCode(code: string): ItEntry | null {
  if (!/^\d{1,5}$/.test(code)) return null;
  return itBankFile().entries[code.padStart(5, '0')] ?? null;
}

/**
 * Slovak payment codes PAD, where Austrian ones do not — and the difference is
 * the register's own doing.
 *
 * The OeNB is consistent: it publishes five digits and an Austrian IBAN carries
 * five, so the Austrian page can refuse anything else (lib/register-live.ts,
 * normaliseLiveCode). The NBS is not: its CSV writes
 * the largest bank as `200` while its own PDF, its HTML table and every Slovak
 * IBAN write `0200`. A reader who types what the CSV shows would land on a 404
 * for a real bank, and the search box strips to digits, so `/sk/200` is a URL
 * people will genuinely arrive on. Padding to four is what the API's own
 * `normaliseCode('SK', …)` does with the same input, and what the publisher
 * prints everywhere but that one file — so the two agree by construction.
 */
export function getSkCode(code: string): SkEntry | null {
  if (!/^\d{1,4}$/.test(code)) return null;
  return skBankFile().entries[code.padStart(4, '0')] ?? null;
}

export function getBlz(blz: string): BlzEntry | null {
  if (!/^\d{8}$/.test(blz)) return null;
  return deBlzFile().entries[blz] ?? null;
}

/** IIDs are stored zero-padded to five digits; accept "9000" and "09000" alike. */
export function normalizeIid(iid: string): string | null {
  if (!/^\d{1,5}$/.test(iid)) return null;
  return iid.padStart(5, '0');
}

export function getIid(iid: string): IidEntry | null {
  const key = normalizeIid(iid);
  if (!key) return null;
  return chIidFile().entries[key] ?? null;
}

export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

export function apiJson(api: Record<string, unknown>): string {
  return JSON.stringify(api, null, 2);
}
