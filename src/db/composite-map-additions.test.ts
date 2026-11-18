/**
 * The composite map after rank 4 of the « données fraîches » ranking (18 November 2026,
 * evening): bank codes asked for without an answer, and the Swedish list read in full.
 *
 * Every key below comes from a source this repository may carry
 * (docs/data-sources.md, « 18/11/2026 (soir) »):
 *
 *   - SWEDEN: the list of clearing numbers and IBAN IDs of Bankinfrastruktur i Sverige
 *     AB (read on 6 November 2026), the source of every `SE:` key. Ten IBAN IDs the
 *     map lacked are added with the BIC the list gives; five keys whose BIC differed
 *     from the list now carry the list's (for four of them GLEIF lists that BIC for
 *     the same institution). Two keys stay as they were: `SE:930`, absent from
 *     a list that does not call itself complete, and `SE:958`, kept by the control of
 *     the same day (the list names a bank for it but gives no BIC).
 *   - DENMARK: Lunar (6695) and Banking Circle (8900), absent from the operator's
 *     partial list, from schwifty's `manual_dk` (MIT); both BICs are listed by GLEIF
 *     and by the Bundesbank's directory of reachable payment service providers.
 *   - FRANCE: Deblock (17748), from schwifty's `manual_fr` (MIT); the ECB list of
 *     monetary financial institutions gives this code to Deblock, and the ECB's TIPS
 *     participant list and the Bundesbank directory give Deblock SAS this BIC.
 *
 * Where the directory does not know the BIC, the key carries the name the source
 * writes, so that the answer names the bank. The answers are probed on numeric codes,
 * where no BIC prefix can stand in for the key.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enrichResult } from '../lib/enrich.js';
import { validateIBAN } from '../lib/iban.js';

const here = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(resolve(here, 'bic_data.json'), 'utf8')) as Record<
  string,
  { bic: string; bank_name?: string }
>;

const ADDED: Record<string, { bic: string; bank_name?: string }> = {
  'SE:211': { bic: 'JUNTSEGGXXX' },
  // Steven AB: the list gives SVVVSESS for clearing numbers 2120 to 2126 and one
  // other BIC for each of 2127, 2128 and 2129. One key per IBAN ID holds one BIC:
  // the one GLEIF lists for Steven AB's LEI, which covers the main range.
  'SE:212': { bic: 'SVVVSESSXXX' },
  'SE:213': { bic: 'ZIMPSES2XXX' },
  'SE:214': { bic: 'TRLYSESSXXX' },
  'SE:215': { bic: 'REVOSESSXXX' },
  'SE:217': { bic: 'PPPVLUL2XXX' },
  'SE:218': { bic: 'STTOIE22XXX' },
  'SE:918': { bic: 'DABASESXXXX' },
  'SE:960': { bic: 'BCIRSE22XXX' },
  'SE:971': { bic: 'LUNADK2BXXX', bank_name: 'Lunar Bank' },
  'DK:6695': { bic: 'LUNADK22XXX' },
  'DK:8900': { bic: 'SXPYDKKKXXX' },
  'FR:17748': { bic: 'DBLKFR22XXX', bank_name: 'Deblock SAS' },
};

/** The Swedish keys whose BIC the list contradicted, with the BIC they carried. */
const CORRECTED: Record<string, { was: string; now: { bic: string; bank_name?: string } }> = {
  'SE:910': { was: 'NNSESES1XXX', now: { bic: 'NNSESE22XXX' } },
  'SE:928': { was: 'RESUSE21XXX', now: { bic: 'RESUSE2HXXX', bank_name: 'Resurs Bank AB' } },
  'SE:955': { was: 'AVANSES1XXX', now: { bic: 'AVANSESXXXX' } },
  'SE:966': { was: 'SVEASES1XXX', now: { bic: 'SVEASESSXXX' } },
  'SE:970': { was: 'EKMLSE21XXX', now: { bic: 'EKMLSE2SXXX' } },
};

/**
 * Every IBAN ID of the Swedish list that gives a BIC, with that BIC8 (Steven AB's
 * 212 at its main range). Two IDs of the list give none (216 and 958).
 */
