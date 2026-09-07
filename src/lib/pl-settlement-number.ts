/**
 * Poland — the settlement number carries its own check digit.
 *
 * ## What the eight digits are
 *
 * A Polish IBAN (PL + 2 check digits + 24-digit BBAN) opens its BBAN with the
 * eight-digit *numer rozliczeniowy* — the settlement number of the bank unit
 * that keeps the account. It is issued by Narodowy Bank Polski under the
 * ordinance on the numbering of banks and bank accounts (Zarządzenie nr 7/2017
 * Prezesa NBP z dnia 20 lutego 2017 r. w sprawie sposobu numeracji banków i
 * rachunków bankowych, consolidated text of 30/08/2019, amended 03/12/2025) and
 * is built as: three digits naming the bank (the *numer instytucji* the ECB's
 * RIAD list also carries), four digits naming the unit, and one check digit.
 *
 * ## Why this file exists — the contradiction it settles
 *
 * The August 2026 atlas of sources left one Polish question open: the ECB's
 * MFI list identifies a Polish bank by its three-digit institution number,
 * while NBP's EWIB directory carries the full eight-digit settlement number.
 * The IBAN carries the eight digits, so the eight digits are what
 * `bank_code_check` verifies — and until NBP grants the EWIB reuse this API
 * asked for (letter of 26/08/2026, pending), that verification comes from the
 * composite map with `authoritative: false`.
 *
 * What the composite map cannot say is whether the eight digits are even a
 * *possible* settlement number. The check digit can. It is computed over the
 * first seven digits with the weights 3, 9, 7, 1, 3, 9, 7; the digit is the
 * complement of the weighted sum modulo 10. The ordinance text is not
 * machine-readable (NBP's site refuses non-browser clients and the legal
 * database serving it is paywalled), so the algorithm is pinned here by the
 * published settlement numbers it reproduces: 10100000 (NBP itself),
 * 10201026 (PKO BP), 10901014 (Santander Bank Polska, now Erste Bank Polska),
 * 11402004 (mBank) — see the test file.
 *
 * ## What the verdict means, and what it does not
 *
 * `valid: false` means the eight digits cannot have been issued by NBP: a typo
 * or a fabricated number, whatever the composite map says. It is served as a
 * separate `check_digit` block, never as `not_allocated`: that reason is
 * reserved for an authoritative register denying a code, and a structural
 * impossibility is a different fact from a register's silence. `valid: true`
 * says only that the number is well-formed; existence is still the map's
 * question, with its own `authoritative` flag.
 */

/** Weights over the first seven digits, in the ordinance's order. */
export const PL_SETTLEMENT_WEIGHTS = [3, 9, 7, 1, 3, 9, 7] as const;

/** The string served in `bank_code_check.check_digit.algorithm`. */
export const PL_SETTLEMENT_ALGORITHM =
  'NBP settlement-number check digit: weighted sum of the first seven digits (weights 3,9,7,1,3,9,7), complement modulo 10';

export interface SettlementCheckDigit {
  /** True when the eighth digit is the one the algorithm produces. */
  valid: boolean;
  /** Which rule decided — served so a caller can cite it, never guess it. */
  algorithm: string;
}

/**
 * The check digit an eight-digit settlement number should end with, or null
 * when the input is not eight digits (then there is nothing to check).
 */
export function expectedPolishCheckDigit(code: string): string | null {
  if (!/^\d{8}$/.test(code)) return null;
  let sum = 0;
  for (let i = 0; i < PL_SETTLEMENT_WEIGHTS.length; i++) {
    sum += PL_SETTLEMENT_WEIGHTS[i] * Number(code[i]);
  }
  return String((10 - (sum % 10)) % 10);
}

/** The verdict on an eight-digit settlement number, or null when it is not one. */
export function polishSettlementCheckDigit(code: string): SettlementCheckDigit | null {
  const expected = expectedPolishCheckDigit(code);
  if (expected === null) return null;
  return { valid: expected === code[7], algorithm: PL_SETTLEMENT_ALGORITHM };
}
