import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CANTONAL_BANK_STATE_GUARANTEE,
  STATE_GUARANTEE_AS_OF,
  stateGuaranteeForHeadOffice,
} from './ch-state-guarantee.js';
import { clearingRecord, lookupClearing, lookupClearingByBankCode } from './ch-clearing.js';
import { getBicDB } from './db.js';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import { buildComplianceResponse } from './compliance-response.js';
import { directiveHits } from '../mcp/directives.js';
import { DIRECTORY_TOOL_OUTPUT_SCHEMAS, TOOL_OUTPUT_SCHEMAS } from '../mcp/output-schemas.js';
import { buildSpec } from '../routes/openapi.js';

/**
 * The state guarantee of the cantonal banks (29.10.2026): a table of 24
 * head-office IIDs read in the cantonal laws, served by `lookup_ch_clearing`
 * only. These tests hold the table to the SIX data it is keyed on, in both
 * directions, so that a monthly refresh that moves an IID turns red here, and
 * hold the field out of `validate_iban` and `check_compliance`.
 */

const TABLE = Object.entries(CANTONAL_BANK_STATE_GUARANTEE);
const NO_GUARANTEE = ['00767', '00788', '00790']; // BCV, BCGE, BEKB

/** Every IID of the tracked SIX extract, standard and QR rows alike. */
function allIids(): string[] {
  return (getBicDB().prepare('SELECT iid FROM ch_clearing').all() as Array<{ iid: string }>).map(
    (r) => r.iid,
  );
}

/** Every string of a JSON value, keys included, so a nested field cannot hide. */
function flatten(value: unknown): string {
  return JSON.stringify(value);
}

