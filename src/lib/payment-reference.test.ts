import { describe, it, expect } from 'vitest';
import {
  REFERENCE_SCHEMES,
  REFERENCE_SOURCES,
  PAIRING_SOURCE,
  normalizeReference,
  detectSchemes,
  validatePaymentReference,
  buildReferenceCheck,
  rfCheckDigits,
  ogmCheckDigits,
  viitenumeroCheckDigit,
  mod10RecursiveCheckDigit,
} from './payment-reference.js';
import { validateIBAN } from './iban.js';

/**
 * Every vector below is copied from a primary source, never invented:
 *
 *  - the RF cases come from the Finance Finland note on ISO 11649 and from
 *    worked examples in the SIX QR-bill guidelines;
 *  - the QR references and the four Swiss IBANs are the paired examples of
 *    Annex A of the SIX QR-bill guidelines v2.4, which state the reference type
 *    beside each account, so the pairing tests are checking the guidelines
 *    against themselves;
 *  - `21000000000313947143000901` → `…7` is the worked example of Annex B;
 *  - the Belgian and Finnish vectors come from the Febelfin and Finance Finland
 *    documents cited in REFERENCE_SOURCES.
 */

describe('RF Creditor Reference (ISO 11649), mod 97-10', () => {
  it('accepts the reference vectors published with the algorithm', () => {
    for (const ref of ['RF18539007547034', 'RF4220210323103704APG0018', 'RF712348231']) {
      expect(validatePaymentReference(ref).valid, ref).toBe(true);
    }
  });

  it('rejects a tampered check digit and a tampered body', () => {
    // One digit changed at each end of the same reference: the checksum has to
    // catch both, or it is not doing the job the standard claims for it.
    expect(validatePaymentReference('RF18539007547035').valid).toBe(false);
    expect(validatePaymentReference('RF19539007547034').valid).toBe(false);
  });

  it('computes the check digits a body requires', () => {
    expect(rfCheckDigits('1234')).toBe('54');
    expect(validatePaymentReference('RF541234').valid).toBe(true);
    expect(validatePaymentReference('RF18539007547034').check_digit_expected).toBe('18');
  });

  it('accepts the printed form with spaces', () => {
    expect(validatePaymentReference('RF54 1234').valid).toBe(true);
    expect(validatePaymentReference('RF54 1234').reference).toBe('RF541234');
  });

  it('finds the SCOR example of the guidelines non-conformant to the rule they state', () => {
    // Annex A, Table 20, example 4 of the SIX QR-bill guidelines is labelled
    // "Reference type: SCOR" and carries this reference, while § 2.12.2 of the
    // same document requires mod 97-10. It is non-conformant to the rule that
    // the document itself states. Nothing more is claimed: a typo and a
    // deliberate placeholder cannot be told apart from the outside.
    const result = validatePaymentReference('RF720191230100405JSH0438');
    expect(result.scheme).toBe('rf');
    expect(result.valid).toBe(false);
  });
});

describe('Swiss QR reference, modulo 10 recursive', () => {
  it('reproduces the worked example of Annex B', () => {
    expect(mod10RecursiveCheckDigit('21000000000313947143000901')).toBe(7);
    expect(validatePaymentReference('210000000003139471430009017').valid).toBe(true);
  });

  it('accepts the other QR reference published in the guidelines', () => {
    expect(validatePaymentReference('000008207791225857421286694').valid).toBe(true);
  });

  it('rejects a wrong check digit and a wrong length', () => {
    expect(validatePaymentReference('210000000003139471430009018').valid).toBe(false);
    // 26 digits is the body, not the reference — it must not pass as a QRR.
    const short = validatePaymentReference('21000000000313947143000901');
    expect(short.scheme).not.toBe('qrr');
  });

  it('is recognised by its 27-digit length alone', () => {
    expect(detectSchemes('210000000003139471430009017')).toEqual(['qrr']);
  });
});

