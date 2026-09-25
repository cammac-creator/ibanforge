/**
 * `bank_code_holder` et `checks` (25/09/2026).
 *
 * Deux moitiés. Les règles, sur des résultats construits à la main (pures). Puis
 * les invariants sur de vraies validations : IBAN d'exemple publiés ou
 * fabriqués (clé valide), cas choisis par requête sur des registres PUBLICS,
 * assertions sur des étiquettes seulement, jamais sur un nom de banque.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BANK_CODE_HOLDERS,
  CHECK_KEYS,
  CHECK_VALUES,
  bankCodeCheckStatus,
  buildChecks,
  institutionListed,
  notVerified,
  withComplianceChecks,
  type Checks,
} from './checks.js';
import type { ComplianceResult, IBANValidationResult } from '../types.js';
import { EXAMPLE_IBANS } from './countries.js';
import { validateIBAN } from './iban.js';
import { enrichResult } from './enrich.js';
import { getBicDB } from './db.js';
import { ibanFor } from '../test-support/restricted-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function base(overrides: Partial<IBANValidationResult> = {}): IBANValidationResult {
  return {
    iban: 'XX00TEST',
    valid: true,
    country: { code: 'NL', name: 'Netherlands' },
    sepa: { member: true, schemes: ['SCT'], vop_required: true },
    cost_usdc: 0,
    ...overrides,
  };
}

function compliance(overrides: {
  sanctions?: Partial<ComplianceResult['sanctions']>;
  flags?: string[];
}): ComplianceResult {
  return {
    sanctions: {
      country_sanctioned: false,
      bank_sanctioned: false,
      matched_lists: [],
      fatf_status: 'member',
      bank_screened: true,
      ...overrides.sanctions,
    },
    reachability: { sepa_instant: false, sct: false, sdd: false, screened: true },
    vop: { participant: false, status: 'not_found', screened: true },
    risk_score: 0,
    risk_level: 'low',
    flags: overrides.flags ?? [],
  };
}

describe('the rules, on hand-built results', () => {
  it('maps the holder onto checks.bank_code one to one', () => {
    expect(bankCodeCheckStatus('confirmed')).toBe('pass');
    expect(bankCodeCheckStatus('not_allocated')).toBe('fail');
    expect(bankCodeCheckStatus('inferred')).toBe('inferred');
    expect(bankCodeCheckStatus('unknown')).toBe('unknown');
    expect(bankCodeCheckStatus(undefined)).toBe('unknown');
  });

  it('checks.bic follows bic.authoritative', () => {
    const bic = (authoritative: boolean, basis: 'national_register' | 'curated_map') => ({
      code: 'XMPLNL2A',
      bank_name: null,
      city: null,
      basis,
      authoritative,
    });
    // Registre : pass. Code retiré (base registre, autorité retirée) : déduit.
    expect(buildChecks(base({ bic: bic(true, 'national_register') })).bic).toBe('pass');
    expect(buildChecks(base({ bic: bic(false, 'national_register') })).bic).toBe('inferred');
    expect(buildChecks(base({ bic: bic(false, 'curated_map') })).bic).toBe('inferred');
    expect(buildChecks(base({ bic: null, bank_code_holder: 'not_allocated' })).bic).toBe(
      'not_applicable',
    );
    expect(buildChecks(base({ bic: null, bank_code_holder: 'unknown' })).bic).toBe('unknown');
  });

  it('sepa_reachability reads the bank grain, never the country', () => {
    type Reach = NonNullable<IBANValidationResult['sepa']>['bank_reachability'];
    const sepa = (bank_reachability: Reach) =>
      base({ sepa: { member: true, schemes: ['SCT'], vop_required: true, bank_reachability } });
    expect(buildChecks(sepa('listed')).sepa_reachability).toBe('pass');
    expect(buildChecks(sepa('bank_code_not_allocated')).sepa_reachability).toBe('fail');
    expect(buildChecks(sepa('not_listed')).sepa_reachability).toBe('unknown');
    expect(buildChecks(sepa('no_bank')).sepa_reachability).toBe('unknown');
    expect(buildChecks(sepa(null)).sepa_reachability).toBe('unknown');
    expect(
      buildChecks(base({ sepa: { member: false, schemes: [], vop_required: false } }))
        .sepa_reachability,
    ).toBe('not_applicable');
  });

  it('national_check_digits derives from modulus_check for GB and is not_checked elsewhere', () => {
    const gb = (modulus_check?: IBANValidationResult['modulus_check']) =>
      base({ country: { code: 'GB', name: 'United Kingdom' }, modulus_check });
    const m = { source: 'Vocalink', table_fetched_on: '2026-09-01' };
    expect(buildChecks(gb({ checked: true, passed: true, ...m })).national_check_digits).toBe(
      'pass',
    );
    expect(buildChecks(gb({ checked: true, passed: false, ...m })).national_check_digits).toBe(
      'fail',
    );
    expect(buildChecks(gb({ checked: false, passed: null, ...m })).national_check_digits).toBe(
      'not_applicable',
    );
    // Table absente : le contrôle n'a pas eu lieu.
    expect(buildChecks(gb()).national_check_digits).toBe('not_checked');
    expect(buildChecks(base()).national_check_digits).toBe('not_checked');
  });

  it('payee_name, account_exists and payee_sanctions are always not_checked', () => {
    for (const holder of BANK_CODE_HOLDERS) {
      const c = buildChecks(base({ bank_code_holder: holder }));
      expect(c.payee_name).toBe('not_checked');
      expect(c.account_exists).toBe('not_checked');
      expect(c.payee_sanctions).toBe('not_checked');
      const withCompliance = withComplianceChecks(c, compliance({}));
      expect(withCompliance.payee_name).toBe('not_checked');
      expect(withCompliance.payee_sanctions).toBe('not_checked');
    }
  });

  it('institution and country sanctions are not_checked on validation, and filled by compliance', () => {
    const c = buildChecks(base());
    expect(c.institution_sanctions).toBe('not_checked');
    expect(c.country_sanctions).toBe('not_checked');
    // Criblée et propre.
    expect(withComplianceChecks(c, compliance({})).institution_sanctions).toBe('pass');
    // Listée.
    expect(
      withComplianceChecks(c, compliance({ sanctions: { bank_sanctioned: true } }))
        .institution_sanctions,
    ).toBe('fail');
    // Non criblée.
    expect(
      withComplianceChecks(c, compliance({ sanctions: { bank_screened: false } }))
        .institution_sanctions,
    ).toBe('unknown');
    // Une liste promise non chargée : un « non » sur les autres n'est pas un « non ».
    expect(
      withComplianceChecks(c, compliance({ flags: ['sanctions_list_unavailable_un'] }))
        .institution_sanctions,
    ).toBe('unknown');
    expect(withComplianceChecks(c, compliance({})).country_sanctions).toBe('pass');
    expect(
      withComplianceChecks(c, compliance({ sanctions: { country_sanctioned: true } }))
        .country_sanctions,
    ).toBe('fail');
    expect(
      withComplianceChecks(c, compliance({ flags: ['compliance_data_unavailable'] }))
        .country_sanctions,
    ).toBe('unknown');
  });

  it('institutionListed is null without a screen, never false', () => {
    expect(institutionListed(compliance({ sanctions: { bank_screened: false } }))).toBeNull();
    expect(institutionListed(compliance({ sanctions: { bank_sanctioned: true } }))).toBe(true);
    // Une correspondance reste un oui ferme, liste manquante ou non.
    expect(
      institutionListed(
        compliance({
          sanctions: { bank_sanctioned: true },
          flags: ['sanctions_list_unavailable_un'],
        }),
      ),
    ).toBe(true);
    expect(institutionListed(compliance({ flags: ['sanctions_list_unavailable_un'] }))).toBeNull();
    expect(institutionListed(compliance({}))).toBe(false);
  });

  it('notVerified lists inferred, unknown and not_checked keys only', () => {
    const c: Checks = {
      ...buildChecks(base({ bank_code_holder: 'inferred' })),
      bic: 'pass',
      sepa_reachability: 'fail',
    };
    const nv = notVerified(c);
    expect(nv).toContain('bank_code');
    expect(nv).toContain('payee_name');
    expect(nv).not.toContain('iban_structure');
    expect(nv).not.toContain('bic');
    expect(nv).not.toContain('sepa_reachability');
    for (const k of nv) expect(['inferred', 'unknown', 'not_checked']).toContain(c[k]);
  });
});

function enriched(iban: string): IBANValidationResult {
  const r = validateIBAN(iban);
  enrichResult(r);
  return r;
}

/** De vraies validations : les exemples de découverte de chaque pays, et des cas fabriqués. */
function sample(): IBANValidationResult[] {
  const fabricated = [
    'DE23999999990000000000', // BLZ non attribuée
    'AT279999900000123456', // code autrichien fabriqué
    'FR1499999000010123456789A42', // absent de la carte composite
    'NL19BICK0123456789', // carte composite
    'IT26X0311111101000000123456', // carte composite
    'CH9300762011623852957', // IID non attribué
  ];
  return [...Object.values(EXAMPLE_IBANS), ...fabricated].map(enriched).filter((r) => r.valid);
}

