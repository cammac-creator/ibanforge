import { describe, expect, it } from 'vitest';
import { buildBicComplianceResponse, buildComplianceResponse } from './compliance-response.js';
import { buildComplianceResult } from './compliance.js';
import { getCountryRisk } from './countries.js';

/**
 * The defect these tests exist for, measured on production 28/07/2026:
 * /v1/iban/compliance answered risk_level "low", risk_score 10 for an IBAN that
 * did not validate at all. The 10 came from no_sepa_instant (+5) and no_vop
 * (+5), i.e. two failed lookups, and landed just under the 20-point 'medium'
 * threshold. The less the API could establish, the more reassuring its verdict.
 */
describe('buildComplianceResponse — an IBAN that does not validate is not scored', () => {
  const INVALID = [
    ['nonsense', 'XX00NOTANIBAN0000'],
    ['checksum failure', 'DE89370400440532013001'],
    ['wrong length', 'RU84044525225407028100000000001'],
    ['too short', 'CH93'],
    ['empty', ''],
  ] as const;

  for (const [name, iban] of INVALID) {
    it(`refuses to score: ${name}`, () => {
      const r = buildComplianceResponse(iban);
      expect(r.valid).toBe(false);
      expect(r.compliance.risk_score).toBeNull();
      expect(r.compliance.risk_level).toBe('unassessable');
      expect(r.compliance.flags).toEqual(['iban_invalid']);
    });
  }

  it('never answers a level that reads as permission', () => {
    // The regression in one line: whatever else changes, an unvalidatable IBAN
    // must not come back 'low'.
    for (const [, iban] of INVALID) {
      expect(buildComplianceResponse(iban).compliance.risk_level).not.toBe('low');
    }
  });

  it('carries no score-derived flag, since no score was computed', () => {
    const r = buildComplianceResponse('DE89370400440532013001');
    expect(r.compliance.flags).not.toContain('no_sepa_instant');
    expect(r.compliance.flags).not.toContain('no_vop');
  });

  it('still attaches the scope disclaimer', () => {
    // An agent that reads meta.scope must get it on every answer, including
    // the refusals: "we could not assess" and "we only screen the bank" are
    // two different limits and it needs both.
    const r = buildComplianceResponse('DE89370400440532013001');
    expect(r.meta.scope).toBe('bank_bic_only');
    expect(r.meta.disclaimer).toBeTruthy();
  });

  it('keeps the validation error, so the caller can fix the input', () => {
    const r = buildComplianceResponse('DE89370400440532013001');
    expect(r.error).toBe('checksum_failed');
  });
});

describe('buildComplianceResponse — a valid IBAN is scored exactly as before', () => {
  it('scores an ordinary German IBAN low, on merit', () => {
    const r = buildComplianceResponse('DE89370400440532013000');
    expect(r.valid).toBe(true);
    expect(r.compliance.risk_level).toBe('low');
    expect(typeof r.compliance.risk_score).toBe('number');
  });

  it('scores a Russian IBAN critical, and the typo next to it does not', () => {
    // The pair that made the defect undeniable. One character apart.
    const real = buildComplianceResponse('RU8404452522540702810412345678901');
    expect(real.valid).toBe(true);
    expect(real.compliance.risk_level).toBe('critical');
    expect(real.compliance.risk_score).toBeGreaterThanOrEqual(80);
    expect(real.compliance.flags).toContain('sanctioned_country');

    const typo = buildComplianceResponse('RU1704452522540702810412345678901');
    expect(typo.valid).toBe(false);
    expect(typo.compliance.risk_level).toBe('unassessable');
    // Before the fix this said 'low'. That is the whole bug: a typo turned a
    // sanctioned-country hit into a green light.
  });

  it('derives country risk from the country code, not from risk_indicators', () => {
    // risk_indicators is absent whenever BBAN parsing fails, and three of the
    // four old copies read country risk from it. That is how a Russian IBAN
    // once scored 60/high instead of critical.
    const r = buildComplianceResponse('RU8404452522540702810412345678901');
    expect(r.compliance.flags).toContain('high_risk_country');
  });

  it('attaches meta on the valid path too', () => {
    expect(buildComplianceResponse('DE89370400440532013000').meta.scope).toBe('bank_bic_only');
  });
});

/**
 * Les noms honnêtes et le drapeau sans poids (25/09/2026). Le score ne bouge
 * pour aucune entrée : il est recalculé ici avec l'ANCIENNE lecture de
 * `bank_code_check`, et les deux doivent être identiques.
 */