describe('Belgian OGM/VCS, modulo 97 with 0 written 97', () => {
  it('accepts the vector and rejects the tampered one', () => {
    expect(validatePaymentReference('010806817183', 'ogm').valid).toBe(true);
    expect(validatePaymentReference('010806817184', 'ogm').valid).toBe(false);
  });

  it('writes a zero remainder as 97, and pads a small one to two digits', () => {
    // The rule that makes OGM different from a plain mod 97, stated verbatim in
    // the Febelfin guidelines.
    expect(ogmCheckDigits('0000000097')).toBe('97');
    expect(ogmCheckDigits('0000000003')).toBe('03');
    // A string type is what keeps that leading zero alive.
    expect(typeof ogmCheckDigits('0000000003')).toBe('string');
  });

  it('accepts the +++…+++ printed form and strips it', () => {
    expect(normalizeReference('+++010/8068/17183+++')).toBe('010806817183');
    expect(validatePaymentReference('+++010/8068/17183+++', 'ogm').valid).toBe(true);
  });
});

describe('Finnish viitenumero, weights 7-3-1 from the right', () => {
  it('reproduces the published worked example', () => {
    expect(viitenumeroCheckDigit('123456')).toBe(1);
    expect(validatePaymentReference('1234561').valid).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(validatePaymentReference('1234562').valid).toBe(false);
  });

  it('covers the whole published length range', () => {
    expect(detectSchemes('1234')).toContain('viitenumero');
    expect(detectSchemes('12345678901234567890')).toContain('viitenumero');
    expect(detectSchemes('123')).not.toContain('viitenumero');
    expect(detectSchemes('123456789012345678901')).not.toContain('viitenumero');
  });
});

describe('Norwegian KID and Swedish OCR are recognised, never judged', () => {
  it('answers valid: null rather than a false negative', () => {
    for (const scheme of ['kid', 'ocr'] as const) {
      const result = validatePaymentReference('12345678', scheme);
      expect(result.scheme, scheme).toBe(scheme);
      // The whole point: a bank-configured rule cannot produce an arithmetic
      // verdict, and pretending otherwise would reject good references.
      expect(result.valid, scheme).toBeNull();
      expect(result.valid, scheme).not.toBe(false);
      expect(result.status, scheme).toBe('unverifiable_without_creditor_config');
      expect(result.note, scheme).toMatch(/configured per creditor account/);
    }
  });

  it('still names the document behind the claim', () => {
    expect(validatePaymentReference('12345678', 'kid').source).toMatch(/Bits AS/);
    expect(validatePaymentReference('12345678', 'ocr').source).toMatch(/Bankgirot/);
  });

  it('does not tell the caller their KID "looks like" another scheme', () => {
    // The detector structurally never proposes kid or ocr, so an unguarded
    // "your string looks like X, not the Y you asked for" fired on EVERY
    // ordinary KID lookup — an artefact of the candidate list presented as a
    // fact about the string, sitting right beside the sentence this feature
    // exists to state honestly.
    for (const scheme of ['kid', 'ocr'] as const) {
      const note = validatePaymentReference('12345678', scheme).note;
      expect(note, scheme).not.toMatch(/looks like/i);
      expect(note, scheme).not.toMatch(/VIITENUMERO|OGM|QRR/);
    }
  });

  it('keeps the contradiction warning where it is a real contradiction', () => {
    // The guard must not silence the honest case: RF is detectable, so asking
    // for QRR on an RF string is a genuine disagreement worth reporting.
    expect(validatePaymentReference('RF18539007547034', 'qrr').note).toMatch(/looks like RF/);
  });
});

