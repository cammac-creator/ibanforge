import fs from 'fs';
import path from 'path';

/**
 * The public register pages (/blz/{blz}, /iid/{iid}) read a JSON exported by
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

interface RegisterFile<T> {
  generated_at: string;
  source: string;
  count: number;
  batch1: string[];
  entries: Record<string, T>;
}

let deCache: RegisterFile<BlzEntry> | null = null;
let chCache: RegisterFile<IidEntry> | null = null;

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
