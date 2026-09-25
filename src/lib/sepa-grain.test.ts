import { describe, it, expect } from 'vitest';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { buildComplianceResponse } from './compliance-response.js';
import { getComplianceDB } from './compliance-db.js';
import { getSepaInfo, SEPA_MEMBERS_EXTRA, SEPA_MEMBERS_EXTRA_AS_OF } from './countries.js';

/**
 * The two SEPA findings of the data audit of 01/09/2026.
 *
 * DATA-02: `sepa.schemes` is published as "the schemes the INSTITUTION
 * supports" and was answered with a literal per group of countries, so the two
 * endpoints of the same product contradicted each other on one IBAN.
 * DATA-03: five SEPA members answered `member: false` while the EPC register
 * shipped in the same product listed 66 of their banks.
 */

function enrich(iban: string) {
  const result = validateIBAN(iban);
  enrichResult(result);
  return result as typeof result & { sepa?: { basis?: string } };
}

/** The German bank the audit measured the contradiction on: LBS NordOst, BLZ 10050500. */
const DE_SCT_ONLY = 'DE57100505000123456789';

describe('DATA-02 — sepa.schemes at the grain the contract promises', () => {
  it('serves the register schemes for a bank the EPC register knows', () => {
    const result = enrich(DE_SCT_ONLY);

    // Not hardcoded against a snapshot of the dataset: the assertion is that
    // the served answer IS the register's answer for this BIC8, whatever the
    // next monthly refresh makes of it.
    const bic8 = result.bic!.code.slice(0, 8);
    const rows = getComplianceDB()
      .prepare('SELECT scheme FROM sepa_participants WHERE bic8 = ?')
      .all(bic8) as Array<{ scheme: string }>;
    const registered = new Set(rows.map((r) => r.scheme));
    expect(
      registered.size,
      `${bic8} must be in the EPC register for this test to mean anything`,
    ).toBeGreaterThan(0);

    expect(result.sepa!.basis).toBe('epc_register');
    expect(new Set(result.sepa!.schemes)).toEqual(registered);
  });

  it('says the same thing on /v1/iban/validate and /v1/iban/compliance', () => {
    // The finding itself: validate announced "SDD available" where compliance,
    // reading the register beside it, answered `sdd: false`. One IBAN, one
    // answer, whichever endpoint is asked.
    const response = buildComplianceResponse(DE_SCT_ONLY);
    const schemes = new Set(response.sepa!.schemes);
    const reach = response.compliance.reachability;

    expect(schemes.has('SCT')).toBe(reach.sct);
    expect(schemes.has('SDD')).toBe(reach.sdd);
    expect(schemes.has('SCT_INST')).toBe(reach.sepa_instant);
  });

  it('keeps the country answer, and says so, when no institution was resolved', () => {
    // A Portuguese example whose synthetic bank code resolves nothing. The
    // register lists participants; an absence is not a withdrawal from the
    // scheme, so the country literal stays and `basis` names it.
    const result = enrich('PT50000201231234567890154');
    expect(result.bic).toBeNull();
    expect(result.sepa!.basis).toBe('country_default');
    expect(result.sepa!.schemes).toEqual(['SCT', 'SDD', 'SCT_INST']);
  });

  it('never leaves basis unset on a SEPA answer', () => {
    for (const iban of [DE_SCT_ONLY, 'CH5604835012345678009', 'GB29NWBK60161331926819']) {
      expect(enrich(iban).sepa!.basis, iban).toMatch(/^(country_default|epc_register)$/);
    }
  });

  it('gives a non-member country no schemes off a resolved BIC', () => {
    // A foreign branch's BIC must not make `member: false` sit beside a
    // non-empty `schemes`.
    const result = enrich('BR1500000000000010932840814P2');
    expect(result.sepa!.member).toBe(false);
    expect(result.sepa!.schemes).toEqual([]);
    expect(result.sepa!.basis).toBe('country_default');
  });
});

describe('DATA-03 — the five SEPA members the frozen library set misses', () => {
  it('serves the Albanian example IBAN as a SEPA member', () => {
    const result = enrich('AL47212110090000000235698741');
    expect(result.sepa!.member).toBe(true);
    expect(result.sepa!.schemes).toContain('SCT');
    // Not in the euro area and not in the EU/EEA: the IPR VoP duty does not
    // reach these PSPs, exactly as for CH, GB and GI.
    expect(result.sepa!.vop_required).toBe(false);
    expect(result.risk_indicators!.sepa_reachable).toBe(true);
  });

  it.each(Object.keys(SEPA_MEMBERS_EXTRA))(
    'answers %s as a member through the facade too',
    (cc) => {
      // /v1/iban/structure and the MCP country resource read getSepaInfo
      // directly, not an enriched result.
      expect(getSepaInfo(cc).member).toBe(true);
    },
  );

  it('leaves the library its own countries', () => {
    expect(getSepaInfo('DE')).toEqual({
      member: true,
      schemes: ['SCT', 'SDD', 'SCT_INST'],
      vop_required: true,
    });
    expect(getSepaInfo('CH')).toEqual({
      member: true,
      schemes: ['SCT', 'SDD'],
      vop_required: false,
    });
    expect(getSepaInfo('BR')).toEqual({ member: false, schemes: [], vop_required: false });
  });

  it('keeps the hardcoded schemes equal to the register they were read from', () => {
    // The table in countries.ts cannot query the database (it is the offline
    // country table every route imports), so this is what stops it from rotting
    // in silence: the next register refresh that adds SDD to a Serbian bank
    // fails here instead of ageing unnoticed.
    const rows = getComplianceDB()
      .prepare(
        `SELECT substr(bic8, 5, 2) AS cc, scheme FROM sepa_participants
         WHERE substr(bic8, 5, 2) IN ('AL', 'MD', 'ME', 'MK', 'RS') GROUP BY cc, scheme`,
      )
      .all() as Array<{ cc: string; scheme: string }>;

    const fromRegister = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!fromRegister.has(row.cc)) fromRegister.set(row.cc, new Set());
      fromRegister.get(row.cc)!.add(row.scheme);
    }

    for (const [cc, schemes] of Object.entries(SEPA_MEMBERS_EXTRA)) {
      expect(
        new Set(schemes),
        `${cc} in SEPA_MEMBERS_EXTRA (as of ${SEPA_MEMBERS_EXTRA_AS_OF})`,
      ).toEqual(fromRegister.get(cc));
    }
    expect([...fromRegister.keys()].sort()).toEqual(Object.keys(SEPA_MEMBERS_EXTRA).sort());
  });
});
