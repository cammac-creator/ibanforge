/**
 * The control of the composite bank-code map of 18 November 2026.
 *
 * The keys of `bic_data.json` whose BIC8 no source of the BIC directory knows were
 * confronted, one by one, with a first-hand source (docs/data-sources.md, « Clés
 * confrontées le 18/11/2026 »). The outcomes are pinned here so that a
 * reconstruction of the file, or a hand edit, does not bring the wrong answers back:
 *
 *   - REMOVED: the BIC belonged to an entity GLEIF gives as inactive or to a company
 *     whose business is not keeping accounts; or the key came from the unsourced
 *     batch of April 2026 with a BIC nobody publishes; or a first-hand source speaks
 *     against it (a code withdrawn from its national list, a BIC listed under
 *     another code, banks absent from the central bank's register);
 *   - CORRECTED: the code names the right institution, but the BIC served did not
 *     exist; the key now carries the BIC that a first-hand source gives;
 *   - no French key may carry the stem `AGRIFRCC`, which no source has ever listed.
 *
 * The lists read the map only, and the answer is probed on a numeric code, where no
 * BIC prefix can stand in for the key: the file stays green when the monthly robot
 * refreshes the BIC directory.
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
  { bic: string }
>;

const REMOVED = [
  'AL:020',
  'AL:054',
  'AL:080',
  'AL:082',
  'AL:090',
  'AL:160',
  'BR:01181521',
  'BR:33042953',
  'BR:33466988',
  'BR:60498557',
  'BR:60872504',
  'BR:92702067',
  'CH:31100',
  'CH:83036',
  'DE:51410600',
  'EG:0003',
  'EG:0006',
  'EG:0020',
  'EG:0031',
  'EG:0033',
  'EG:0034',
  'EG:0036',
  'EG:0037',
  'EG:0038',
  'EG:0039',
  'ES:A79192258',
  'FR:17806',
  'GB:ACRN',
  'GB:AEMS',
  'GB:GFGT',
  'GB:GSPP',
  'GB:KIIA',
  'GB:MNNS',
  'GB:OACK',
  'GB:PRXP',
  'GB:REMT',
  'GB:SILO',
  'GB:STFV',
  'GB:SYNC',
  'KW:KFDC',
  'LT:30500',
  'MT:RMMN',
  'NL:CWIS',
  'NL:PYYE',
  'ST:0007',
  'ST:0008',
  'ST:0010',
  'TN:16',
  'TN:81',
  'TN:86',
  'UA:300001',
  'UA:300023',
  'UA:305750',
  'UA:313849',
  'UA:322498',
  'UA:336615',
  'UA:380805',
  'XK:25',
];

const CORRECTED: Record<string, string> = {
  'DE:50127700': 'PAYODEF2XXX',
  'FR:10206': 'AGRIFRPP802',
  'FR:10278': 'CMCIFR2AXXX',
  'FR:11006': 'AGRIFRPP810',
  'FR:11206': 'AGRIFRPP812',
  'FR:11306': 'AGRIFRPP813',
  'FR:11438': 'HRFRFRP1XXX',
  'FR:11706': 'AGRIFRPP817',
  'FR:12006': 'AGRIFRPP820',
  'FR:12206': 'AGRIFRPP822',
  'FR:12406': 'AGRIFRPP824',
  'FR:12448': 'BARCMCMXXXX',
  'FR:12506': 'AGRIFRPP825',
  'FR:12906': 'AGRIFRPP829',
  'FR:13106': 'AGRIFRPP831',
  'FR:13306': 'AGRIFRPP833',
  'FR:13506': 'AGRIFRPP835',
  'FR:13606': 'AGRIFRPP836',
  'FR:13906': 'AGRIFRPP839',
  'FR:14406': 'AGRIFRPP844',
  'FR:14506': 'AGRIFRPP845',
  'FR:14690': 'CMCIFRP1MON',
  'FR:14706': 'AGRIFRPP847',
  'FR:14806': 'AGRIFRPP848',
  'FR:14940': 'CFFIFR21XXX',
  'FR:15448': 'CNFSFR21XXX',
  'FR:16006': 'AGRIFRPP860',
  'FR:16106': 'AGRIFRPP861',
  'FR:16218': 'BFBKFRP1XXX',
  'FR:16606': 'AGRIFRPP866',
  'FR:16706': 'AGRIFRPP867',
  'FR:16806': 'AGRIFRPP868',
  'FR:16906': 'AGRIFRPP869',
  'FR:17106': 'AGRIFRPP871',
  'FR:17206': 'AGRIFRPP872',
  'FR:17679': 'SBEXFRP1XXX',
  'FR:17839': 'GMACFR21XXX',
  'FR:17906': 'AGRIFRPP879',
  'FR:18106': 'AGRIFRPP881',
  'FR:18206': 'AGRIFRPP882',
  'FR:18306': 'AGRIFRPP883',
  'FR:18706': 'AGRIFRPP887',
  'FR:19106': 'AGRIFRPP891',
  'FR:19406': 'AGRIFRPP894',
  'FR:19506': 'AGRIFRPP895',
  'FR:30051': 'CFFOFRPPXXX',
  'IE:USBK': 'USBKIE2DXXX',
  'MC:12448': 'BARCMCMXXXX',
};

/** An IBAN of `country` over `bban`, with its two check digits computed (mod 97). */
function ibanOver(country: string, bban: string): string {
  const digits = `${bban}${country}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const check = 98n - (BigInt(digits) % 97n);
  return `${country}${check.toString().padStart(2, '0')}${bban}`;
}

describe('composite map, control of 18 November 2026', () => {
  it('no longer carries the 58 keys the control removed', () => {
    expect(REMOVED.filter((key) => key in map)).toEqual([]);
  });

  it('carries the first-hand BIC on the 48 keys the control corrected', () => {
    const wrong = Object.entries(CORRECTED).filter(([key, bic]) => map[key]?.bic !== bic);
    expect(wrong).toEqual([]);
  });

  it('has no French or Monegasque key on the stem AGRIFRCC', () => {
    const stale = Object.entries(map).filter(
      ([key, entry]) => /^(FR|MC):/.test(key) && entry.bic.startsWith('AGRIFRCC'),
    );
    expect(stale).toEqual([]);
  });

  it('has no Egyptian key whose BIC names another country', () => {
    const foreign = Object.entries(map).filter(
      ([key, entry]) => key.startsWith('EG:') && entry.bic.slice(4, 6) !== 'EG',
    );
    expect(foreign).toEqual([]);
  });

  it('answers "absent from our data", and no BIC, for a removed numeric code', () => {
    // Egypt: 4 digits of bank code, 4 of branch, 17 of account. Code 0003 was removed.
    const result = validateIBAN(ibanOver('EG', `0003${'0001'}${'0'.repeat(16)}1`));
    enrichResult(result);
    expect(result.valid).toBe(true);
    expect(result.bank_code_check?.status).toBe('not_in_register');
    expect(result.bank_code_check?.reason).toBe('absent_from_reference_data');
    expect(result.bank_code_check?.authoritative).toBe(false);
    expect(result.bic).toBeNull();
  });
});
