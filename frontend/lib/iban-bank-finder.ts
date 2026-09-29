/**
 * Which bank does this IBAN belong to? Read in the browser, never sent.
 *
 * Written 29/09/2026 for the reader the site already reaches without meaning
 * to: people who type "DE55 welche Bank" or "IBAN welche Bank Österreich" into
 * a search engine. Many of them hold only the first four characters, and read
 * the two digits after DE as the bank. They are the ISO 13616 check digits; the
 * bank sits further in, in the Bankleitzahl (positions 5 to 12 of a German
 * IBAN).
 *
 * Pure on purpose, and safe in a client component: no `fs`, no fetch, no
 * `Intl`, nothing imported from a module that reads the disk. The page passes
 * in the list of allocated codes it read on the server (lib/registers.ts); this
 * module only looks things up in it. The IBAN typed never leaves the function.
 *
 * Austria is read, not checked: its register is served by the API from a
 * private file and may not be copied into this public repository or into a
 * browser bundle (src/lib/restricted-family.ts). The reader gets the code and
 * the path of its page, rendered on demand; nothing about the code is claimed.
 */

export type FinderCountry = 'DE' | 'AT' | 'CH' | 'LI';

/** What the page read on the server, compacted: every allocated code, joined. */
export interface FinderRegisters {
  /** Every Bankleitzahl of the Bundesbank file, eight digits each, joined without separator. */
  deCodes: string;
  /** The codes the Bundesbank marks for deletion, with the successor it names (or null). */
  deRetired: Record<string, string | null>;
  /** Every IID of the SIX BankMaster (Switzerland and Liechtenstein), five digits each, joined. */
  chCodes: string;
}

/** The layout of each country the finder reads: total length and where the bank code sits. */
export const FINDER_LAYOUT: Record<FinderCountry, { length: number; codeStart: number; codeLength: number }> = {
  DE: { length: 22, codeStart: 4, codeLength: 8 },
  AT: { length: 20, codeStart: 4, codeLength: 5 },
  CH: { length: 21, codeStart: 4, codeLength: 5 },
  LI: { length: 21, codeStart: 4, codeLength: 5 },
};

export type FinderStatus =
  /** The register lists the code: its page names the bank. */
  | 'allocated'
  /** The Bundesbank lists the code and announces its deletion. */
  | 'retired'
  /** The register we read does not list the code: no institution holds it. */
  | 'not-in-register'
  /** Austria: the code is read, the register is not consulted here. */
  | 'unchecked';

export type FinderResult =
  | { kind: 'empty' }
  /** Only the country and (some of) the check digits: the case of "DE55". */
  | { kind: 'partial'; country: FinderCountry; checkDigits: string; needed: number }
  | { kind: 'error'; reason: 'characters' | 'country' | 'too-long'; country?: string }
  | { kind: 'unsupported'; country: string }
  | {
      kind: 'code';
      country: FinderCountry;
      /** The two digits after the country code; empty for a bare Bankleitzahl. */
      checkDigits: string;
      code: string;
      status: FinderStatus;
      successor: string | null;
      /** `pass` or `fail` once the IBAN is complete; `incomplete` before; `none` for a bare BLZ. */
      checksum: 'pass' | 'fail' | 'incomplete' | 'none';
      /** The site path of the code's page, without locale; null when no page exists for it. */
      path: string | null;
    };

/** Spaces, dashes and dots out, letters up: how people paste an IBAN. */
export function normaliseIban(input: string): string {
  return input.replace(/[\s\-.]/g, '').toUpperCase();
}

/**
 * ISO 13616 mod 97 on a complete IBAN: move the first four characters to the
 * end, turn letters into numbers (A = 10), and the remainder must be 1.
 * Computed in chunks so that no number ever leaves the safe integer range.
 */
export function ibanChecksumPasses(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let expanded = '';
  for (const ch of rearranged) expanded += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 7) rem = Number(`${rem}${expanded.slice(i, i + 7)}`) % 97;
  return rem === 1;
}