describe('the invariants, on real validations', () => {
  const results = sample();

  it('every valid answer with a bank-code verdict carries a holder and every check key', () => {
    for (const r of results) {
      if (!r.bank_code_check) continue;
      expect(BANK_CODE_HOLDERS, r.iban).toContain(r.bank_code_holder);
      expect(Object.keys(r.checks ?? {}), r.iban).toEqual([...CHECK_KEYS]);
      for (const k of CHECK_KEYS) {
        expect(CHECK_VALUES[k] as readonly string[], `${r.iban} ${k}`).toContain(r.checks![k]);
      }
    }
  });

  it('bank_code_holder and checks.bank_code never disagree', () => {
    for (const r of results) {
      if (!r.checks) continue;
      expect(r.checks.bank_code, r.iban).toBe(bankCodeCheckStatus(r.bank_code_holder));
    }
  });

  it('bank_code_holder is not_allocated if and only if status is not_in_register with authoritative true', () => {
    for (const r of results) {
      const c = r.bank_code_check;
      if (!c) continue;
      const denied = c.status === 'not_in_register' && c.authoritative;
      expect(r.bank_code_holder === 'not_allocated', r.iban).toBe(denied);
    }
  });

  it('a verified code is confirmed or inferred, and nothing else is', () => {
    for (const r of results) {
      const c = r.bank_code_check;
      if (!c) continue;
      if (c.status === 'verified') {
        expect(['confirmed', 'inferred'], r.iban).toContain(r.bank_code_holder);
      } else {
        expect(['not_allocated', 'unknown'], r.iban).toContain(r.bank_code_holder);
      }
      // Une source qui fait foi ne rend jamais un détenteur déduit.
      if (r.bank_code_holder === 'inferred') expect(c.authoritative, r.iban).toBe(false);
    }
  });

  it('puts bank_code_holder and checks right after valid', () => {
    const r = enriched('DE89370400440532013000');
    expect(Object.keys(r).slice(0, 4)).toEqual(['iban', 'valid', 'bank_code_holder', 'checks']);
  });
});