describe('scheme detection and its ambiguities', () => {
  it('pins RF and the 27-digit length, which are the only unambiguous signals', () => {
    expect(detectSchemes('RF18539007547034')).toEqual(['rf']);
    expect(detectSchemes('210000000003139471430009017')).toEqual(['qrr']);
  });

  it('reports the Finnish reading of a 12-digit string instead of discarding it', () => {
    // 12 digits IS the Belgian definition but is merely one legal Finnish
    // length. Answering only "OGM, invalid" on a good Finnish reference is the
    // exact false-negative this test exists to prevent.
    const result = validatePaymentReference('010806817183');
    expect(result.scheme).toBe('ogm');
    expect(result.also_valid_as?.scheme).toBe('viitenumero');
    expect(result.note).toMatch(/also a legal length/);
  });

  it('reports a VALID Finnish reading behind an invalid OGM verdict', () => {
    // The asymmetric direction, and the dangerous one: a caller reading only
    // `valid` on a good Finnish reference of twelve digits gets "false".
    // `also_valid_as` is the field that stops that being the whole story.
    const body = '01080681718';
    const fi = body + String(viitenumeroCheckDigit(body));
    expect(fi).toHaveLength(12);
    const result = validatePaymentReference(fi);
    expect(result.scheme).toBe('ogm');
    expect(result.valid).toBe(false);
    expect(result.also_valid_as).toEqual({
      scheme: 'viitenumero',
      valid: true,
      check_digit_expected: fi[11],
    });
    expect(result.note).toMatch(/checks out as valid/);
  });

  it('obeys an explicit type but says when it contradicts the string', () => {
    const result = validatePaymentReference('010806817183', 'viitenumero');
    expect(result.scheme).toBe('viitenumero');
    const contradicted = validatePaymentReference('RF18539007547034', 'qrr');
    expect(contradicted.scheme).toBe('qrr');
    expect(contradicted.note).toMatch(/looks like RF/);
  });

  it('returns a null scheme rather than guessing on an unrecognised string', () => {
    const result = validatePaymentReference('ZZ!!');
    expect(result.scheme).toBeNull();
    expect(result.valid).toBeNull();
    expect(result.status).toBe('unrecognised');
  });
});

describe('the provenance contract — a block without a source is red', () => {
  it('gives every scheme a dated document, derived from the scheme list itself', () => {
    // Iterating REFERENCE_SCHEMES rather than a list written here is what makes
    // this test catch a seventh scheme added without a source.
    for (const scheme of REFERENCE_SCHEMES) {
      const provenance = REFERENCE_SOURCES[scheme];
      expect(provenance, scheme).toBeDefined();
      expect(provenance.source.length, scheme).toBeGreaterThan(40);
      // House convention: YYYY-MM, and it dates the DOCUMENT.
      expect(provenance.as_of, scheme).toMatch(/^\d{4}-\d{2}$/);
      // A future date here would mean data from the future. The SIX guidelines
      // are dated February 2026 and only become binding in November 2026.
      expect(provenance.as_of <= '2026-08', scheme).toBe(true);
    }
  });

  it('gives the pairing rule its own document, not the checksum one', () => {
    expect(PAIRING_SOURCE.source).toMatch(/Credit Transfer/);
    expect(PAIRING_SOURCE.as_of).toMatch(/^\d{4}-\d{2}$/);
    expect(PAIRING_SOURCE.source).not.toBe(REFERENCE_SOURCES.qrr.source);
  });

  it('ships a source on every served verdict that names a scheme', () => {
    const cases: Array<[string, string | undefined]> = [
      ['RF18539007547034', undefined],
      ['210000000003139471430009017', undefined],
      ['010806817183', undefined],
      ['1234561', undefined],
      ['12345678', 'kid'],
      ['12345678', 'ocr'],
    ];
    for (const [ref, type] of cases) {
      const result = validatePaymentReference(ref, type);
      expect(result.scheme, ref).not.toBeNull();
      expect(result.source, ref).toBeTruthy();
      expect(result.as_of, ref).toMatch(/^\d{4}-\d{2}$/);
      expect(result.note.length, ref).toBeGreaterThan(20);
    }
  });

  it('carries no source exactly when no rule was applied', () => {
    const result = validatePaymentReference('ZZ!!');
    expect(result.scheme).toBeNull();
    expect(result.source).toBeNull();
  });
});

/**
 * The pairing verdict — the part a checksum library cannot reproduce, because it
 * needs the SIX QR-IID allocation range.
 *
 * The four Swiss IBANs and the reference beside each one are the paired examples
 * of Annex A of the QR-bill guidelines.
 */
