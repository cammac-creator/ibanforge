import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadBundesbankBlzCsv,
  normalizeBundesbankBlz,
  splitBundesbankCsvLine,
} from './bundesbank-blz-csv.js';

const fields = [
  '01234567',
  '1',
  'Banque Alpha',
  '00001',
  'Ville fictive',
  'Alpha',
  '00000',
  'ALPHDEFFXXX',
  '09',
  '000001',
  'U',
  '0',
  '00000000',
];
const widths = [8, 1, 58, 5, 35, 27, 5, 11, 2, 6, 1, 1, 8];
const fixed = fields.map((f, i) => f.padEnd(widths[i])).join('');
const header =
  'Bankleitzahl;Merkmal;Bezeichnung;Postleitzahl;Ort;Kurzbezeichnung;PAN;BIC;Pruefziffer;Datensatznummer;Aenderung;Loeschung;Nachfolge';
afterEach(() => vi.unstubAllGlobals());
describe('lecture des deux formats Bundesbank', () => {
  it('garde le premier enregistrement fixe et ses zéros', () => {
    const lines = normalizeBundesbankBlz(fixed + '\r\n' + fixed)
      .trim()
      .split('\n');
    expect(lines).toHaveLength(3);
    expect(splitBundesbankCsvLine(lines[1])).toEqual(fields);
  });
  it('donne les mêmes champs depuis le CSV', () => {
    expect(normalizeBundesbankBlz(header + '\n' + fields.join(';'))).toBe(
      normalizeBundesbankBlz(fixed),
    );
  });
  it('refuse une ligne fixe tronquée, un faux CSV et un en-tête seul', () => {
    for (const raw of [fixed.slice(0, -1), '<html>' + 'x'.repeat(110000), header])
      expect(() => normalizeBundesbankBlz(raw)).toThrow();
  });
  it('prend le secours si le HTTP 200 contient une page HTML', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>' + 'x'.repeat(110000)))
      .mockResolvedValueOnce(new Response((fixed + '\n').repeat(1000)));
    vi.stubGlobal('fetch', request);
    expect((await downloadBundesbankBlzCsv()).split('\n')).toHaveLength(1002);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('échoue lorsque les deux réponses sont inutilisables', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Erreur</html>')));
    await expect(downloadBundesbankBlzCsv()).rejects.toThrow();
  });
});
