import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextSteps } from './next-steps.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { NEXT_STEPS_SCHEMA } from './bank-code-schema.js';
import type { IBANValidationResult } from '../types.js';
import type { NationalCheck, NationalCheckScheme } from './national-check/index.js';

function steps(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return nextSteps(r);
}
const codes = (iban: string) => steps(iban).map((s) => s.code);

describe('nextSteps', () => {
  it('tells an agent to fall back to a name check when we cannot confirm the bank code', () => {
    // Fabricated French bank code: valid IBAN, unconfirmable institution, and we
    // hold no French register, so the only honest instruction is "do not treat
    // this as a rejection, verify the payee downstream". Was Germany until
    // 29/07/2026, when the Bundesbank register made that case a hard denial.
    const s = steps('FR1499999000010123456789A42');
    const hit = s.find((x) => x.code === 'verify_payee_name');
    expect(hit).toBeDefined();
    expect(hit!.because).toMatch(/bank_code_check/);
  });

  it('says stop, not "verify", when the register itself denies the code', () => {
    // Switzerland is authoritative. This is the one case where an agent may act
    // on non-existence, so it must not be given the same advice as Germany.
    const s = steps('CH8499999012345678901');
    expect(s.map((x) => x.code)).toContain('bank_code_not_allocated');
    expect(s.map((x) => x.code)).not.toContain('verify_payee_name');
  });

  it('warns when the BIC was picked from several candidate institutions', () => {
    const s = steps('NL53ETPW0123456789');
    // ETPW resolves through the prefix path; if it ever matches only one BIC8
    // the step must disappear rather than warn about nothing.
    const hit = s.find((x) => x.code === 'bic_is_advisory');
    if (hit) expect(hit.because).toMatch(/prefix/);
  });

  it('flags a curated non-bank issuer, since name matching is weakest there', () => {
    const s = steps('DE43100110010532013000'); // N26
    const hit = s.find((x) => x.code === 'expect_virtual_iban');
    expect(hit).toBeDefined();
    expect(hit!.because).toMatch(/digital_bank/);
  });

  it('does not claim a virtual IBAN on an issuer we merely defaulted to bank', () => {
    // 97.9% of BIC8 default to 'bank'. Reading that as "not an EMI" would be
    // the same overclaim the classification field exists to prevent.
    expect(codes('DE89370400440532013000')).not.toContain('expect_virtual_iban');
  });

  it('offers our own compliance screening on a clean, confirmed IBAN', () => {
    const s = steps('DE89370400440532013000');
    const hit = s.find((x) => x.code === 'screen_compliance');
    expect(hit).toBeDefined();
    expect(hit!.action).toBe('POST /v1/iban/compliance');
  });

  it('returns nothing at all for an IBAN that failed validation', () => {
    // The error already says what to do. Piling advice on top of a checksum
    // failure is noise an agent has to filter.
    expect(steps('DE00370400440532013000')).toEqual([]);
  });

  it('orders the blocking advice before the optional upsell', () => {
    const c = codes('DE44999999990532013000');
    const verify = c.indexOf('verify_payee_name');
    const screen = c.indexOf('screen_compliance');
    if (screen >= 0) expect(verify).toBeLessThan(screen);
  });

  describe('generate_payment_qr — partner handoff behind the PARTNER_PAYQR gate', () => {
    afterEach(() => {
      delete process.env.PARTNER_PAYQR;
    });

    it('stays silent while the flag is off, whatever the result', () => {
      expect(codes('DE89370400440532013000')).not.toContain('generate_payment_qr');
    });

    it('fires on a register-confirmed SEPA account once the flag is on', () => {
      process.env.PARTNER_PAYQR = '1';
      const hit = steps('DE89370400440532013000').find((s) => s.code === 'generate_payment_qr');
      expect(hit).toBeDefined();
      expect(hit!.because).toMatch(/sepa\.member/);
      expect(hit!.action).toBe('https://qr.cz-agents.dev');
      // The two limits the partner asked to keep in the copy must travel with it.
      expect(hit!.do).toMatch(/does not verify account ownership/);
      expect(hit!.do).toMatch(/Swiss QR-bills/);
    });

    it('never fires on CH or LI, whose native QR-bill PayQR does not cover', () => {
      process.env.PARTNER_PAYQR = '1';
      expect(codes('CH1000230000000012345')).not.toContain('generate_payment_qr');
    });

    it('never rides on a result where the register denied the code', () => {
      process.env.PARTNER_PAYQR = '1';
      expect(codes('DE44999999990532013000')).not.toContain('generate_payment_qr');
    });
  });

  it('always gives every step a code, a sentence and its evidence', () => {
    for (const iban of [
      'DE44999999990532013000',
      'CH8499999012345678901',
      'DE43100110010532013000',
      'DE89370400440532013000',
      'CH1000230000000012345',
    ]) {
      for (const s of steps(iban)) {
        expect(s.code, iban).toMatch(/^[a-z_]+$/);
        expect(s.do.length, iban).toBeGreaterThan(10);
        expect(s.because.length, iban).toBeGreaterThan(10);
      }
    }
  });
});

/**
 * `national_check_digits_failed` (26/09/2026) : une clé nationale fausse devient
 * une étape bloquante, au même rang que le contrôle britannique.
 *
 * Sur des résultats construits à la main, pour que le rang ne dépende d'aucune
 * donnée : le seul pays qui puisse à la fois refuser un code banque et porter une
 * clé nationale est la Belgique, dont le registre quitte la base publique avec le
 * retrait des données sous conditions. Le bout en bout, pays par pays, avec de
 * vrais exemples du registre IBAN dont la clé est faussée, est dans
 * `national-check/wiring.test.ts`.
 */
