import { registerCountries, namesOf } from './positioning.js';
import { registerCoverage } from './enrich.js';

/**
 * The register lists the CONTRACT texts quote, built from the code that decides
 * the verdict.
 *
 * ## Why this file exists
 *
 * When Czechia became the eighth country whose register settles a negative
 * (25/09/2026), the static copies held by positioning.test.ts moved with it,
 * but six served texts did not: the OpenAPI and x402 description of
 * `bank_code_check.authoritative` ("in all seven"), the `institution` and
 * `street` descriptions beside it, the MCP output schema of `bic.basis`, the
 * `validate_iban` descriptions of both MCP servers ("everywhere else treat it
 * as UNAVAILABLE"), the OpenAPI `bic.basis`, and the public roadmap. An agent
 * that read them treated a Czech refusal as "unavailable". Each had been typed
 * by hand, and the Slovak register had already had to walk through all of them
 * one by one on 06/09/2026.
 *
 * So the country lists are read here from `registerCountries()` (positioning,
 * which reads `registerCoverage()`, which reads NATIONAL_REGISTERS), and the
 * served texts interpolate them. `register-lists.test.ts` fails when a country
 * whose register is authoritative is missing from any of them. The prose around
 * the lists stays written by hand; only what changes when a register joins is
 * computed.
 *
 * Only the static maps are read: nothing here touches the database, so the
 * texts can be built at module load, where the schemas are.
 */

/**
 * How the contract texts cite each register, shorter than the name
 * `bank_code_check.register` serves. A register that joins without an entry
 * here is cited by that served name, so it is never left out; the entry only
 * makes the sentence shorter.
 */
const SHORT_REGISTER_NAME: Record<string, string> = {
  DE: 'the Deutsche Bundesbank Bankleitzahlendatei',
  AT: 'the Oesterreichische Nationalbank SEPA-Zahlungsverkehrs-Verzeichnis',
  BE: 'the Banque nationale de Belgique bank identification codes',
  SK: 'the Národná banka Slovenska prevodník of identification codes for the domestic payment system',
  CZ: 'the Česká národní banka číselník of payment-system codes (Číselník kódů platebního styku)',
  BG: 'the Bulgarian National Bank BAE register',
  CH: 'the SIX BankMaster',
  LI: 'the SIX BankMaster',
};

/**
 * Registers that settle NO negative (`bank_code_check.authoritative: false`)
 * while the BIC they print beside a code they list is their own pairing, so
 * `bic.basis` is `national_register`. San Marino only, today: see the San
 * Marino block of resolveBank in enrich.ts. Luxembourg's register pairs its BIC
 * the same way but answers only where its private file is configured, so the
 * static texts leave it out, as they always have.
 */
const PARTIAL_REGISTERS_PAIRING_THE_BIC = ['SM'];

/**
 * What each register publishes about the institution, for the `institution`
 * and `street` descriptions. Every country whose register is authoritative or
 * partial must have an entry: register-lists.test.ts holds it, so the next
 * register has to say how deep it goes before the contract can describe it.
 */
type InstitutionDepth =
  | { depth: 'seat'; publisher: string }
  | { depth: 'post_code_town'; publisher: string }
  | { depth: 'name'; publisher: string; script?: string }
  | { depth: 'registered_office'; publisher: string }
  | { depth: 'group'; publisher: string };

const INSTITUTION_DEPTH: Record<string, InstitutionDepth> = {
  CH: { depth: 'seat', publisher: 'SIX' },
  LI: { depth: 'seat', publisher: 'SIX' },
  AT: { depth: 'seat', publisher: 'the OeNB' },
  DE: { depth: 'post_code_town', publisher: 'the Bundesbank' },
  BE: { depth: 'name', publisher: 'the Banque nationale de Belgique' },
  BG: { depth: 'name', publisher: 'the Bulgarian National Bank', script: 'Cyrillic' },
  SK: { depth: 'name', publisher: 'the Národná banka Slovenska', script: 'Slovak diacritics' },
  CZ: { depth: 'name', publisher: 'the Česká národní banka', script: 'Czech diacritics' },
  LU: { depth: 'name', publisher: 'the ABBL' },
  // Le siège légal en Italie (pour une banque étrangère, sa succursale
  // italienne), et le LEI quand elle le publie. Sur un code radié, le nom seul.
  IT: { depth: 'registered_office', publisher: "the Banca d'Italia" },
  SM: { depth: 'registered_office', publisher: 'the Central Bank of the Republic of San Marino' },
  FI: { depth: 'group', publisher: 'Finance Finland' },
};

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/** "DE, AT and BE": codes only, joined the way the contract prose reads. */
export function codesAnd(codes: readonly string[]): string {
  if (codes.length <= 1) return codes.join('');
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
}

/** Countries whose register settles a negative, in display order (Germany first). */
export function authoritativeCountries(): string[] {
  return registerCountries().authoritative;
}

