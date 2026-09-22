import { describe, it, expect } from 'vitest';
import { enrichResult, isTestBic } from './enrich.js';
import { validateIBAN } from './iban.js';
import type { IBANValidationResult } from '../types.js';

describe('enrichResult', () => {
  it('enriches a valid CH IBAN with sepa, issuer, risk_indicators', () => {
    const result = validateIBAN('CH5604835012345678009');
    enrichResult(result);

    // The BIC is the SIX BankMaster's own, for the IID the register redirects
    // this one to — and the response no longer names two banks for one account:
    // bank_code_check already said "UBS Switzerland AG" while the BIC beside it
    // still read CRESCHZZ.
    expect(result.bic!.code).toBe('UBSWCHZH80A');
    expect(result.bic!.bic8).toBe('UBSWCHZH');
    expect(result.bic!.bank_name).toBe('UBS Switzerland AG');
    expect(result.bic!.basis).toBe('national_register');
    expect(result.bic!.authoritative).toBe(true);
    // The IID that was asked about stays visible; a redirect is not a
    // retirement, so nothing here withdraws the settlement licence.
    expect(result.bic!.redirected_from).toBe('04835');
    expect(result.bank_code_check!.retired).toBeUndefined();

    expect(result.sepa).toBeDefined();
    expect(result.sepa!.member).toBe(true);
    expect(result.sepa!.vop_required).toBe(false); // CH not EU

    expect(result.risk_indicators).toBeDefined();
    expect(result.risk_indicators!.country_risk).toBe('standard');
    expect(result.risk_indicators!.sepa_reachable).toBe(true);
    expect(result.risk_indicators!.vop_coverage).toBe(false);
  });

  it('enriches a valid DE IBAN with eurozone data', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);

    expect(result.sepa!.schemes).toContain('SCT_INST');
    expect(result.sepa!.vop_required).toBe(true);
    expect(result.risk_indicators!.vop_coverage).toBe(true);
  });

  describe('bic.lei / bic.address — the directory fields validate used to drop', () => {
    it('serves the LEI off the same row /v1/bic/:code reads', () => {
      const result = validateIBAN('DE89370400440532013000');
      enrichResult(result);

      expect(result.bic!.lei).toMatch(/^[A-Z0-9]{20}$/);
      expect(result.bic!.lei_status).toBeTruthy();
    });

    it('never serves an address without its own source and date', () => {
      // The address is entity-level GLEIF data whose freshness is unrelated to
      // the monthly BIC refresh beside it. Undated, it reads as current.
      const result = validateIBAN('DE89370400440532013000');
      enrichResult(result);

      const addr = result.bic!.address!;
      expect(addr.source).toBeTruthy();
      expect(addr.as_of).toBeTruthy();
      expect(addr.type).toBe('registered');
    });

    it('stamps the address with the SEAT country, not the IBAN country', () => {
      // FR bank code 11668 resolves to BERLMCMC — Edmond de Rothschild,
      // seated in MONACO. The address block used to inherit the caller's
      // IBAN country ('FR'), so a Monegasque street went out labelled FR
      // while /v1/bic/BERLMCMC labelled the same row MC. The address block
      // must locate the address it carries.
      const result = validateIBAN('FR5211668000010000000010147');
      enrichResult(result);

      expect(result.bic!.code).toBe('BERLMCMCXXX');
      expect(result.bic!.bic8).toBe('BERLMCMC');
      expect(result.bic!.address!.country).toBe('MC');
    });

    it('lets the register city and the registered seat disagree', () => {
      // BLZ 37040044 is Commerzbank in Köln; the legal entity is seated in
      // Frankfurt. Both are true and answer different questions, so this test
      // pins that we do NOT quietly overwrite one with the other.
      const result = validateIBAN('DE89370400440532013000');
      enrichResult(result);

      expect(result.bic!.city).toBe('Köln');
      expect(result.bic!.address!.city).toBe('Frankfurt am Main');
    });

    it('never lets a branch BIC inherit the head office address or LEI', () => {
      // BLZ 10010424 is Aareal Bank's Berlin branch, BIC AARBDE5W100; the head
      // office AARBDE5WXXX carries "Paulinenstraße 15, Wiesbaden" and a LEI.
      // Serving those beside bank_name would state the branch is registered at
      // an address it is not — the same institution-confusion that cost this
      // API a German integrator over Sparkassen BIC8s, one field lower.
      //
      // Safe today because the seed-time guard leaves branch rows without a
      // street. Pinned here because the failure would be silent: any future
      // BIC8 fallback in the lookup would resolve the head-office row instead.
      const result = validateIBAN('DE24100104240532013000');
      enrichResult(result);

      expect(result.bic!.code).toBe('AARBDE5W100');
      expect(result.bic!.lei ?? null).toBeNull();
      expect(result.bic!.address ?? null).toBeNull();
    });

    it('keeps the register LEI and the directory LEI as separate claims', () => {
      // Austria is the only country where both are populated: the OeNB names
      // the holder of the bank code, GLEIF names the entity behind the resolved
      // BIC. They agree here, and the test asserts the register's value is not
      // dropped when the directory also has one — a caller who wants the
      // authority on the code they asked about needs it to still be there.
      const result = validateIBAN('AT580010000234573201');
      enrichResult(result);

      const registerLei = result.bank_code_check?.institution?.lei;
      expect(registerLei).toMatch(/^[A-Z0-9]{20}$/);
      expect(result.bic!.lei).toMatch(/^[A-Z0-9]{20}$/);
    });

    it('leaves lei and address absent rather than empty when the BIC is unresolved', () => {
      // A country with no reference data must not gain a hollow address block:
      // `{street: null, ...}` reads as "we looked and the bank has none".
      const result = validateIBAN('MT84MALT011000012345MTLCAST001S');
      enrichResult(result);

      if (!result.bic?.code) {
        expect(result.bic?.lei ?? null).toBeNull();
        expect(result.bic?.address ?? null).toBeNull();
      }
    });
  });

  /**
   * The branch code is not decoration, and cutting it off named the wrong bank.
   *
   * Until 22/09/2026 every Swiss answer came from the curated map truncated to
   * eight characters, and the three characters thrown away are the ones that
   * identify the institution inside a cooperative network: IID 30020 is Crédit
   * Mutuel de la Vallée SA (RBABCH22180) while RBABCH22 alone is Entris Banking
   * AG, its clearing institution — a different legal entity with a different
   * LEI. The SIX BankMaster publishes the exact 11-character BIC per IID, so it
   * is read here the way the Bundesbank register is read for Germany.
   *
   * Every IBAN below is fabricated on a real, public bank code with a correct
   * mod-97 check digit. None of them is an account.
   */
  describe('CH/LI — the BIC comes from the SIX register, branch code included', () => {
    function enriched(iban: string) {
      const r = validateIBAN(iban);
      expect(r.valid, `${iban} must be mod-97 valid`).toBe(true);
      enrichResult(r);
      return r;
    }

    it('serves the register BIC11 for a branch IID, not its clearing institution', () => {
      // IID 00258 is a UBS branch; the register writes UBSWCHZH56B.
      const r = enriched('CH3600258000000000001');
      expect(r.bic!.code).toBe('UBSWCHZH56B');
      expect(r.bic!.bic8).toBe('UBSWCHZH');
      expect(r.bic!.basis).toBe('national_register');
      expect(r.bic!.authoritative).toBe(true);
      expect(r.bic!.source).toContain('SIX');
    });

    it('serves the head-office IID under its own 11-character BIC', () => {
      const r = enriched('CH0600230000000000001');
      expect(r.bic!.code).toBe('UBSWCHZH80A');
      expect(r.bic!.bic8).toBe('UBSWCHZH');
      expect(r.bic!.basis).toBe('national_register');
    });

    it('names the local bank of a cooperative network, not its central institution', () => {
      // This is the whole point: the first eight characters name Entris Banking
      // AG, and the account is held by the bank the register names here.
      const r = enriched('CH9430020000000000001');
      expect(r.bic!.code).toBe('RBABCH22180');
      expect(r.bic!.bic8).toBe('RBABCH22');
      expect(r.bic!.bank_name).toBe('Crédit Mutuel de la Vallée SA');
      expect(r.bic!.basis).toBe('national_register');
    });

    it('reaches an IID the curated map never carried', () => {
      // 30010 is in BankMaster and absent from bic_data.json, so before the
      // register was read for the BIC this IBAN answered bic: null.
      const r = enriched('CH1430010000000000001');
      expect(r.bic!.code).toBeTruthy();
      expect(r.bic!.code!.length).toBe(11);
      expect(r.bic!.basis).toBe('national_register');
    });

    it('declines rather than manufactures when the register publishes no BIC', () => {
      // IID 08351 is allocated and carries no BIC in BankMaster, and the
      // curated map holds no key for it. The honest pair is a verified bank
      // code beside bic: null — never a BIC invented from the bank code.
      const r = enriched('CH8108351000000000001');
      expect(r.bic).toBeNull();
      expect(r.bank_code_check!.status).toBe('verified');
      expect(r.bank_code_check!.authoritative).toBe(true);
    });

    it('takes the postal address from the SIX seat of the branch, not of the head office', () => {
      // The register publishes street and building number apart, per IID. The
      // head office sits in Zürich; this row does not, and the ISO 20022 block
      // must locate the institution the BIC names.
      const r = enriched('CH3600258000000000001');
      const postal = (r.bic as unknown as { postal_address?: { twn_nm: string; source: string } })
        .postal_address;
      expect(postal).toBeDefined();
      expect(postal!.twn_nm).toBe('Wohlen AG 1');
      expect(postal!.source).toContain('SIX');
    });

    it('covers Liechtenstein on the same register', () => {
      const r = enriched('LI8008810000000000001');
      expect(r.bic!.basis).toBe('national_register');
      expect(r.bic!.bic8).toBe(r.bic!.code!.slice(0, 8));
      expect(r.bic!.source).toContain('SIX');
    });
  });

  /**
   * `bic8` is served for every country and every basis, because it is the field
   * a caller is told to compare a supplied BIC against. `code` is now 8 or 11
   * characters depending on what the consulted source publishes, so a contract
   * that only carried `code` forced the caller to slice it themselves — and the
   * ones who did not sliced a mismatch out of a correct BIC.
   */
  describe('bic.bic8 — the one field whose length never moves', () => {
    function bicOf(iban: string) {
      const r = validateIBAN(iban);
      expect(r.valid, `${iban} must be mod-97 valid`).toBe(true);
      enrichResult(r);
      return r.bic;
    }

    it('rides on a curated-map pairing that carries a real branch code (ES)', () => {
      // ES 2045 is written CECAESMM045, Caja de Ahorros de Ontinyent. CECAESMM
      // alone is Cecabank, the clearing institution — a different bank.
      const bic = bicOf('ES7620450000000000000000');
      expect(bic!.code).toBe('CECAESMM045');
      expect(bic!.bic8).toBe('CECAESMM');
      expect(bic!.basis).toBe('curated_map');
      expect(bic!.authoritative).toBe(false);
    });

    it('does the same one country over (IT)', () => {
      // ABI 08095 is CCRTIT2TBCE, Banca Centro Emilia; CCRTIT2T alone is Cassa
      // Centrale Banca.
      const bic = bicOf('IT12X0809500000000000000001');
      expect(bic!.code).toBe('CCRTIT2TBCE');
      expect(bic!.bic8).toBe('CCRTIT2T');
      expect(bic!.basis).toBe('curated_map');
    });

    it('leaves the German register answer untouched', () => {
      // The Bundesbank path already served the exact 11-character BIC; nothing
      // about it changes except that bic8 is now stated rather than implied.
      const bic = bicOf('DE18553500100000000001');
      expect(bic!.code).toBe('MALADE51WOR');
      expect(bic!.bic8).toBe('MALADE51');
      expect(bic!.basis).toBe('national_register');
      expect(bic!.authoritative).toBe(true);
    });

    it('is present on a code the prefix fallback resolved', () => {
      // The weakest basis of the three still has to carry the field, or a
      // caller branching on bic8 would silently skip the case where comparing
      // matters most.
      const bic = bicOf('GB55AUGT00000000000001');
      expect(bic!.basis).toBe('directory_prefix');
      expect(bic!.bic8).toBe(bic!.code!.slice(0, 8));
      expect(bic!.bic8!.length).toBe(8);
    });
  });

  describe('sepa.vop_participant (bank-level EPC VoP readiness)', () => {
    it('is a boolean when an institution was resolved', () => {
      // Not pinned to a specific bank being "ready": the EPC register is
      // refreshed weekly and banks join it — only the CONTRACT is stable
      // (resolved institution → boolean, never undefined/null).
      const result = validateIBAN('DE89370400440532013000');
      enrichResult(result);
      expect(result.bic?.code).toBeTruthy();
      expect(typeof result.sepa!.vop_participant).toBe('boolean');
    });

    it('is null when no institution was resolved — no subject, no claim', () => {
      // NL IBAN on a bank code that resolves no BIC in the composite map.
      const result = validateIBAN('NL51ZZZZ0123456789');
      enrichResult(result);
      if (result.bic?.code) return; // guard: dataset drift would void the premise
      expect(result.sepa!.vop_participant).toBeNull();
    });
  });

  it('does not enrich invalid IBANs', () => {
    const result = validateIBAN('INVALID');
    enrichResult(result);

    expect(result.bic).toBeUndefined();
    expect(result.issuer).toBeUndefined();
    expect(result.risk_indicators).toBeUndefined();
  });

  it('sets issuer to bank by default when BIC is found but not in EMI list', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);

    if (result.bic) {
      expect(result.issuer).toBeDefined();
      expect(result.issuer!.type).toBe('bank');
    }
  });

  it('populates risk_indicators even when BIC is not found', () => {
    // Use a valid IBAN where BIC may not resolve
    const result: IBANValidationResult = {
      iban: 'BR1800360305000010009795493C1',
      valid: true,
      country: { code: 'BR', name: 'Brazil' },
      check_digits: '18',
      bban: { bank_code: '00360305', account_number: '0010009795493C1' },
      sepa: { member: false, schemes: [], vop_required: false },
      cost_usdc: 0.005,
    };
    enrichResult(result);

    expect(result.risk_indicators).toBeDefined();
    // Was 'bank'. That default typed an institution the lookup had not found,
    // and a caller could not tell it apart from a genuine bank — see
    // bank-code-check.test.ts. The honest answer for an unresolved bank code is
    // no answer.
    expect(result.risk_indicators!.issuer_type).toBeNull();
    expect(result.risk_indicators!.sepa_reachable).toBe(false);
  });

  // Swiss clearing enrichment tests

  it('enriches a valid CH IBAN with clearing data', () => {
    const result = validateIBAN('CH5604835012345678009');
    enrichResult(result);

    expect(result.clearing).toBeDefined();
    // 04835 (ex-Credit Suisse) now concatenates to UBS's 00230 after the merger.
    expect(result.clearing!.iid).toBe('00230');
    expect(typeof result.clearing!.sic).toBe('boolean');
    expect(typeof result.clearing!.instant_payments_chf).toBe('boolean');
    expect(typeof result.clearing!.eurosic).toBe('boolean');
  });

  it('DE IBAN does NOT get clearing field', () => {
    const result = validateIBAN('DE89370400440532013000');
    enrichResult(result);

    expect(result.clearing).toBeUndefined();
  });

  it('invalid CH IBAN does NOT get clearing field', () => {
    const result = validateIBAN('CH5604835012345678000'); // bad checksum
    enrichResult(result);

    expect(result.clearing).toBeUndefined();
  });

  it('CH IBAN with known bank_code gets correct institution type', () => {
    // CH5604835012345678009 has bank_code '04835'
    const result = validateIBAN('CH5604835012345678009');
    enrichResult(result);

    if (result.clearing) {
      expect([
        'bank',
        'cantonal_bank',
        'postfinance',
        'raiffeisen',
        'central_bank',
        'foreign_participant',
      ]).toContain(result.clearing.type);
    }
  });

  // Regression: test_bic was previously hardcoded to false in enrich.ts,
  // silently disabling the +30 risk score penalty for test BICs in
  // compliance.calculateRiskScore.
  describe('isTestBic (ISO 9362 §5.3 — location code[1] === "0")', () => {
    it('false for a production BIC', () => {
      expect(isTestBic('COBADEFFXXX')).toBe(false);
      expect(isTestBic('UBSWCHZH')).toBe(false);
    });

    it('true when location code second char is "0"', () => {
      expect(isTestBic('MARKDE50')).toBe(true);
      expect(isTestBic('TESTUS60XXX')).toBe(true);
    });

    it('false for empty, undefined, or too-short input', () => {
      expect(isTestBic(undefined)).toBe(false);
      expect(isTestBic(null)).toBe(false);
      expect(isTestBic('')).toBe(false);
      expect(isTestBic('SHORT')).toBe(false);
    });

    it('enrichResult uses isTestBic for real IBANs (non-test production path)', () => {
      const result = validateIBAN('DE89370400440532013000');
      enrichResult(result);
      expect(result.risk_indicators?.test_bic).toBe(false);
    });
  });
});
