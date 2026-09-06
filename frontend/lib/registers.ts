import fs from 'fs';
import path from 'path';

/**
 * The public register pages (/blz/{blz}, /iid/{iid}, /at/{code}, /be/{code},
 * /sk/{code}) read a JSON exported by
 * `npm run pages:export` in the API repository, which calls the API in-process
 * for every code: the "what the API answers" block on each page is the route's
 * own answer, not a re-implementation. See scripts/export-register-pages.ts.
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

export interface AtRegister {
  code: string;
  name: string;
  bic: string | null;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
  as_of: string;
}

export interface AtEntry {
  register: AtRegister;
  example_iban: string;
  api: Record<string, unknown>;
  related: string[];
}

export interface BeRegister {
  code: string;
  name: string;
  bic: string | null;
  /** First code of the block the NBB allocated to this institution: the bank's page. */
  canonical: string;
  group_codes: string[];
  as_of: string;
}

export interface BeEntry {
  register: BeRegister;
  example_iban: string;
  api: Record<string, unknown>;
  related: string[];
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
 * San Marino. Shaped like the Slovak one, with the registered office the BCSM
 * publishes and Slovakia's register does not — and one difference that is not
 * visible in the type: these answers carry `authoritative: false`, because the
 * BCSM lists operating banks rather than allocating the code space.
 */
export interface SmRegister {
  code: string;
  name: string;
  bic: string | null;
  street: string | null;
  post_code: string | null;
  town: string | null;
  /** The day we READ the page. The BCSM publishes no edition and no revision date. */
  as_of: string;
  source: string;
}

export interface SmEntry {
  register: SmRegister;
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
let atCache: RegisterFile<AtEntry> | null = null;
let beCache: RegisterFile<BeEntry> | null = null;
let skCache: RegisterFile<SkEntry> | null = null;
let smCache: RegisterFile<SmEntry> | null = null;

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

export function atBlzFile(): RegisterFile<AtEntry> {
  if (!atCache) atCache = read<AtEntry>('at-blz.json');
  return atCache;
}

export function beBankFile(): RegisterFile<BeEntry> {
  if (!beCache) beCache = read<BeEntry>('be-bank.json');
  return beCache;
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

export function smBankFile(): RegisterFile<SmEntry> {
  if (!smCache) smCache = read<SmEntry>('sm-bank.json');
  return smCache;
}

/**
 * San Marino's credit, and why its date is worded differently from Slovakia's.
 *
 * Slovakia's date is the register's own effective date, so it reads as a plain
 * parenthesis. The BCSM publishes no edition and no revision date, so this one
 * is the day WE read the page — and a bare `(2026-09-06)` would read as the
 * source's date and quietly overstate it. Same wording as the API's own
 * nationalRegisterCredit('SM'), on purpose: one credit, two surfaces.
 */
export function smCredit(r: SmRegister): string {
  return `Source: ${r.source} (read on ${r.as_of})`;
}

/** San Marino ABI codes are five digits; the BCSM prints them padded already. */
export function getSmCode(code: string): SmEntry | null {
  if (!/^\d{1,5}$/.test(code)) return null;
  return smBankFile().entries[code.padStart(5, '0')] ?? null;
}

/** Austrian bank codes are five digits, no padding accepted: 19043 is not 019043. */
export function getAtCode(code: string): AtEntry | null {
  if (!/^\d{5}$/.test(code)) return null;
  return atBlzFile().entries[code] ?? null;
}

/** Belgian bank identifiers are three digits, leading zeros included: 001, not 1. */
export function getBeCode(code: string): BeEntry | null {
  if (!/^\d{3}$/.test(code)) return null;
  return beBankFile().entries[code] ?? null;
}

/**
 * Slovak payment codes PAD, where Austrian ones do not — and the difference is
 * the register's own doing.
 *
 * The OeNB is consistent: it publishes five digits and an Austrian IBAN carries
 * five, so `getAtCode` can refuse anything else. The NBS is not: its CSV writes
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
