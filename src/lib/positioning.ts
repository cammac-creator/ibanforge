import { datasetFacts } from './dataset-facts.js';
import { registerCoverage, structuralRuleCountries } from './enrich.js';
import { IBAN_LENGTHS, getCountryName } from './countries.js';
import { getSourceFreshness } from './bic-lookup.js';
import { LU_SOURCE, luRegisterConfigured } from './lu-register.js';
import { REST_TRIAL_DAILY_LIMIT } from './trial.js';
import { MCP_DAILY_LIMIT } from './mcp-limits.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

/**
 * What IBANforge is, said once for every first line a machine reads.
 *
 * ## Why this file exists
 *
 * On 24/09/2026 several assistants (ChatGPT, Gemini, DeepSeek, Grok) described
 * the product from our own first lines: Swiss clearing in the lead, "for AI
 * agents", "sanctions" with no word saying whose, "VoP" with no word saying
 * what, "121k BIC ... refreshed monthly" and a pack price changed a week
 * earlier. They filed us as a Swiss tool for agents and credited us with a name
 * check and a screening of the payee that we do not perform. Every one of those
 * errors was a sentence of ours, typed by hand on a dozen surfaces.
 *
 * So the sentences live here, and the facts inside them are read, not typed:
 *   - the countries whose register settles a negative, and the partial ones,
 *     come from `registerCoverage()`, the accessor `bank_code_check` obeys;
 *   - the share of the BIC directory that is a frozen public copy, and its
 *     month, come from the per-source counts `/health` serves;
 *   - the country total comes from `datasetFacts()`.
 * Only the ORDER in which countries are named is editorial (see below).
 *
 * Static files cannot import this module: the site's llms files, the README,
 * glama.json, the JSON-LD and the comparison page. `positioning.test.ts` holds
 * them to the same sentences, so a register that joins or leaves the code makes
 * them fail instead of drifting.
 *
 * 🚨 Nothing here may promise a date in every answer. The validation answer
 * dates its register verdict, but the curated-map path and GET /v1/bic do not
 * yet carry the vintage of a 2018 row. "Names its source" is true today;
 * "dated in every answer" is not.
 */

/**
 * The order in which register countries are NAMED, and nothing else.
 *
 * Which countries appear is read from the code. The order is a choice: Germany
 * first, the largest register we read; Switzerland and Liechtenstein last and
 * together, because one register (the SIX BankMaster) serves both, and because
 * naming Switzerland first on every surface is what made assistants file
 * IBANforge as a Swiss tool. A country the code adds that is missing here is
 * appended after these, in code order, never dropped.
 */
const DISPLAY_ORDER = ['DE', 'AT', 'BE', 'SK', 'BG', 'CH', 'LI', 'FI', 'SM', 'LU', 'LV', 'GI'];

function byDisplayOrder(codes: readonly string[]): string[] {
  const rank = (cc: string): number => {
    const i = DISPLAY_ORDER.indexOf(cc);
    return i === -1 ? DISPLAY_ORDER.length : i;
  };
  // Array.prototype.sort is stable, so unknown codes keep the order they came in.
  return [...codes].sort((a, b) => rank(a) - rank(b));
}

export interface RegisterCountries {
  /** The register is read in full: a code it does not hold is `not_allocated`, `authoritative: true`. */
  authoritative: string[];
  /** A hit names the holder, a miss says nothing: `authoritative: false`. */
  partial: string[];
  /** A structural rule the authority publishes, not a register. */
  structural: string[];
}

export function registerCountries(): RegisterCountries {
  const codes = Object.keys(IBAN_LENGTHS);
  const authoritative = codes.filter((cc) => registerCoverage(cc).basis === 'authoritative');
  const partial = codes.filter((cc) => registerCoverage(cc).basis === 'partial');
  // Luxembourg's register answers only where its file is configured, and
  // `registerCoverage('LU')` does not know about it. Added where it answers,
  // never claimed where it does not.
  if (luRegisterConfigured() && !partial.includes('LU')) partial.push('LU');
  return {
    authoritative: byDisplayOrder(authoritative),
    partial: byDisplayOrder(partial),
    structural: byDisplayOrder(structuralRuleCountries()),
  };
}

