/**
 * Build unified bic_data.json from multiple sources.
 * Run: npx tsx scripts/build-bic-data.ts
 *
 * Sources:
 * - sigalor/iban-to-bic (DE, AT, FR, NL, BE, ES, LU)
 * - Manual additions for CH, GB, IT, PT, PL, IE
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/db/bic_data.json');

interface BICEntry {
  bic: string;
  bank_name?: string;
  city?: string;
}

const result: Record<string, BICEntry> = {};

// Download from sigalor/iban-to-bic
const COUNTRIES = ['de', 'at', 'fr', 'nl', 'be', 'es', 'lu'];
const BASE_URL = 'https://raw.githubusercontent.com/sigalor/iban-to-bic/main/datasets';

for (const country of COUNTRIES) {
  const tmpFile = `/tmp/bic_${country}.json`;
  if (!existsSync(tmpFile)) {
    console.log(`Downloading ${country}...`);
    execSync(`curl -sL "${BASE_URL}/${country}.json" -o ${tmpFile}`);
  }
  const data: Record<string, string> = JSON.parse(readFileSync(tmpFile, 'utf-8'));
  const cc = country.toUpperCase();
  let count = 0;
  for (const [bankCode, bic] of Object.entries(data)) {
    result[`${cc}:${bankCode}`] = { bic };
    count++;
  }
  console.log(`  ${cc}: ${count} entries`);
}

// Swiss banks — from SIX Bank Master API (official, public, updated daily)
const SIX_CSV_URL = 'https://api.six-group.com/api/epcd/bankmaster/v3/bankmaster_V3.csv';
const sixTmpFile = '/tmp/six_bankmaster.csv';
if (!existsSync(sixTmpFile)) {
  console.log('  Downloading SIX Bank Master...');
  execSync(`curl -sL "${SIX_CSV_URL}" -o ${sixTmpFile}`);
}
const sixCsv = readFileSync(sixTmpFile, 'utf-8');
const sixLines = sixCsv.split(/\r?\n/).filter(l => l.trim());
let chCount = 0;
// Header: IID/QR-IID;Valid on;Concatenation;New IID/QR-IID;SIC IID;Headquarters;IID type;QR-IID allocation;Name of bank/institution;Street Name;Building Number;Post Code;Town Name;Country;BIC;...
for (let i = 1; i < sixLines.length; i++) {
  const cols = sixLines[i].split(';');
  const iid = cols[0]?.trim();
  const bankName = cols[8]?.trim();
  const city = cols[12]?.trim();
  const bic = cols[14]?.trim();
  if (iid && bic && bic.length >= 8) {
    // Pad IID to 5 digits (Swiss IBAN bank code is 5 digits)
    const paddedIID = iid.padStart(5, '0');
    result[`CH:${paddedIID}`] = { bic, bank_name: bankName || undefined, city: city || undefined };
    chCount++;
  }
}
console.log(`  CH: ${chCount} entries (SIX Bank Master)`);

// UK banks (sort codes → BIC, major banks)
const GB_BANKS: Record<string, BICEntry> = {
  'NWBK': { bic: 'NWBKGB2L', bank_name: 'NatWest', city: 'London' },
  'BARC': { bic: 'BARCGB22', bank_name: 'Barclays Bank', city: 'London' },
  'MIDL': { bic: 'MIDLGB22', bank_name: 'HSBC UK Bank', city: 'London' },
  'LOYD': { bic: 'LOYDGB21', bank_name: 'Lloyds Bank', city: 'London' },
  'BUKB': { bic: 'BUKBGB22', bank_name: 'Bank of Scotland', city: 'Edinburgh' },
  'HBUK': { bic: 'HBUKGB4B', bank_name: 'HSBC Bank', city: 'London' },
  'ABBY': { bic: 'ABBYGB2L', bank_name: 'Santander UK', city: 'London' },
  'HLFX': { bic: 'HLFXGB21', bank_name: 'Halifax', city: 'Halifax' },
  'CLYD': { bic: 'CLYDGB2S', bank_name: 'Clydesdale Bank', city: 'Glasgow' },
  'BOFS': { bic: 'BOFSGB21', bank_name: 'Bank of Scotland', city: 'Edinburgh' },
  'TSBS': { bic: 'TSBSGB2A', bank_name: 'TSB Bank', city: 'London' },
  'CPBK': { bic: 'CPBKGB22', bank_name: 'The Co-operative Bank', city: 'Manchester' },
  'ULSB': { bic: 'ULSBGB2B', bank_name: 'Ulster Bank', city: 'Belfast' },
  'RBOS': { bic: 'RBOSGB2L', bank_name: 'Royal Bank of Scotland', city: 'Edinburgh' },
  'SWED': { bic: 'SWEDGB2L', bank_name: 'Swedbank', city: 'London' },
  'REVO': { bic: 'REVOGB21', bank_name: 'Revolut', city: 'London' },
  'TRWI': { bic: 'TRWIGB22', bank_name: 'Wise (TransferWise)', city: 'London' },
  'MONZ': { bic: 'MONZGB2L', bank_name: 'Monzo Bank', city: 'London' },
};

for (const [bankCode, entry] of Object.entries(GB_BANKS)) {
  result[`GB:${bankCode}`] = entry;
}
console.log(`  GB: ${Object.keys(GB_BANKS).length} entries (manual)`);

// Italian banks (major ones)
const IT_BANKS: Record<string, BICEntry> = {
  '03069': { bic: 'BCITITMM', bank_name: 'Intesa Sanpaolo', city: 'Milano' },
  '02008': { bic: 'UNCRITMM', bank_name: 'UniCredit', city: 'Milano' },
  '05034': { bic: 'BAPPIT21', bank_name: 'Banca Popolare di Milano', city: 'Milano' },
  '03268': { bic: 'SARDIT2S', bank_name: 'Banca Monte dei Paschi di Siena', city: 'Siena' },
  '01005': { bic: 'ABORIT2TXXX', bank_name: 'Banca Nazionale del Lavoro', city: 'Roma' },
  '03111': { bic: 'BNCAIT2GXXX', bank_name: 'Banca Carige', city: 'Genova' },
  '03015': { bic: 'POCRIT3RXXX', bank_name: 'Banco BPM', city: 'Milano' },
};

for (const [bankCode, entry] of Object.entries(IT_BANKS)) {
  result[`IT:${bankCode}`] = entry;
}
console.log(`  IT: ${Object.keys(IT_BANKS).length} entries (manual)`);

// Vatican (VA) — single bank (IOR)
result['VA:001'] = { bic: 'IOPRVAVX', bank_name: 'Istituto per le Opere di Religione (IOR)', city: 'Vatican City' };
console.log('  VA: 1 entry (IOR)');

// Kosovo (XK) — 2-digit bank codes assigned by CBK
const XK_BANKS: Record<string, BICEntry> = {
  '10': { bic: 'CBRKXKPR', bank_name: 'Central Bank of the Republic of Kosovo', city: 'Pristina' },
  '11': { bic: 'MBKOXKPR', bank_name: 'ProCredit Bank', city: 'Pristina' },
  '13': { bic: 'BPBXXKPR', bank_name: 'Banka per Biznes', city: 'Pristina' },
  '14': { bic: 'EKOMXKPR', bank_name: 'Banka Ekonomike', city: 'Pristina' },
  '15': { bic: 'RBKOXKPR', bank_name: 'Raiffeisen Bank Kosovo', city: 'Pristina' },
  '17': { bic: 'NLPRXKPR', bank_name: 'NLB Banka', city: 'Pristina' },
  '19': { bic: 'NCBAXKPR', bank_name: 'Banka Kombetare Tregtare (BKT)', city: 'Pristina' },
  '20': { bic: 'TEBKXKPR', bank_name: 'TEB SH.A.', city: 'Pristina' },
  '21': { bic: 'TCZBXKPR', bank_name: 'Ziraat Bankasi', city: 'Pristina' },
  '22': { bic: 'ISBKXKPR', bank_name: 'Turkiye Is Bankasi', city: 'Pristina' },
  '23': { bic: 'PHHAXKPR', bank_name: 'PriBank', city: 'Pristina' },
  '25': { bic: 'CDISXKPR', bank_name: 'Banka Credins Kosove', city: 'Pristina' },
  '50': { bic: 'PAYKXKP2', bank_name: 'Paysera Kosovo', city: 'Pristina' },
};
for (const [bankCode, entry] of Object.entries(XK_BANKS)) {
  result[`XK:${bankCode}`] = entry;
}
console.log(`  XK: ${Object.keys(XK_BANKS).length} entries (CBK registry)`);

// Faroe Islands (FO) — 4-digit bank codes (Danish-style clearing codes)
const FO_BANKS: Record<string, BICEntry> = {
  '6460': { bic: 'FIFBFOTX', bank_name: 'Foroya Banki (BankNordik)', city: 'Torshavn' },
  '6664': { bic: 'EIKBFOTF', bank_name: 'Betri Banki', city: 'Torshavn' },
  '6570': { bic: 'NOYAFO21', bank_name: 'Nordoya Sparikassi', city: 'Klaksvik' },
  '9870': { bic: 'SUSPFOT1', bank_name: 'Suduroyar Sparikassi', city: 'Vagur' },
};
for (const [bankCode, entry] of Object.entries(FO_BANKS)) {
  result[`FO:${bankCode}`] = entry;
}
console.log(`  FO: ${Object.keys(FO_BANKS).length} entries (manual)`);

// Greenland (GL) — 4-digit bank codes (Danish-style clearing codes)
const GL_BANKS: Record<string, BICEntry> = {
  '6460': { bic: 'FIFBFOTX', bank_name: 'Foroya Banki (Bankivik)', city: 'Nuuk' },
  '1601': { bic: 'GRENGLGX', bank_name: 'Gronlandsbanken', city: 'Nuuk' },
};
for (const [bankCode, entry] of Object.entries(GL_BANKS)) {
  result[`GL:${bankCode}`] = entry;
}
console.log(`  GL: ${Object.keys(GL_BANKS).length} entries (manual)`);

// São Tomé e Príncipe (ST) — 4-digit bank codes
const ST_BANKS: Record<string, BICEntry> = {
  '0001': { bic: 'INOISTST', bank_name: 'Banco Internacional de Sao Tome e Principe (BISTP)', city: 'Sao Tome' },
  '0002': { bic: 'CSTPSTST', bank_name: 'Banco Central de Sao Tome e Principe', city: 'Sao Tome' },
  '0003': { bic: 'ECOCSTST', bank_name: 'Ecobank Sao Tome', city: 'Sao Tome' },
  '0004': { bic: 'BGFISTST', bank_name: 'BGFIBank Sao Tome et Principe', city: 'Sao Tome' },
  '0005': { bic: 'AFFSSTST', bank_name: 'Afriland First Bank STP', city: 'Sao Tome' },
  '0006': { bic: 'ESTPSTST', bank_name: 'Energy Bank Sao Tome e Principe', city: 'Sao Tome' },
  '0007': { bic: 'CBSTSTST', bank_name: 'Commercial Bank Sao Tome e Principe', city: 'Sao Tome' },
  '0008': { bic: 'ISLNSTST', bank_name: 'Island Bank S.A.', city: 'Sao Tome' },
  '0009': { bic: 'BNSTSTS1', bank_name: 'Banco Nacional de Sao Tome e Principe', city: 'Sao Tome' },
  '0010': { bic: 'EQSRSTST', bank_name: 'Banco Equador SARL', city: 'Sao Tome' },
};
for (const [bankCode, entry] of Object.entries(ST_BANKS)) {
  result[`ST:${bankCode}`] = entry;
}
console.log(`  ST: ${Object.keys(ST_BANKS).length} entries (manual)`);

// Write output
writeFileSync(OUTPUT, JSON.stringify(result, null, 0));
const entries = Object.keys(result).length;
console.log(`\nTotal: ${entries} entries written to ${OUTPUT}`);
