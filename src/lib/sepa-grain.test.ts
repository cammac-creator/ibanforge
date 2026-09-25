import { describe, it, expect } from 'vitest';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { buildComplianceResponse } from './compliance-response.js';
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
  // « serves the register schemes for a bank the EPC register knows » et « says
  // the same thing on /v1/iban/validate and /v1/iban/compliance » lisaient ici
  // le vrai registre EPC (LBS NordOst). Ce registre a quitté la base de ce dépôt
  // à l'étape du retrait (25/09/2026) : les deux règles sont prouvées sur des
  // inscriptions inventées dans src/lib/restricted-data-absent.test.ts (bloc
  // « control », « serves the bank s own schemes, the same on validate and on
  // compliance »). Ce qui reste vrai ici, sur la base publique : sans registre
  // consulté, la validation garde le pays et le dit, et la conformité le dit
  // aussi, sans rien affirmer de la banque.
  it('keeps the country answer on both endpoints while the EPC register is not consulted', () => {
    const result = enrich(DE_SCT_ONLY);
    const response = buildComplianceResponse(DE_SCT_ONLY);
    if (response.compliance.reachability.screened) {
      // Une base qui porte le registre (une copie fusionnée) : la règle d'origine.
      const schemes = new Set(response.sepa!.schemes);
      const reach = response.compliance.reachability;
      expect(schemes.has('SCT')).toBe(reach.sct);
      expect(schemes.has('SDD')).toBe(reach.sdd);
      expect(schemes.has('SCT_INST')).toBe(reach.sepa_instant);
      return;
    }
    expect(result.sepa!.basis).toBe('country_default');
    expect(result.sepa!.vop_participant).toBeNull();
    expect(response.compliance.reachability.listed_in_epc_registers).toBeNull();
    expect(response.compliance.flags).toEqual(
      expect.arrayContaining(['sepa_register_unavailable', 'vop_register_unavailable']),
    );
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

  // « keeps the hardcoded schemes equal to the register they were read from »
  // comparait la table ci-dessus au vrai registre EPC. Ce registre ne vit plus
  // que dans la surcouche privée (étape du retrait, 25/09/2026) : la comparaison
  // est faite à chaque reconstruction de la surcouche de conformité par la porte
  // privée (`npm run overlay -- check`, auditOverlayData dans
  // src/lib/restricted-data-audit.ts), un avertissement par pays qui dérive.
  it('hands the comparison with the register to the private gate', () => {
    expect(SEPA_MEMBERS_EXTRA_AS_OF).toMatch(/^\d{4}-\d{2}$/);
    expect(Object.keys(SEPA_MEMBERS_EXTRA).sort()).toEqual(['AL', 'MD', 'ME', 'MK', 'RS']);
  });
});