/** "Germany, Austria and Belgium". */
export function namesOf(codes: readonly string[]): string {
  const names = codes.map((cc) => getCountryName(cc) ?? cc);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "DE, AT, BE": comma only, so the same string reads in every language. */
export function codesOf(codes: readonly string[]): string {
  return codes.join(', ');
}

/** The register name a caller reads in `bank_code_check.register`, per country. */
function registerNameOf(cc: string): string | null {
  if (cc === 'LU') return LU_SOURCE.replace(/^Source:\s*/, '');
  return registerCoverage(cc).register;
}

/**
 * "Germany: <register>" lines, with countries that share one register grouped
 * ("Switzerland and Liechtenstein: SIX BankMaster ...").
 */
function registerLines(codes: readonly string[]): string[] {
  const groups: Array<{ register: string; codes: string[] }> = [];
  for (const cc of codes) {
    const register = registerNameOf(cc);
    if (!register) continue;
    const group = groups.find((g) => g.register === register);
    if (group) group.codes.push(cc);
    else groups.push({ register, codes: [cc] });
  }
  return groups.map((g) => `${namesOf(g.codes)}: ${g.register}`);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2018-01" -> "January 2018". */
function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/**
 * A share in the words every surface uses. Rounded to the nearest, not down:
 * this is an admission about stale data, and understating it would flatter us.
 */
export function shareInWords(share: number): string {
  const pct = Math.round(share * 100);
  if (pct >= 62 && pct <= 71) return 'about two thirds';
  if (pct >= 45 && pct <= 55) return 'about half';
  if (pct >= 29 && pct <= 38) return 'about a third';
  return `about ${pct}%`;
}

export interface FrozenBicShare {
  /** Rows of the public SWIFT directory copy (source `swiftcodes`). */
  rows: number;
  /** Every row of the BIC directory. */
  total: number;
  /** "about two thirds". */
  words: string;
  /** "January 2018": the month that copy's data describes, or null if unknown. */
  month: string | null;
}

/**
 * How much of the BIC directory is the public copy of the SWIFT directory that
 * stopped moving in 2018, read from the same per-source counts `/health` serves.
 */
export function frozenBicShare(): FrozenBicShare {
  const sources = getSourceFreshness();
  const total = sources.reduce((n, s) => n + s.entries, 0);
  const copy = sources.find((s) => s.source === 'swiftcodes');
  const rows = copy?.entries ?? 0;
  return {
    rows,
    total,
    words: shareInWords(total > 0 ? rows / total : 0),
    month: copy?.source_as_of ? monthName(copy.source_as_of) : null,
  };
}

export interface BicDirectoryBreakdown extends FrozenBicShare {
  /** Rows from GLEIF, the only rows that carry an LEI. */
  gleif: number;
  /** Rows from the national registers and EBA STEP2, refreshed with GLEIF. */
  other: number;
}

/** The exact split, for the one surface that prints live counts (/llms.txt). */
export function bicDirectoryBreakdown(): BicDirectoryBreakdown {
  const frozen = frozenBicShare();
  const gleif = getSourceFreshness().find((s) => s.source === 'gleif')?.entries ?? 0;
  return { ...frozen, gleif, other: Math.max(0, frozen.total - frozen.rows - gleif) };
}

/**
 * The BIC directory, said the way it is. `withCount` adds the rounded-down
 * claim for surfaces that already quote one.
 */
export function bicDirectorySentence(options: { withCount?: boolean } = {}): string {
  const f = frozenBicShare();
  const head = options.withCount
    ? `BIC directory, ${datasetFacts().claim.bic} entries (entries, not institutions)`
    : 'BIC directory';
  if (f.rows === 0 || !f.month) return `${head}: GLEIF and national registers, refreshed monthly.`;
  return (
    `${head}: GLEIF and national registers, refreshed monthly, plus a public copy of the SWIFT ` +
    `directory frozen in ${f.month} that still makes up ${f.words} of the rows.`
  );
}

/** The long paragraph: llms files, README, OpenAPI. */
export function positioningLong(): string {
  const { authoritative } = registerCountries();
  const countries = datasetFacts().claim.countries;
  return (
    'IBANforge checks the bank behind an IBAN before you pay. ' +
    `It validates IBANs from all ${countries} IBAN countries and names the bank and its BIC, with the source of that answer. ` +
    `Where it reads the national register (${namesOf(authoritative)}), it also tells you whether the bank code is allocated at all; ` +
    'elsewhere it names the bank from a partial register or a composite map, and says that such an answer cannot rule a code out. ' +
    'For each SEPA bank it resolves, it says whether the bank is reachable by SEPA Credit Transfer, SEPA Instant and SEPA Direct Debit, ' +
    'and whether it answers Verification of Payee (VoP) requests. ' +
    "It does not check who holds the account: that name check belongs to the payee's bank, through VoP."
  );
}

/** The one line: MCP, cards, x402 catalogue, JSON-LD. */
export function positioningOneLine(): string {
  const { authoritative } = registerCountries();
  const countries = datasetFacts().claim.countries;
  return (
    `Check the bank behind an IBAN before you pay: validation in ${countries} countries, ` +
    `a bank-code verdict from the national register (${codesOf(authoritative)}), ` +
    'the bank and BIC with their source, the SEPA, SEPA Instant and VoP readiness of the bank, ' +
    'and bank-level sanctions (OFAC, EU, UN).'
  );
}

/**
 * What we are not, said right after what we are.
 *
 * The second sentence was added on 24/09/2026 after a probe: a French IBAN
 * whose RIB key was wrong, its mod-97 recomputed, came back `valid: true` and
 * `verified`. Until the national check digits are coded, the list says so.
 */
export const NOT_WHAT_IT_IS =
  'Not a name check (VoP, BAV, CoP), not proof that an account exists or is open, ' +
  'not a sanctions screening of the payee (bank and country only), ' +
  'not a licensed copy of the SWIFT BIC directory. ' +
  'The national check digits inside the BBAN are not checked yet (the French RIB key, the Italian CIN, ' +
  'the Spanish DC, the German account-number methods): an IBAN with a wrong national key but a correct ' +
  'mod-97 still comes back valid. Only the UK modulus check and the Polish settlement-number check digit are run.';

/**
 * The free ways in, one sentence per door, every figure read from the constant
 * the code applies.
 *
 * Written for the MCP server card (24/09/2026): it is the one page of the API
 * DeepSeek opened live, and it said nothing about free access, so the
 * assistant answered from stale copies elsewhere.
 *
 * 🚨 Two rules, and both are the point. Each door is NAMED (the keyless trial,
 * the hosted MCP transport, the free key): a bare number is what readers
 * confuse. And the trial's daily figure and the key's monthly figure never sit
 * in the same sentence: today they are the same number with nothing in common
 * (one route a day, every route a month), and side by side they read as "the
 * key is worse than no key". The key is announced by what it reaches once
 * claimed.
 */
export function freeAccessSentences(): string[] {
  return [
    `No key at all: POST /v1/iban/validate answers up to ${REST_TRIAL_DAILY_LIMIT} IBAN validations a day per source address, in full, to try it out.`,
    `The hosted MCP transport (https://api.ibanforge.com/mcp) answers up to ${MCP_DAILY_LIMIT} full tool calls a day per IP, a batch counting one per IBAN, with no key and no wallet.`,
    `A key that needs no e-mail and no card (POST /v1/keys/generate with an empty body) works on every endpoint and reaches ${FREE_TIER_MONTHLY_LIMIT} requests a month once claimed at POST /v1/keys/claim.`,
    `Before the claim, that key starts at ${ANONYMOUS_MONTHLY_LIMIT} requests a month.`,
  ];
}

/** The scope of the sanctions check, in the words every compliance description uses. */
export const BANK_LEVEL_SANCTIONS =
  "sanctions lists (OFAC, EU, UN) matched on the payee's bank (BIC8) and country, never on the payee's name";

/** The one line plus the two facts a directory entry must not omit. */
export function serverDescription(): string {
  return `${positioningOneLine()} It does not check the payee's name. ${bicDirectorySentence()}`;
}

/** Three questions, three layers, and where IBANforge sits among them. */
export function threeLayers(): string[] {
  return [
    '1. Is the number well written? Structure and mod-97: free, offline with the MIT library `ibanforge` on npm, or GET /v1/iban/format.',
    '2. Which bank is it, does its code exist, and can it be reached? That is IBANforge: the bank-code verdict (the national register where we read it, which can say "not allocated"; a partial register or a composite map elsewhere, which cannot; every validation says which), the bank and BIC with their source, the SEPA, SEPA Instant and VoP readiness of that bank, e-money and virtual-IBAN detection, and bank-level sanctions.',
    "3. Is the account open, and in this name? Only the payee's bank can answer, through Verification of Payee or an equivalent service. IBANforge tells you whether that bank answers VoP requests; it never runs the name check.",
  ];
}

/**
 * The register half of the "country by country" block, every name read from
 * the code that decides the verdict.
 */
export function registerBlock(): string[] {
  const { authoritative, partial, structural } = registerCountries();
  const lines: string[] = [];
  if (authoritative.length > 0) {
    lines.push(
      '- Checked against the national register, read in full: a code it does not hold comes back `not_allocated`, `authoritative: true`.',
      ...registerLines(authoritative).map((l) => `  - ${l}`),
    );
  }
  if (partial.length > 0) {
    lines.push(
      '- A partial register: a hit names the holder, a miss is not a refusal (`authoritative: false`).',
      ...registerLines(partial).map((l) => `  - ${l}`),
    );
  }
  if (structural.length > 0) {
    lines.push(
      `- A structural rule the authority publishes, not a register (\`authoritative: false\`): ${namesOf(structural)}, where IBAN positions 5-8 are the first four characters of the BIC.`,
    );
  }
  return lines;
}