/** "eight": how many countries settle a negative, in words. */
export function authoritativeCountInWords(): string {
  const n = authoritativeCountries().length;
  return NUMBER_WORDS[n] ?? String(n);
}

function shortName(cc: string): string {
  return SHORT_REGISTER_NAME[cc] ?? registerCoverage(cc).register ?? cc;
}

/**
 * "DE against the Deutsche Bundesbank Bankleitzahlendatei, …, and CH and LI
 * against the SIX BankMaster": every authoritative country with the register
 * it is checked against, countries sharing a register grouped.
 */
export function authoritativeRegisterClause(): string {
  const groups: Array<{ name: string; codes: string[] }> = [];
  for (const cc of authoritativeCountries()) {
    const name = shortName(cc);
    const group = groups.find((g) => g.name === name);
    if (group) group.codes.push(cc);
    else groups.push({ name, codes: [cc] });
  }
  const parts = groups.map((g) => `${codesAnd(g.codes)} against ${g.name}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** Countries whose `bic.basis` can be `national_register`: the register's own pairing. */
export function nationalRegisterBicCountries(): string[] {
  return [...authoritativeCountries(), ...PARTIAL_REGISTERS_PAIRING_THE_BIC];
}

/** "DE, AT, …, LI and SM". */
export function nationalRegisterBicCodes(): string {
  return codesAnd(nationalRegisterBicCountries());
}

/** "Germany, Austria, …, Liechtenstein and San Marino". */
export function nationalRegisterBicNames(): string {
  return namesOf(nationalRegisterBicCountries());
}

/**
 * Every country whose register answers with an institution block, in display
 * order: the authoritative registers, then the partial ones, then Luxembourg
 * (partial, but only where its private file is configured).
 */
export function registerCountriesWithInstitution(): string[] {
  const { authoritative, partial } = registerCountries();
  return [...new Set([...authoritative, ...partial, 'LU'])];
}

/** The countries a depth applies to, in display order. */
function withDepth(...depths: Array<InstitutionDepth['depth']>): Array<[string, InstitutionDepth]> {
  return registerCountriesWithInstitution()
    .map((cc) => [cc, INSTITUTION_DEPTH[cc]] as [string, InstitutionDepth | undefined])
    .filter((e): e is [string, InstitutionDepth] => !!e[1] && depths.includes(e[1].depth));
}

/** "the OeNB (AT)" style, grouping countries that share a publisher ("SIX (CH/LI)"). */
function publishers(entries: Array<[string, InstitutionDepth]>): string[] {
  const groups: Array<{ publisher: string; codes: string[] }> = [];
  for (const [cc, d] of entries) {
    const group = groups.find((g) => g.publisher === d.publisher);
    if (group) group.codes.push(cc);
    else groups.push({ publisher: d.publisher, codes: [cc] });
  }
  return groups.map((g) => `${g.publisher} (${g.codes.join('/')})`);
}

function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The "Depth varies by register" sentence of the `institution` description,
 * and the sentence on names served verbatim.
 */
export function institutionDepthSentences(): string {
  const verb = (list: string[], plural: string, singular: string) =>
    list.length > 1 ? plural : singular;
  const seat = publishers(withDepth('seat'));
  const postTown = publishers(withDepth('post_code_town'));
  const names = publishers(withDepth('name'));
  const office = publishers(withDepth('registered_office'));
  const scripts = withDepth('name')
    .map(([cc, d]) => (d.depth === 'name' && d.script ? `for ${cc} means ${d.script}` : null))
    .filter((s): s is string => s !== null);
  return (
    `Depth varies by register: ${andList(seat)} ${verb(seat, 'publish', 'publishes')} the full seat address, ` +
    `${andList(postTown)} ${verb(postTown, 'publish', 'publishes')} postal code and town only, ` +
    `${andList(names)} ${verb(names, 'publish', 'publishes')} names alone, ` +
    `${andList(office)} ${verb(office, 'publish', 'publishes')} the registered office; ` +
    'for Finland the name is the banking group the code belongs to (Nordea Bank for code 1), not an individual institution. ' +
    `Names are served exactly as the register writes them, which ${andList(scripts)} — ` +
    'transliterating would be an alteration the terms of those publishers forbid.'
  );
}

/** "DE, BE, SK, CZ, BG, LU": registers that publish no street. */
export function noStreetCodes(): string {
  return withDepth('post_code_town', 'name')
    .map(([cc]) => cc)
    .join(', ');
}

/** Does this country have a declared institution depth? For the test. */
export function hasInstitutionDepth(cc: string): boolean {
  return !!INSTITUTION_DEPTH[cc];
}

/**
 * The sentence both MCP servers put in the `validate_iban` description: where
 * `not_in_register` is a refusal, and what to do everywhere else.
 */
export function authoritativeVerdictSentence(): string {
  return (
    `Only where authoritative is true (today ${authoritativeRegisterClause()}) ` +
    'does not_in_register mean the bank code is not allocated; everywhere else treat it as UNAVAILABLE and let the downstream name check decide.'
  );
}