describe('buildComplianceResponse: honest names, and a flag that carries no weight', () => {
  const SERIES = [
    'IT60X0542811101000000123456',
    'IT26X0311111101000000123456',
    'FR1420041010050500013M02606',
    'DE89370400440532013000',
    'DE23999999990000000000',
    'NL19BICK0123456789',
    'AT279999900000123456',
    'CH9300762011623852957',
    'GB29NWBK60161331926819',
    'FR1499999000010123456789A42',
    'AE070331234567890123456',
    'RU0204452560040702810412345678901',
  ];

  /** La correspondance d'avant le 25/09/2026, lue dans bank_code_check. */
  function legacyConfidence(r: ReturnType<typeof buildComplianceResponse>) {
    const check = r.bank_code_check;
    return !check || check.status === 'verified'
      ? ('confirmed' as const)
      : check.authoritative
        ? ('denied' as const)
        : ('unverified' as const);
  }

  it('bank_code_inferred carries no weight: every score is the one the old mapping gives', () => {
    let inferred = 0;
    for (const iban of SERIES) {
      const r = buildComplianceResponse(iban);
      if (!r.valid) continue;
      const legacy = buildComplianceResult(
        true,
        r.country!.code,
        r.bic?.code?.slice(0, 8) ?? null,
        r.issuer?.type ?? 'bank',
        getCountryRisk(r.country!.code),
        r.risk_indicators?.test_bic ?? false,
        legacyConfidence(r),
      );
      expect(r.compliance.risk_score, iban).toBe(legacy.risk_score);
      expect(r.compliance.risk_level, iban).toBe(legacy.risk_level);
      expect(
        r.compliance.flags.filter((f) => f !== 'bank_code_inferred'),
        iban,
      ).toEqual(legacy.flags);
      // Le drapeau suit le détenteur, et lui seul.
      expect(r.compliance.flags.includes('bank_code_inferred'), iban).toBe(
        r.bank_code_holder === 'inferred',
      );
      if (r.bank_code_holder === 'inferred') inferred += 1;
    }
    expect(inferred).toBeGreaterThan(0);
  });

  it('institution_listed is null when bank_screened is false', () => {
    const r = buildComplianceResponse('DE23999999990000000000');
    expect(r.compliance.sanctions.bank_screened).toBe(false);
    expect(r.compliance.sanctions.bank_sanctioned).toBe(false);
    expect(r.compliance.sanctions.institution_listed).toBeNull();
    expect(r.compliance.vop.register_status).toBeNull();
    expect(r.compliance.reachability.listed_in_epc_registers).toBeNull();
    expect(r.checks?.institution_sanctions).toBe('unknown');
    expect(r.checks?.country_sanctions).toBe('pass');
  });

  it('payee_screened is false on every answer, including unassessable and the BIC path', () => {
    for (const iban of [...SERIES, 'not-an-iban', 'DE89370400440532013001']) {
      expect(buildComplianceResponse(iban).compliance.sanctions.payee_screened, iban).toBe(false);
    }
    for (const bic of ['COBADEFF', 'ZZZZITMM', 'NBRBBY2X']) {
      const r = buildBicComplianceResponse(bic);
      if ('error' in r) throw new Error(`${bic} should validate`);
      expect(r.compliance.sanctions.payee_screened, bic).toBe(false);
      expect(r.compliance.sanctions).toHaveProperty('institution_listed');
      expect(r.compliance.vop).toHaveProperty('register_status');
      expect(r.compliance.reachability).toHaveProperty('listed_in_epc_registers');
    }
  });

  it('an unassessable answer carries the honest names too, and no checks', () => {
    const r = buildComplianceResponse('not-an-iban');
    expect(r.compliance.sanctions.institution_listed).toBeNull();
    expect(r.compliance.reachability.listed_in_epc_registers).toBeNull();
    expect(r.compliance.vop.register_status).toBeNull();
    expect(r).not.toHaveProperty('checks');
    expect(r).not.toHaveProperty('bank_code_holder');
  });

  it('names the country on the BIC path, even for a BIC the directory does not hold', () => {
    const r = buildBicComplianceResponse('ZZZZITMM');
    if ('error' in r) throw new Error('should validate');
    expect(r.found).toBe(false);
    expect(r.country).toEqual({ code: 'IT', name: 'Italy' });
  });
});