describe('QRR / SCOR pairing against a Swiss account', () => {
  const QR_IBAN = 'CH4431999123000889012'; // IID 31999 — in the QR range
  const QR_IBAN_2 = 'CH6431961000004421557'; // IID 31961 — in the QR range
  const ORDINARY_IBAN = 'CH5204835012345671000'; // IID 04835 — outside it
  const ORDINARY_IBAN_2 = 'CH5800791123000889012'; // IID 00791 — outside it
  const QRR = '210000000003139471430009017';

  const check = (iban: string, reference: string, type?: string) =>
    buildReferenceCheck(validateIBAN(iban), reference, type);

  it('accepts a QRR on the QR-IBAN the guidelines pair it with', () => {
    const block = check(QR_IBAN, QRR);
    expect(block.scheme).toBe('qrr');
    expect(block.valid).toBe(true);
    expect(block.pairing).toBe('ok');
    expect(block.pairing_source).toMatch(/Credit Transfer/);
  });

  it('refuses a QRR on an ordinary IBAN', () => {
    const block = check(ORDINARY_IBAN, QRR);
    expect(block.valid).toBe(true); // the reference itself is fine…
    expect(block.pairing).toBe('qrr_requires_qr_iban'); // …the combination is not
    expect(block.note).toMatch(/Swiss Implementation Guidelines \(SPS\)/);
  });

  it('refuses an ISO 11649 reference on a QR-IBAN', () => {
    const block = check(QR_IBAN_2, 'RF18539007547034');
    expect(block.scheme).toBe('rf');
    expect(block.valid).toBe(true);
    expect(block.pairing).toBe('scor_forbidden_with_qr_iban');
  });

  it('accepts an ISO 11649 reference on an ordinary Swiss IBAN', () => {
    const block = check(ORDINARY_IBAN, 'RF18539007547034');
    expect(block.pairing).toBe('ok');
  });

  it('keeps the checksum verdict and the pairing verdict independent', () => {
    // The guidelines' own SCOR example: the reference fails the rule the
    // document states, while the account it is printed against is the right
    // KIND of account for a SCOR reference. Two verdicts, two answers.
    const block = check(ORDINARY_IBAN_2, 'RF720191230100405JSH0438');
    expect(block.valid).toBe(false);
    expect(block.pairing).toBe('ok');
  });

  it('honours an explicit reference_type', () => {
    expect(check(QR_IBAN, QRR, 'qrr').pairing).toBe('ok');
    // SCOR is the Swiss Payment Standards code for an ISO 11649 reference.
    expect(check(QR_IBAN, 'RF18539007547034', 'scor').pairing).toBe('scor_forbidden_with_qr_iban');
  });

  it('reads the QR range from the BBAN, not from the register', () => {
    // A QR-IID row absent from the shipped BankMaster must still be recognised:
    // the rule is a numeric range, and depending on a lookup would make the
    // verdict vary with the monthly refresh.
    const block = check(QR_IBAN, QRR);
    expect(block.pairing).toBe('ok');
    expect(validateIBAN(QR_IBAN).bban?.bank_code).toBe('31999');
  });
});

describe('pairing outside Switzerland', () => {
  it('is not_applicable for a QRR on a German IBAN', () => {
    const block = buildReferenceCheck(validateIBAN('DE89370400440532013000'), '210000000003139471430009017');
    expect(block.pairing).toBe('not_applicable');
    expect(block.note).toMatch(/Swiss Payment Standards rule/);
  });

  it('is not_applicable for an RF reference too, while the checksum still stands', () => {
    // "RF is valid everywhere" is a statement about the CHECKSUM. The pairing
    // rule cited here is Swiss, so claiming "ok" abroad would assert a check
    // that was never run.
    const block = buildReferenceCheck(validateIBAN('DE89370400440532013000'), 'RF18539007547034');
    expect(block.valid).toBe(true);
    expect(block.pairing).toBe('not_applicable');
    expect(block.source).toMatch(/Finance Finland/);
  });

  it('is not_applicable for a scheme the Swiss rule does not cover', () => {
    const block = buildReferenceCheck(validateIBAN('CH5204835012345671000'), '1234561');
    expect(block.scheme).toBe('viitenumero');
    expect(block.pairing).toBe('not_applicable');
    expect(block.note).toMatch(/covers QRR and SCOR/);
  });

  it('never invents a CH16 or CH17 wording', () => {
    // The codes appear in a column of the guidelines; their wording lives in a
    // status-report document that was not consulted. The block refers to the
    // guidelines without quoting a label.
    const block = buildReferenceCheck(validateIBAN('CH5204835012345671000'), '210000000003139471430009017');
    expect(block.note).not.toMatch(/CH1[67]/);
    expect(JSON.stringify(block)).not.toMatch(/CH1[67]/);
  });
});