/** Whether `code` is one of the fixed-width codes joined in `joined`. */
export function hasCode(joined: string, code: string): boolean {
  const width = code.length;
  if (width === 0 || joined.length % width !== 0) return false;
  for (let i = 0; i < joined.length; i += width) {
    if (joined.slice(i, i + width) === code) return true;
  }
  return false;
}

function isFinderCountry(cc: string): cc is FinderCountry {
  return cc === 'DE' || cc === 'AT' || cc === 'CH' || cc === 'LI';
}

function lookUp(
  country: FinderCountry,
  code: string,
  registers: FinderRegisters,
): { status: FinderStatus; successor: string | null; path: string | null } {
  if (country === 'DE') {
    if (!hasCode(registers.deCodes, code)) return { status: 'not-in-register', successor: null, path: null };
    if (code in registers.deRetired) {
      return { status: 'retired', successor: registers.deRetired[code] ?? null, path: `/blz/${code}` };
    }
    return { status: 'allocated', successor: null, path: `/blz/${code}` };
  }
  if (country === 'AT') return { status: 'unchecked', successor: null, path: `/at/${code}` };
  if (!hasCode(registers.chCodes, code)) return { status: 'not-in-register', successor: null, path: null };
  return { status: 'allocated', successor: null, path: `/iid/${code}` };
}

/**
 * Read the bank code out of what the reader typed.
 *
 * - A German, Austrian, Swiss or Liechtenstein IBAN, complete or cut after the
 *   bank code: the code, what the register says about it, and its page.
 * - Four characters such as "DE55": the check digits named for what they are.
 * - Eight digits alone: a Bankleitzahl typed without its IBAN.
 * - Any other country: said plainly, with no guess.
 */
export function readBankCode(input: string, registers: FinderRegisters): FinderResult {
  const iban = normaliseIban(input);
  if (iban === '') return { kind: 'empty' };
  if (!/^[A-Z0-9]+$/.test(iban)) return { kind: 'error', reason: 'characters' };

  // A Bankleitzahl typed on its own.
  if (/^\d{8}$/.test(iban)) {
    const found = lookUp('DE', iban, registers);
    return { kind: 'code', country: 'DE', checkDigits: '', code: iban, checksum: 'none', ...found };
  }

  // One letter so far: nothing to say yet.
  if (/^[A-Z]$/.test(iban)) return { kind: 'empty' };
  if (!/^[A-Z]{2}/.test(iban)) return { kind: 'error', reason: 'country' };
  const country = iban.slice(0, 2);
  // Another country: said plainly, never guessed from a layout we do not read.
  if (!isFinderCountry(country)) return { kind: 'unsupported', country };
  const layout = FINDER_LAYOUT[country];
  const checkDigits = iban.slice(2, 4);
  if (!/^\d{0,2}$/.test(checkDigits)) return { kind: 'error', reason: 'characters', country };
  if (iban.length > layout.length) return { kind: 'error', reason: 'too-long', country };

  const codeEnd = layout.codeStart + layout.codeLength;
  if (iban.length < codeEnd) {
    return { kind: 'partial', country, checkDigits, needed: codeEnd };
  }
  const code = iban.slice(layout.codeStart, codeEnd);
  if (!/^\d+$/.test(code)) return { kind: 'error', reason: 'characters', country };

  const checksum = iban.length === layout.length ? (ibanChecksumPasses(iban) ? 'pass' : 'fail') : 'incomplete';
  return { kind: 'code', country, checkDigits, code, checksum, ...lookUp(country, code, registers) };
}

/** `DE89370400440532013000` as `DE89 3704 0044 0532 0130 00`, without Intl. */
export function groupIban(iban: string): string {
  return normaliseIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

/** `{name}` placeholders filled from `vars`; unknown names are left as they are. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