describe('national_check_digits_failed', () => {
  const COUNTRY_OF: Record<NationalCheckScheme, string> = {
    fr_rib_key: 'FR',
    be_mod97: 'BE',
    it_cin: 'IT',
    es_dc: 'ES',
  };
  const SCHEMES = Object.keys(COUNTRY_OF) as NationalCheckScheme[];

  function base(overrides: Partial<IBANValidationResult> = {}): IBANValidationResult {
    return {
      iban: 'XX00TEST',
      valid: true,
      country: { code: 'FR', name: 'France' },
      sepa: { member: true, schemes: ['SCT'], vop_required: true },
      cost_usdc: 0,
      ...overrides,
    };
  }
  function national(
    status: NationalCheck['status'],
    scheme: NationalCheckScheme = 'fr_rib_key',
  ): NationalCheck {
    return {
      country: COUNTRY_OF[scheme],
      scheme,
      status,
      ...(status === 'pass'
        ? {}
        : {
            detail:
              'The key does not match: this account number cannot have been issued as written.',
          }),
    };
  }
  const verified = {
    value: '30004',
    status: 'verified' as const,
    match: 'register' as const,
    register: 'Example register',
    authoritative: false,
    as_of: '2026-09',
  };
  const codesOf = (r: IBANValidationResult) => nextSteps(r).map((s) => s.code);

  it.each(SCHEMES)('%s: says stop, and names the field and the scheme', (scheme) => {
    const hits = nextSteps(base({ national_check_digits: national('fail', scheme) })).filter(
      (s) => s.code === 'national_check_digits_failed',
    );
    expect(hits).toHaveLength(1);
    const step = hits[0]!;
    expect(step.because).toBe(`national_check_digits.status is fail (${scheme})`);
    expect(step.do).toMatch(/^Do not send\. /);
    expect(step.do).toMatch(/cannot have been issued as written/);
    expect(step.do).toMatch(/Ask the beneficiary to confirm the account number\.$/);
    // Rien à appeler : c'est au bénéficiaire de confirmer, pas à une autre route.
    expect(step.action).toBeUndefined();
    expect(`${step.do} ${step.because}`).not.toContain('—');
  });

  it('changes nothing on pass, on not_applicable, or without the block', () => {
    for (const around of [base(), base({ bank_code_check: verified })]) {
      const without = nextSteps(around);
      expect(nextSteps({ ...around, national_check_digits: national('pass') })).toEqual(without);
      expect(nextSteps({ ...around, national_check_digits: national('not_applicable') })).toEqual(
        without,
      );
    }
  });

  it('comes right after a bank code the register denies', () => {
    const r = base({
      country: { code: 'BE', name: 'Belgium' },
      bank_code_check: {
        value: '999',
        status: 'not_in_register',
        match: null,
        reason: 'not_allocated',
        register: 'Example national register',
        authoritative: true,
        as_of: '2026-09',
      },
      national_check_digits: national('fail', 'be_mod97'),
    });
    expect(codesOf(r)).toEqual(['bank_code_not_allocated', 'national_check_digits_failed']);
  });

  it('comes after verify_payee_name, exactly as the UK check does', () => {
    const r = base({
      bank_code_check: {
        value: '99999',
        status: 'not_in_register',
        match: null,
        reason: 'absent_from_reference_data',
        register: null,
        authoritative: false,
        as_of: '2026-09',
      },
      national_check_digits: national('fail'),
    });
    expect(codesOf(r)).toEqual(['verify_payee_name', 'national_check_digits_failed']);
  });

  it('follows the UK check when both are set (never together in a real answer)', () => {
    const r = base({
      modulus_check: {
        checked: true,
        passed: false,
        source: 'Vocalink modulus weight table',
        table_fetched_on: '2026-09-01',
      },
      national_check_digits: national('fail'),
    });
    expect(codesOf(r)).toEqual(['modulus_check_failed', 'national_check_digits_failed']);
  });

  it('comes before every step that does not block, and removes none of them', () => {
    const r = base({
      bank_code_check: {
        ...verified,
        match: 'prefix',
        candidates: 3,
        retired: true,
        superseded_by: '30003',
      },
      issuer: {
        type: 'emi',
        name: 'Société Alpha',
        classification: 'curated',
        iban_issuer: 'not_listed',
      },
      risk_indicators: {
        issuer_type: 'emi',
        country_risk: 'standard',
        test_bic: true,
        sepa_reachable: true,
        sepa_reachable_scope: 'country',
        vop_coverage: true,
      },
      national_check_digits: national('fail'),
    });
    expect(codesOf(r)).toEqual([
      'national_check_digits_failed',
      'bank_code_retired',
      'bic_is_advisory',
      'test_bic',
      'expect_virtual_iban',
      'issuer_not_a_known_iban_issuer',
      'screen_compliance',
    ]);
  });

  it('never fires on an IBAN that failed validation', () => {
    expect(nextSteps(base({ valid: false, national_check_digits: national('fail') }))).toEqual([]);
  });
});

/**
 * La liste publiée des codes (OpenAPI, découverte x402) oubliait déjà
 * `modulus_check_failed`, sans que rien ne le voie. Chaque code que ce module
 * peut produire doit y être nommé : un code ajouté ici sans elle fait échouer ce
 * test.
 */
describe('the published list of step codes', () => {
  it('names every code this module can emit', () => {
    const src = readFileSync(new URL('./next-steps.ts', import.meta.url), 'utf8');
    const emitted = [...src.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(emitted).toContain('modulus_check_failed');
    expect(emitted).toContain('national_check_digits_failed');
    expect(new Set(emitted).size).toBe(emitted.length);
    const published = NEXT_STEPS_SCHEMA.items.properties.code.description;
    for (const code of emitted) expect(published, code).toContain(code);
  });
});