describe('maps every bank_code_check shape to exactly one bank_code_holder', () => {
  // Les registres PUBLICS (Bundesbank, SIX, Finance Finland, carte composite) ;
  // les registres sous conditions ont leurs propres tests sur données inventées.
  const cases: Array<[label: string, iban: () => string | null, holder: string]> = [
    ['register that settles the code, found (DE)', () => 'DE89370400440532013000', 'confirmed'],
    [
      'register that settles the code, not allocated (DE)',
      () => 'DE23999999990000000000',
      'not_allocated',
    ],
    [
      'register that settles the code, not allocated (CH)',
      () => 'CH9300762011623852957',
      'not_allocated',
    ],
    [
      'register that settles the code, retired code (DE)',
      () => {
        const row = getBicDB().prepare('SELECT blz FROM de_blz WHERE retired = 1 LIMIT 1').get() as
          { blz: string } | undefined;
        return row ? ibanFor('DE', `${row.blz}0532013000`) : null;
      },
      'confirmed',
    ],
    [
      'register that settles the code, redirected IID (CH)',
      () => {
        const row = getBicDB()
          .prepare(
            'SELECT iid FROM ch_clearing WHERE concatenation = 1 AND redirect_iid IS NOT NULL LIMIT 1',
          )
          .get() as { iid: string } | undefined;
        return row ? ibanFor('CH', `${row.iid}000000123456`) : null;
      },
      'confirmed',
    ],
    ['partial register, found (FI)', () => 'FI2112345600000785', 'confirmed'],
    ['composite map (NL)', () => 'NL19BICK0123456789', 'inferred'],
    ['composite map (IT)', () => 'IT26X0311111101000000123456', 'inferred'],
    ['published structural rule (LV)', () => ibanFor('LV', 'HABA0012345678910'), 'inferred'],
    ['absent from the composite map (FR)', () => 'FR1499999000010123456789A42', 'unknown'],
  ];

  for (const [label, iban, holder] of cases) {
    it(`${label}: ${holder}`, () => {
      const i = iban();
      expect(i, `no case found for ${label}`).not.toBeNull();
      const r = enriched(i!);
      expect(r.valid, i!).toBe(true);
      expect(r.bank_code_holder, i!).toBe(holder);
    });
  }

  it('reads the composite map it claims to read', () => {
    // Garde-fou du tableau ci-dessus : les clés citées existent dans la carte.
    const map = JSON.parse(readFileSync(resolve(HERE, '../db/bic_data.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    for (const key of ['NL:BICK', 'IT:03111', 'LV:HABA']) expect(map, key).toHaveProperty([key]);
  });
});
