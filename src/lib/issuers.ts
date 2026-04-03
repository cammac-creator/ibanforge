/**
 * IBANforge — Issuer classification for vIBAN detection
 *
 * Maps known BIC8 codes to issuer types. Helps agents identify
 * whether an IBAN belongs to a traditional bank or a digital/EMI issuer
 * (higher likelihood of virtual IBANs).
 */

export type IssuerType = 'bank' | 'digital_bank' | 'emi' | 'payment_institution';

interface IssuerEntry {
  type: IssuerType;
  name: string;
}

/**
 * Known digital banks and EMIs by BIC8 code.
 * Sources: EBA register, national EMI registers, public BIC directories.
 * This list is not exhaustive — unlisted BICs default to 'bank'.
 */
const KNOWN_ISSUERS: Record<string, IssuerEntry> = {
  // --- Digital banks (full or restricted banking license, digital-only) ---
  REVOLT21: { type: 'digital_bank', name: 'Revolut' },          // LT
  REVOGB21: { type: 'digital_bank', name: 'Revolut' },          // GB
  RABORL2X: { type: 'digital_bank', name: 'Revolut' },          // LT (alt)
  NTSBDEB1: { type: 'digital_bank', name: 'N26' },              // DE
  MONZGB2L: { type: 'digital_bank', name: 'Monzo' },            // GB
  SRLGGB2L: { type: 'digital_bank', name: 'Starling Bank' },    // GB
  BUNQNL2A: { type: 'digital_bank', name: 'bunq' },             // NL
  QNTOFRP1: { type: 'digital_bank', name: 'Qonto' },            // FR
  LUALDK22: { type: 'digital_bank', name: 'Lunar' },            // DK
  TOBADED1: { type: 'digital_bank', name: 'Tomorrow Bank' },    // DE
  FABORL2X: { type: 'digital_bank', name: 'Finom' },            // LT

  // --- EMIs (Electronic Money Institutions) ---
  TRWIBEB1: { type: 'emi', name: 'Wise' },                      // BE
  TRWIGB2L: { type: 'emi', name: 'Wise' },                      // GB
  ADYBNL2A: { type: 'emi', name: 'Adyen' },                     // NL
  EABORL2X: { type: 'emi', name: 'Paysera' },                   // LT
  MIEGLT21: { type: 'emi', name: 'Satchel (Mister Tango)' },    // LT
  TRZOFR21: { type: 'emi', name: 'Treezor' },                   // FR
  CBNOLT2X: { type: 'emi', name: 'ConnectPay' },                // LT
  MANOLT22: { type: 'emi', name: 'Mangopay' },                  // LT
  PPAYIE2D: { type: 'emi', name: 'Prepay Solutions' },          // IE
  MOLOIE22: { type: 'emi', name: 'Modulr' },                    // IE
  BARCNL22: { type: 'emi', name: 'Banking Circle' },            // NL
  SUMSLT21: { type: 'emi', name: 'SumUp' },                     // LT
  CLRBGB22: { type: 'emi', name: 'ClearBank' },                 // GB

  // --- Payment institutions / BaaS ---
  SOBKDEB2: { type: 'payment_institution', name: 'Solarisbank' },   // DE (BaaS)
  LHVBEE22: { type: 'payment_institution', name: 'LHV Bank' },      // EE (BaaS for fintechs)
  SUGBIE22: { type: 'payment_institution', name: 'Stripe' },        // IE
  STPKIE21: { type: 'payment_institution', name: 'Stripe' },        // IE (alt)
  CPAYIE2D: { type: 'payment_institution', name: 'Checkout.com' },  // IE
  RABORL22: { type: 'payment_institution', name: 'Railsr' },        // LT
  SWOIFRPP: { type: 'payment_institution', name: 'Swan' },          // FR (BaaS)
};

export interface IssuerInfo {
  type: IssuerType;
  name: string;
}

/**
 * Classify an institution by its BIC8 code.
 * Returns null if BIC is unknown (caller should default to 'bank').
 */
export function classifyIssuer(bic8: string): IssuerInfo | null {
  const normalized = bic8.toUpperCase().substring(0, 8);
  const entry = KNOWN_ISSUERS[normalized];
  return entry ?? null;
}
