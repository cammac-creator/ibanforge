import fs from 'fs';
import path from 'path';

/**
 * The public country pages (/iban/{cc}) read a JSON exported by
 * `npm run pages:export-countries` in the API repository, which calls the
 * validate route in-process for every ISO 13616 country: the "what the API
 * answers" block on each page is the route's own answer, not a re-implementation.
 * See scripts/export-country-pages.ts.
 */

export interface CountryField {
  name: 'bank_code' | 'branch_code' | 'account_number';
  /** 1-based positions inside the IBAN; the country code is 1–2, the check digits 3–4. */
  from: number;
  to: number;
  /** SWIFT notation of the charset, e.g. "8!n". */
  spec: string | null;
}

export interface CountryEntry {
  code: string;
  name_en: string;
  length: number;
  fields: CountryField[];
  example: string;
  sepa: { member: boolean; schemes: string[]; vop_required: boolean };
  /** The national register the API verified the example's bank code against, when it holds one. */
  register: string | null;
  api: Record<string, unknown>;
}

interface CountriesFile {
  generated_at: string;
  source: string;
  count: number;
  countries: Record<string, CountryEntry>;
}

let cache: CountriesFile | null = null;

export function countriesFile(): CountriesFile {
  if (!cache) {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'countries.json'), 'utf-8');
    cache = JSON.parse(raw) as CountriesFile;
  }
  return cache;
}

/** Two upper-case letters, nothing else: `ch` and `CHE` are not pages. */
export function getCountry(cc: string): CountryEntry | null {
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return countriesFile().countries[cc] ?? null;
}

export function allCountryCodes(): string[] {
  return Object.keys(countriesFile().countries).sort();
}

/** The register index page that covers this country's bank codes, when we publish one. */
export const REGISTER_INDEX: Record<string, string> = {
  DE: '/blz',
  CH: '/iid',
  LI: '/iid',
  AT: '/at',
  BE: '/be',
};

/**
 * A country's name in the reader's language, from the platform's own CLDR
 * data; the registry's English name when the platform has none (Kosovo has
 * no ISO code and no CLDR entry on some runtimes).
 */
export function countryName(cc: string, locale: string, fallback: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(cc) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Groups of four, the way an IBAN is printed. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/** The pretty JSON block every country page prints. */
export function apiJson(api: Record<string, unknown>): string {
  return JSON.stringify(api, null, 2);
}

/** Whether the register the API used is a national one (authoritative) rather than our composite map. */
export function isNationalRegister(entry: CountryEntry): boolean {
  const check = entry.api.bank_code_check as { authoritative?: boolean } | null | undefined;
  return Boolean(entry.register) && check?.authoritative === true;
}