describe('the table: 24 cantonal banks, each with its law, its text and its date', () => {
  it('has 24 head offices: 21 guarantees written in the law, 3 without', () => {
    expect(TABLE).toHaveLength(24);
    expect(TABLE.filter(([, row]) => row.guaranteed)).toHaveLength(21);
    expect(
      TABLE.filter(([, row]) => !row.guaranteed)
        .map(([iid]) => iid)
        .sort(),
    ).toEqual(NO_GUARANTEE);
  });

  it('names 24 different cantons, and neither Solothurn nor Appenzell Ausserrhoden', () => {
    const cantons = TABLE.map(([, row]) => row.canton);
    expect(new Set(cantons).size).toBe(24);
    for (const canton of cantons) expect(canton).toMatch(/^[A-Z]{2}$/);
    expect(cantons).not.toContain('SO');
    expect(cantons).not.toContain('AR');
  });

  it('every entry carries a law reference with its article, a URL and the reading date', () => {
    for (const [iid, row] of TABLE) {
      expect(iid).toMatch(/^\d{5}$/);
      // The number in the cantonal collection, on every entry.
      expect(row.source, iid).toMatch(/, [A-Za-z/ ]*\d[\d.]*(?: \d+)?[,)]?/);
      // The article, wherever the law has one; the Vaud law has none to cite,
      // and its note says so.
      if (iid === '00767') expect(row.note, iid).toBeDefined();
      else expect(row.source, iid).toMatch(/(§|\bArt\.|\bart\.)\s?(\d|T1)/);
      expect(row.url, iid).toMatch(/^https:\/\/[a-z0-9.-]+\.ch\//);
      const served = stateGuaranteeForHeadOffice(iid)!;
      expect(served, iid).toMatchObject({
        guaranteed: row.guaranteed,
        canton: row.canton,
        source: row.source,
        url: row.url,
        as_of: '2026-10-29',
      });
    }
    expect(STATE_GUARANTEE_AS_OF).toBe('2026-10-29');
  });

  it('BEKB, BCV and BCGE are guaranteed: false, and say why', () => {
    const bekb = stateGuaranteeForHeadOffice('00790')!;
    expect(bekb).toMatchObject({ guaranteed: false, canton: 'BE' });
    // The bonds outstanding on 1 January 2013 stay guaranteed until they
    // mature: "Anleihen", bonds, not every liability.
    expect(bekb.note).toContain('1 January 2013');
    expect(bekb.note).toContain('bonds (Anleihen)');
    expect(bekb.source).toContain('BSG 951.10');
    expect(bekb.source).toContain('T1-1');

    const bcv = stateGuaranteeForHeadOffice('00767')!;
    expect(bcv).toMatchObject({ guaranteed: false, canton: 'VD' });
    expect(bcv.note).toBe('The law has no article granting a state guarantee.');

    const bcge = stateGuaranteeForHeadOffice('00788')!;
    expect(bcge).toMatchObject({ guaranteed: false, canton: 'GE' });
    expect(bcge.note).toContain('31 December 2016');
  });

  it('Obwalden and Glarus stay guaranteed, with the article and no category of their own', () => {
    for (const [iid, canton, article] of [
      ['00780', 'OW', 'GDB 661.1, Art. 5'],
      ['00773', 'GL', 'GS IX B/31/1, Art. 5'],
    ] as const) {
      const served = stateGuaranteeForHeadOffice(iid)!;
      expect(served).toMatchObject({ guaranteed: true, canton });
      expect(served.source).toContain(article);
      expect(served).not.toHaveProperty('note');
    }
  });

  it('cites the second article where the law writes its exclusion outside the guarantee article', () => {
    // Fribourg excludes participation certificates in art. 5 al. 3, Neuchâtel
    // in art. 8 al. 3: the guarantee article alone would leave them out.
    expect(stateGuaranteeForHeadOffice('00768')!.source).toMatch(
      /RSF 961\.1, art\. 3 and art\. 5 al\. 3$/,
    );
    expect(stateGuaranteeForHeadOffice('00766')!.source).toMatch(
      /RSN 621, art\. 4 and art\. 8 al\. 3$/,
    );
  });

  it('every text was read in the official collection of its canton, never in a copy', () => {
    for (const [iid, row] of TABLE) {
      expect(row.url, iid).not.toMatch(/lexfind/i);
      expect(row.source, iid).not.toMatch(/lexfind|copy/i);
    }
    // Vaud: the BLV of the canton, the version in force since 1 March 2025.
    const bcv = CANTONAL_BANK_STATE_GUARANTEE['00767'];
    expect(bcv.url).toMatch(/^https:\/\/prestations\.vd\.ch\/pub\/blv-publication\//);
    expect(bcv.source).toContain('BLV 951.01, version in force since 1 March 2025');
    // Schwyz: the PDF the cantonal index (SRSZ) lists, and the date of its text.
    const szkb = CANTONAL_BANK_STATE_GUARANTEE['00777'];
    expect(szkb.url).toMatch(/^https:\/\/www\.sz\.ch\/public\/upload\/assets\/\d+\/321_100\.pdf/);
    expect(szkb.source).toContain('SRSZ 321.100, § 7, consolidated text of 1 January 2015');
  });

  it('accepts an unpadded IID, and answers null for anything else', () => {
    expect(stateGuaranteeForHeadOffice('700')).toEqual(stateGuaranteeForHeadOffice('00700'));
    expect(stateGuaranteeForHeadOffice('00230')).toBeNull();
    expect(stateGuaranteeForHeadOffice(null)).toBeNull();
    expect(stateGuaranteeForHeadOffice('')).toBeNull();
  });
});

describe('the table against SIX BankMaster, in both directions', () => {
  it('each key is the head office of a cantonal bank, confirmed by its BIC', () => {
    for (const [iid, row] of TABLE) {
      const entry = lookupClearing(iid);
      expect(entry, iid).not.toBeNull();
      expect(entry!.iid_type, iid).toBe('headquarters');
      expect(entry!.headquarters_iid, iid).toBe(iid);
      expect(entry!.institution_type, `${iid} ${entry!.name}`).toBe('cantonal_bank');
      expect(entry!.bic?.slice(0, 8), `${iid} ${entry!.name}`).toBe(row.bic8);
    }
  });

  it('every IID served as a cantonal bank gets the field from its head office, and no other IID does', () => {
    let withField = 0;
    for (const iid of allIids()) {
      // Through the lookup, not the raw row: a QR row names itself as its own
      // head office in the file, and only rowToEntry points it at the bank.
      const entry = lookupClearingByBankCode(iid)!;
      const record = clearingRecord(entry);
      const isCantonal = entry.institution_type === 'cantonal_bank';
      expect('state_guarantee' in record, `${iid} ${entry.name}`).toBe(isCantonal);
      if (isCantonal) {
        withField += 1;
        expect(record.state_guarantee, iid).toEqual(
          stateGuaranteeForHeadOffice(entry.headquarters_iid),
        );
      }
    }
    // Branches and QR-IIDs on top of the 24 head offices.
    expect(withField).toBeGreaterThan(24);
  });

  it('a branch inherits its head office: ZKB 702, BCV Lausanne 76711', () => {
    const zkbBranch = clearingRecord(lookupClearingByBankCode('00702')!);
    expect(zkbBranch.institution).toMatchObject({ iid_type: 'branch', headquarters_iid: '00700' });
    expect(zkbBranch.state_guarantee).toEqual(stateGuaranteeForHeadOffice('00700'));
    expect(zkbBranch.state_guarantee?.guaranteed).toBe(true);

    const bcvBranch = clearingRecord(lookupClearingByBankCode('76711')!);
    expect(bcvBranch.institution).toMatchObject({ iid_type: 'branch', headquarters_iid: '00767' });
    expect(bcvBranch.state_guarantee).toMatchObject({ guaranteed: false, canton: 'VD' });
  });

  it('a QR-IID takes the bank it belongs to: 30790 is the BEKB', () => {
    const qr = clearingRecord(lookupClearingByBankCode('30790')!);
    expect(qr.iid).toBe('00790');
    expect(qr.state_guarantee).toMatchObject({ guaranteed: false, canton: 'BE' });
  });

  it('a bank that is not a cantonal bank has no field at all', () => {
    // UBS, PostFinance, Raiffeisen, a regional bank, the SNB.
    for (const iid of ['00230', '09000', '80000', '08733', '00100']) {
      const record = clearingRecord(lookupClearingByBankCode(iid)!);
      expect(record, iid).not.toHaveProperty('state_guarantee');
    }
  });
});

describe('kept out of validate_iban and check_compliance', () => {
  // Invented accounts at the ZKB (00700) and the BCV (00767), valid check digits.
  const IBANS = ['CH0600700000000123456', 'CH5700767000000123456'];

  it('validate_iban: the clearing block names the cantonal bank, without the guarantee', () => {
    for (const iban of IBANS) {
      const result = validateIBAN(iban);
      enrichResult(result);
      expect(result.valid, iban).toBe(true);
      const serialised = flatten(result);
      expect(serialised, iban).toContain('cantonal_bank');
      expect(serialised, iban).not.toContain('state_guarantee');
      expect(serialised, iban).not.toContain('Kantonalbankgesetz');
    }
  });

  it('check_compliance: nothing of the guarantee, at any depth', () => {
    for (const iban of IBANS) {
      const response = buildComplianceResponse(iban);
      const serialised = flatten(response);
      expect(serialised, iban).toContain('cantonal_bank');
      expect(serialised, iban).not.toContain('state_guarantee');
      expect(serialised, iban).not.toMatch(/Staatsgarantie|garantie de l'État|Kantonalbankgesetz/);
    }
  });
});

describe('the words served', () => {
  const schema = TOOL_OUTPUT_SCHEMAS.lookup_ch_clearing.state_guarantee;
  const schemaJson = flatten(z.toJSONSchema(z.object({ state_guarantee: schema })));
  const spec = buildSpec() as unknown as {
    components: { schemas: { ChClearingResult: { properties: Record<string, unknown> } } };
  };
  const openapi = flatten(spec.components.schemas.ChClearingResult.properties.state_guarantee);
  const served = TABLE.map(([iid]) => stateGuaranteeForHeadOffice(iid)!);

  /** Every `description` of a JSON value, at every depth. */
  function descriptions(json: string): string[] {
    const out: string[] = [];
    JSON.parse(json, (key, value: unknown) => {
      if (key === 'description' && typeof value === 'string') out.push(value);
      return value;
    });
    return out;
  }

  it('no word of a rating or of safety, in the data, the MCP schema or the OpenAPI schema', () => {
    const FORBIDDEN = /\b(safe|safety|secure|sûr|sûre|rated|rating|solid|solidity|risk)\b/i;
    expect(openapi).toContain('Staatsgarantie');
    for (const text of [schemaJson, openapi, ...served.map(flatten)]) {
      expect(text).not.toMatch(FORBIDDEN);
    }
  });

  it('the strings pass the directory crib: facts, not directions', () => {
    for (const guarantee of served) {
      for (const text of [guarantee.source, guarantee.note ?? '']) {
        expect(directiveHits(text, 'response'), text).toEqual([]);
      }
    }
    const texts = [...descriptions(schemaJson), ...descriptions(openapi)];
    // The block, its six fields, on both schemas.
    expect(texts.length).toBeGreaterThanOrEqual(12);
    for (const text of texts) expect(directiveHits(text, 'description'), text).toEqual([]);
  });

  it('both MCP output schemas keep the field whole, note included', () => {
    for (const iid of ['00700', '00702', '00767', '00790', '30790']) {
      const payload = clearingRecord(lookupClearingByBankCode(iid)!);
      expect(payload.state_guarantee, iid).toBeDefined();
      for (const shape of [
        TOOL_OUTPUT_SCHEMAS.lookup_ch_clearing,
        DIRECTORY_TOOL_OUTPUT_SCHEMAS.lookup_ch_clearing,
      ]) {
        expect(z.object(shape).parse(payload), iid).toEqual(payload);
      }
    }
  });
});
