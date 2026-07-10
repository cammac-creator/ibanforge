import { IBAN_LENGTHS, BBAN_STRUCTURE, COUNTRY_NAMES, getSepaInfo, checkBBANStructure } from './countries.js';
import type { IBANValidationResult } from '../types.js';

/**
 * Format an IBAN with spaces every 4 characters
 */
function formatIBAN(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * ISO 13616 modulo 97 check using BigInt
 * 1. Move first 4 chars to end
 * 2. Replace letters with numbers (A=10, B=11, ..., Z=35)
 * 3. Compute mod 97 — valid if result === 1
 */
function mod97(iban: string): bigint {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numericString = '';
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      numericString += (code - 55).toString();
    } else {
      numericString += char;
    }
  }
  return BigInt(numericString) % 97n;
}

/**
 * Parse BBAN components from the IBAN
 */
function parseBBAN(countryCode: string, bban: string): {
  bank_code: string;
  branch_code?: string;
  account_number: string;
} {
  const structure = BBAN_STRUCTURE[countryCode];
  if (!structure) {
    return { bank_code: '', account_number: bban };
  }

  const bankCode = bban.substring(structure.bankCode[0], structure.bankCode[0] + structure.bankCode[1]);
  const accountNumber = bban.substring(structure.accountNumber[0], structure.accountNumber[0] + structure.accountNumber[1]);

  const result: { bank_code: string; branch_code?: string; account_number: string } = {
    bank_code: bankCode,
    account_number: accountNumber,
  };

  if (structure.branchCode) {
    result.branch_code = bban.substring(structure.branchCode[0], structure.branchCode[0] + structure.branchCode[1]);
  }

  return result;
}

/**
 * Validate an IBAN and return full decomposition
 */
export function validateIBAN(input: string): IBANValidationResult {
  // Step 0 — Reject absurdly long input BEFORE any regex / toUpperCase / BigInt.
  // The longest real IBAN is 33 chars; allow generous room for separators but
  // cap hard so a multi-megabyte string can't burn CPU on the cleanup + mod-97.
  if (typeof input !== 'string' || input.length > 64) {
    return {
      iban: typeof input === 'string' ? input.slice(0, 64) : '',
      valid: false,
      error: 'invalid_format',
      error_detail: 'IBAN is too long to be valid (max 34 characters, separators aside).',
      cost_usdc: 0.005,
    };
  }

  // Step 1 — Clean
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();

  if (!/^[A-Z0-9]+$/.test(cleaned)) {
    return {
      iban: cleaned,
      valid: false,
      error: 'invalid_format',
      error_detail: 'IBAN contains invalid characters. Only letters and digits are allowed.',
      cost_usdc: 0.005,
    };
  }

  if (cleaned.length < 5) {
    return {
      iban: cleaned,
      valid: false,
      error: 'invalid_format',
      error_detail: 'IBAN is too short.',
      cost_usdc: 0.005,
    };
  }

  // Step 2 — Structural validation
  const countryCode = cleaned.substring(0, 2);
  const expectedLength = IBAN_LENGTHS[countryCode];

  if (!expectedLength) {
    return {
      iban: cleaned,
      valid: false,
      error: 'unsupported_country',
      error_detail: `Country code '${countryCode}' is not a recognized IBAN country.`,
      cost_usdc: 0.005,
    };
  }

  if (cleaned.length !== expectedLength) {
    return {
      iban: cleaned,
      valid: false,
      error: 'wrong_length',
      error_detail: `Expected ${expectedLength} characters for ${countryCode}, got ${cleaned.length}.`,
      cost_usdc: 0.005,
    };
  }

  // Step 2b — Check digits must be numeric and inside the ISO 13616 range.
  // The mod-97 algorithm can only produce 02–98; 00, 01 and 99 are explicitly
  // excluded by the standard, yet 00/99 can still slip through a bare mod-97
  // test (e.g. CH99… passes mod 97 = 1). Reject them before the checksum.
  const checkDigits = cleaned.substring(2, 4);
  if (!/^[0-9]{2}$/.test(checkDigits)) {
    return {
      iban: cleaned,
      valid: false,
      error: 'invalid_check_digits',
      error_detail: `Check digits must be 2 digits (ISO 13616), got '${checkDigits}'.`,
      cost_usdc: 0.005,
    };
  }
  if (checkDigits === '00' || checkDigits === '01' || checkDigits === '99') {
    return {
      iban: cleaned,
      valid: false,
      error: 'invalid_check_digits',
      error_detail: `Check digits '${checkDigits}' are outside the valid ISO 13616 range (02–98).`,
      cost_usdc: 0.005,
    };
  }

  // Step 3 — Checksum modulo 97
  const remainder = mod97(cleaned);
  if (remainder !== 1n) {
    return {
      iban: cleaned,
      valid: false,
      error: 'checksum_failed',
      error_detail: `Modulo 97 check returned ${remainder}, expected 1.`,
      cost_usdc: 0.005,
    };
  }

  // Step 3b — BBAN character structure (SWIFT IBAN Registry). A mod-97 pass
  // says nothing about the BBAN layout: DE17ABCDEFGH1234567890 passes mod 97
  // yet has letters inside Germany's all-numeric bank code. Validate the
  // country's registry pattern (precompiled at module load).
  const bban = cleaned.substring(4);
  const bbanCheck = checkBBANStructure(countryCode, bban);
  if (!bbanCheck.ok) {
    return {
      iban: cleaned,
      valid: false,
      error: 'invalid_bban_structure',
      error_detail: bbanCheck.detail,
      cost_usdc: 0.005,
    };
  }

  // Step 4 — Parse components
  const bbanParsed = parseBBAN(countryCode, bban);
  const countryName = COUNTRY_NAMES[countryCode] ?? countryCode;

  return {
    iban: cleaned,
    valid: true,
    country: {
      code: countryCode,
      name: countryName,
    },
    check_digits: checkDigits,
    bban: bbanParsed,
    sepa: getSepaInfo(countryCode),
    formatted: formatIBAN(cleaned),
    cost_usdc: 0.005,
  };
}
