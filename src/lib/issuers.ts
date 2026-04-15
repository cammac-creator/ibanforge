/**
 * IBANforge — Issuer classification for vIBAN detection
 *
 * Maps known BIC8 codes to issuer types. Helps agents identify
 * whether an IBAN belongs to a traditional bank or a digital/EMI issuer
 * (higher likelihood of virtual IBANs).
 *
 * 84+ entries — sources: EBA register, GLEIF, national EMI registers,
 * public BIC directories (Wise, bank.codes, theswiftcodes).
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
  BUNQNL2A: { type: 'digital_bank', name: 'bunq' },             // NL
  LUALDK22: { type: 'digital_bank', name: 'Lunar' },             // DK
  MEMOFRP2: { type: 'digital_bank', name: 'Memo Bank' },         // FR
  MONZGB2L: { type: 'digital_bank', name: 'Monzo' },             // GB
  NTSBDEB1: { type: 'digital_bank', name: 'N26' },               // DE
  PLEODKK2: { type: 'digital_bank', name: 'Pleo' },              // DK
  QNTOFRP1: { type: 'digital_bank', name: 'Qonto' },             // FR
  REVOGB2L: { type: 'digital_bank', name: 'Revolut' },           // GB
  REVOLT21: { type: 'digital_bank', name: 'Revolut' },           // LT
  RVUALT2V: { type: 'digital_bank', name: 'Revolut Bank UAB' },  // LT
  SRLGGB2L: { type: 'digital_bank', name: 'Starling Bank' },     // GB
  TIPLGB22: { type: 'digital_bank', name: 'Tide' },              // GB

  // --- EMIs (Electronic Money Institutions) ---
  ADWSGB22: { type: 'emi', name: 'Monevium' },                   // GB
  ADYBNL2A: { type: 'emi', name: 'Adyen' },                      // NL
  AINHNL22: { type: 'emi', name: 'Airwallex' },                   // NL
  AIRWGB22: { type: 'emi', name: 'Airwallex' },                   // GB
  BAXXLT22: { type: 'emi', name: 'Finci' },                       // LT
  BCIRLULL: { type: 'emi', name: 'Banking Circle' },              // LU
  BIPGATWW: { type: 'emi', name: 'Bitpanda' },                    // AT
  BIYSGB2L: { type: 'emi', name: 'Bilderlings Pay' },             // GB
  BZENLT22: { type: 'emi', name: 'Zen.com' },                     // LT
  CARDCY2L: { type: 'emi', name: 'Unlimint' },                    // CY
  CARDDEFF: { type: 'emi', name: 'Unlimint' },                    // DE
  CFTEMTM1: { type: 'emi', name: 'OpenPayd' },                    // MT
  CLRBGB22: { type: 'emi', name: 'ClearBank' },                   // GB
  CNFVGB21: { type: 'emi', name: 'Contis Financial' },            // GB
  CNUALT21: { type: 'emi', name: 'ConnectPay' },                  // LT
  CURUNL21: { type: 'emi', name: 'Currencycloud' },               // NL
  DYPYGB3L: { type: 'emi', name: 'MultiPass' },                   // GB
  EBPBBEBB: { type: 'emi', name: 'Ebury Partners' },              // BE
  EBURGB2L: { type: 'emi', name: 'Ebury Partners' },              // GB
  EVIULT2V: { type: 'emi', name: 'Paysera' },                     // LT
  FNOMDEB2: { type: 'emi', name: 'Finom Payments' },              // DE
  FNOMNL22: { type: 'emi', name: 'Finom Payments' },              // NL
  FNOMFRP2: { type: 'emi', name: 'Finom Payments' },              // FR
  JOEULUL2: { type: 'emi', name: 'Vivid Money' },                 // LU
  LEWAFRPP: { type: 'emi', name: 'Lemonway' },                    // FR
  LYDIFRP2: { type: 'emi', name: 'Lydia Solutions' },             // FR
  MAGYLUL1: { type: 'emi', name: 'Mangopay' },                    // LU
  MIEGLT21: { type: 'emi', name: 'Satchel (Secure Nordic Payments)' }, // LT
  MLLENL2A: { type: 'emi', name: 'Mollie' },                      // NL
  MNEEBEB2: { type: 'emi', name: 'Monese EU SA' },                // BE
  MNEEGB21: { type: 'emi', name: 'Monese' },                      // GB
  MNNELT21: { type: 'emi', name: 'Genome' },                      // LT
  NARYFIH2: { type: 'emi', name: 'Narvi Payments' },              // FI
  NETEGB21: { type: 'emi', name: 'Paysafe Financial' },           // GB
  PATCBGSF: { type: 'emi', name: 'Paynetics' },                   // BG
  PAYNIE22: { type: 'emi', name: 'Payoneer Europe' },              // IE
  PPSEIE22: { type: 'emi', name: 'Paysafe Prepaid' },             // IE
  PYSEGB22: { type: 'emi', name: 'Payset' },                      // GB
  SAEYGB2L: { type: 'emi', name: 'SafeNetPay' },                  // GB
  SAPYGB2L: { type: 'emi', name: 'Banking Circle' },              // GB
  SFSNIE22: { type: 'emi', name: 'Soldo' },                       // IE
  SOAVGB21: { type: 'emi', name: 'Soldo' },                       // GB
  SUMUIE22: { type: 'emi', name: 'SumUp' },                       // IE
  SUPULT22: { type: 'emi', name: 'SumUp EU Payments' },           // LT
  SWNBFR22: { type: 'emi', name: 'Swan' },                        // FR
  SXPYDEHH: { type: 'emi', name: 'Banking Circle' },              // DE
  TCCLGB3L: { type: 'emi', name: 'Currencycloud' },               // GB
  TPMLMTMT: { type: 'emi', name: 'TransactPay' },                 // MT
  TRYAGIG2: { type: 'emi', name: 'TransactPay' },                 // GI
  TRZOFR21: { type: 'emi', name: 'Treezor' },                     // FR
  TRWIBEB1: { type: 'emi', name: 'Wise' },                        // BE
  TRWIGB2L: { type: 'emi', name: 'Wise' },                        // GB
  UAPELT22: { type: 'emi', name: 'Pervesk' },                     // LT
  UAPPLT21: { type: 'emi', name: 'Ibanera' },                     // LT
  UFPOLT21: { type: 'emi', name: 'Contis Financial' },            // LT
  USPELT2V: { type: 'emi', name: 'Nuvei' },                       // LT
  VEPALT21: { type: 'emi', name: 'Verifo' },                      // LT
  VPAYGRAA: { type: 'emi', name: 'Viva Wallet' },                 // GR
  VVIDLUL2: { type: 'emi', name: 'Vivid Money' },                 // LU
  WFSTGB2L: { type: 'emi', name: 'WorldFirst' },                  // GB

  // --- Payment institutions / BaaS ---
  CPAYIE2D: { type: 'payment_institution', name: 'Fire Financial Services' }, // IE
  EUEBLT22: { type: 'payment_institution', name: 'European Merchant Bank' }, // LT
  GOCRGB22: { type: 'payment_institution', name: 'GoCardless' },  // GB
  LHVBEE22: { type: 'payment_institution', name: 'LHV Bank' },    // EE
  MODRGB21: { type: 'payment_institution', name: 'Modulr FS' },   // GB
  MODRIE22: { type: 'payment_institution', name: 'Modulr Finance' }, // IE
  OFPIIE22: { type: 'payment_institution', name: 'OFX Payments Ireland' }, // IE
  PRTCGB21: { type: 'payment_institution', name: 'Prepay Technologies' }, // GB
  SOBKDEB2: { type: 'payment_institution', name: 'Solarisbank' }, // DE
  STPUIE21: { type: 'payment_institution', name: 'Stripe Payments Europe' }, // IE
  STTOIE22: { type: 'payment_institution', name: 'Stripe Technology Europe' }, // IE
  TRYEGB22: { type: 'payment_institution', name: 'TrueLayer' },   // GB
  YOUIFRPP: { type: 'payment_institution', name: 'Younited' },    // FR
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
