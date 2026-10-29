import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { auditTable, buildWorkbook, findingLabel } from './audit-file.js';

/**
 * NPA et localité au répertoire officiel de swisstopo, vus depuis l'audit de
 * fichier (29.10.2026). Fichier à part de audit-file.test.ts, pour ne pas
 * croiser les ajouts d'autres chantiers sur le même fichier.
 */

const VALID_CH = 'CH1000230000000012345';
const VALID_DE = 'DE89370400440532013000';

describe('audit: postcode and town in the official directory of localities (29.10.2026)', () => {
  const headers = ['Name', 'IBAN', 'Rue', 'NPA', 'Ville', 'Pays'];

  it('a Swiss row whose town does not go with its postcode: a warning with the source, never an error', () => {
    const res = auditTable(headers, [
      ['Société Alpha', VALID_CH, 'Rue du Lac 12', '1003', 'Lausanne', 'CH'],
      ['Société Beta', VALID_CH, 'Bahnhofstrasse 1', '8001', 'Bern', 'Suisse'],
      ['Société Gamma', VALID_CH, 'Städtle 1', '9490', 'Vaduz', 'CH'],
      ['Société Delta', VALID_CH, 'Hauptstrasse 1', '8238', 'Büsingen', 'CH'],
      ['Société Epsilon', VALID_CH, 'Rue du Lac 1268', '2501', 'Biel', 'CH'],
    ]);
    const codes = res.rows.map((r) => r.findings.map((f) => f.code));
    expect(codes[0]).toEqual([]);
    expect(res.rows[0]!.status).toBe('ok');
    for (const i of [1, 2, 3]) {
      expect(codes[i], `line ${i + 1}`).toContain('postcode_locality_mismatch');
      expect(res.rows[i]!.status).toBe('warning');
      expect(res.rows[i]!.address_verdict).toBe('pass');
    }
    const detail = res.rows[1]!.findings.find(
      (f) => f.code === 'postcode_locality_mismatch',
    )!.detail;
    expect(detail).toContain('Zürich');
    expect(detail).toContain('Source: Federal Office of Topography swisstopo');
    expect(detail).toContain('©swisstopo');
    // 2501 Biel, une case postale : non vérifiable, aucun avertissement (le
    // même IBAN sur chaque ligne donne seulement `duplicate`).
    expect(codes[4]).toEqual(['duplicate']);
  });

  it('without a country column, nothing is compared: the IBAN country says nothing of the address', () => {
    const res = auditTable(
      ['Name', 'IBAN', 'Rue', 'NPA', 'Ville'],
      [['Société Alpha', VALID_CH, 'Museumstrasse 1', '6020', 'Innsbruck']],
    );
    expect(res.rows[0]!.findings.map((f) => f.code)).not.toContain('postcode_locality_mismatch');
  });

  it('a country column other than CH or LI: nothing is compared', () => {
    const res = auditTable(headers, [
      ['Société Alpha', VALID_DE, 'Hauptstrasse 1', '8001', 'Bern', 'DE'],
    ]);
    expect(res.rows[0]!.findings.map((f) => f.code)).not.toContain('postcode_locality_mismatch');
  });

  it('labels in three languages, and a method line with the version and ©swisstopo', () => {
    expect(findingLabel('postcode_locality_mismatch', 'fr')).toContain('swisstopo');
    expect(findingLabel('postcode_locality_mismatch', 'de')).toContain('swisstopo');
    expect(findingLabel('postcode_locality_mismatch', 'en')).toContain('swisstopo');
    for (const lang of ['en', 'fr', 'de'] as const) {
      const res = auditTable(headers, [
        ['Société Beta', VALID_CH, 'Bahnhofstrasse 1', '8001', 'Bern', 'CH'],
      ]);
      const wb = XLSX.read(buildWorkbook(res, lang), { type: 'buffer' });
      const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[1]!]!, {
        header: 1,
      });
      const line = summary.map((r) => String(r[0] ?? '')).find((s) => s.includes('©swisstopo'));
      expect(line, lang).toBeDefined();
      expect(line).toContain('01.10.2026');
    }
  });
});