const SWEDISH_LIST: Record<string, string> = {
  '120': 'DABASESX',
  '211': 'JUNTSEGG',
  '212': 'SVVVSESS',
  '213': 'ZIMPSES2',
  '214': 'TRLYSESS',
  '215': 'REVOSESS',
  '217': 'PPPVLUL2',
  '218': 'STTOIE22',
  '230': 'AABASESS',
  '300': 'NDEASESS',
  '500': 'ESSESESS',
  '600': 'HANDSESS',
  '800': 'SWEDSESS',
  '902': 'ELLFSESS',
  '904': 'CITISESX',
  '907': 'FEMAMTMT',
  '910': 'NNSESE22',
  '915': 'SKIASESS',
  '917': 'IKANSE21',
  '918': 'DABASESX',
  '919': 'DNBASESX',
  '923': 'MARGSESS',
  '925': 'SBAVSESS',
  '927': 'IBCASES1',
  '928': 'RESUSE2H',
  '939': 'LAHYSESS',
  '940': 'FORXSES1',
  '946': 'BSNOSESS',
  '947': 'FTSBSESS',
  '950': 'NDEASESS',
  '955': 'AVANSESX',
  '957': 'SPSDSE23',
  '959': 'ERPFSES2',
  '960': 'BCIRSE22',
  '963': 'LOSADKKK',
  '964': 'NOFBSESS',
  '965': 'MEMMSE21',
  '966': 'SVEASESS',
  '967': 'JAKMSE22',
  '968': 'BSTPSESS',
  '970': 'EKMLSE2S',
  '971': 'LUNADK2B',
  '975': 'NOHLSESS',
  '978': 'KLRNSESS',
};

/** An IBAN of `country` over `bban`, with its two check digits computed (mod 97). */
function ibanOver(country: string, bban: string): string {
  const digits = `${bban}${country}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const check = 98n - (BigInt(digits) % 97n);
  return `${country}${check.toString().padStart(2, '0')}${bban}`;
}

function enriched(iban: string) {
  const result = validateIBAN(iban);
  expect(result.valid, iban).toBe(true);
  enrichResult(result);
  return result;
}

describe('composite map, additions and Swedish corrections of 18 November 2026 (evening)', () => {
  it('carries the added keys with the BIC, and the name where the directory lacks it', () => {
    const wrong = Object.entries(ADDED).filter(
      ([key, entry]) => JSON.stringify(map[key]) !== JSON.stringify(entry),
    );
    expect(wrong).toEqual([]);
  });

  it('carries the BIC of the Swedish list on the keys it contradicted', () => {
    const wrong = Object.entries(CORRECTED).filter(
      ([key, { now }]) => JSON.stringify(map[key]) !== JSON.stringify(now),
    );
    expect(wrong).toEqual([]);
  });

  it('agrees with the Swedish list on every IBAN ID the list gives a BIC for', () => {
    const disagree = Object.entries(SWEDISH_LIST).filter(
      ([code, bic8]) => map[`SE:${code}`]?.bic.slice(0, 8) !== bic8,
    );
    expect(disagree).toEqual([]);
  });

  it('keeps the two Swedish keys the list cannot settle', () => {
    // 930: absent from a list that says it is « updated and supplemented continuously »,
    // not that it is complete. 958: kept by the control of the same day.
    expect(map['SE:930']?.bic).toBe('SWEDSESSXXX');
    expect(map['SE:958']?.bic).toBe('BMPBSESSXXX');
  });

  it('names Lunar for the Swedish IBAN ID 971, with the credit Bankinfrastruktur asks for', () => {
    const r = enriched(ibanOver('SE', `971${'0'.repeat(6)}9710${'1234567'}`));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_holder).toBe('inferred');
    expect(r.bic?.code).toBe('LUNADK2BXXX');
    expect(r.bic?.bank_name).toBe('Lunar Bank');
    expect(r.bic?.basis).toBe('curated_map');
    expect(r.bic?.source).toMatch(
      /Source: Bankinfrastruktur i Sverige AB, which does not guarantee/,
    );
  });

  it('names Deblock for the French bank code 17748', () => {
    // FR: 5 digits of bank, 5 of branch, 11 of account, 2 of RIB key (computed).
    const bank = '17748';
    const branch = '00001';
    const account = '00012345678';
    const key =
      97 - Number((89n * BigInt(bank) + 15n * BigInt(branch) + 3n * BigInt(account)) % 97n);
    const r = enriched(ibanOver('FR', `${bank}${branch}${account}${String(key).padStart(2, '0')}`));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bic?.code).toBe('DBLKFR22XXX');
    expect(r.bic?.bank_name).toBe('Deblock SAS');
    expect(r.bic?.basis).toBe('curated_map');
  });
});
