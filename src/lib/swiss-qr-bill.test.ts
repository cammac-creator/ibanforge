import { describe, it, expect } from 'vitest';
import {
  checkSwissQrBill,
  splitPayload,
  COMBINED_ADDRESS_PROCESSING_STOPS,
} from './swiss-qr-bill.js';

const QR_IBAN = 'CH4431999123000889012'; // IID 31999, in the QR range
const IBAN = 'CH5800791123000889012'; // IID 00791, ordinary
const QRR = '210000000003139471430009017';
const RF = 'RF18539007547034';

interface Opts {
  iban?: string;
  creditor?: string[]; // 7 lines: type, name, l1, l2, pst, town, ctry
  ultimateCreditor?: string[];
  amount?: string;
  currency?: string;
  debtor?: string[];
  refType?: string;
  ref?: string;
  message?: string;
  trailer?: string;
  billing?: string;
  alt?: string[];
  version?: string;
}

function payload(o: Opts = {}): string {
  const cred = o.creditor ?? [
    'S',
    'Robert Schneider AG',
    'Rue du Lac',
    '1268',
    '2501',
    'Biel',
    'CH',
  ];
  const ult = o.ultimateCreditor ?? ['', '', '', '', '', '', ''];
  const dbt = o.debtor ?? [
    'S',
    'Pia-Maria Rutschmann-Schnyder',
    'Grosse Marktgasse',
    '28',
    '9400',
    'Rorschach',
    'CH',
  ];
  const lines = [
    'SPC',
    o.version ?? '0200',
    '1',
    o.iban ?? QR_IBAN,
    ...cred,
    ...ult,
    o.amount ?? '1949.75',
    o.currency ?? 'CHF',
    ...dbt,
    o.refType ?? 'QRR',
    o.ref ?? QRR,
    o.message ?? 'Order of 15 June 2026',
    o.trailer ?? 'EPD',
  ];
  if (o.billing !== undefined) lines.push(o.billing);
  if (o.alt) lines.push(...o.alt);
  return lines.join('\n');
}

describe('checkSwissQrBill', () => {
  it('accepts a conformant payload with structured addresses, a QR-IBAN and a QR reference', () => {
    const r = checkSwissQrBill(payload());
    expect(r.findings).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.ready_for_2026_11_14).toBe(true);
    expect(r.creditor_iban).toMatchObject({
      valid: true,
      country: 'CH',
      qr_iban: true,
      iid: '31999',
    });
    expect(r.creditor.structured).toBe(true);
    expect(r.creditor.sps_check?.conforms).toBe(true);
    expect(r.reference).toMatchObject({ type: 'QRR', valid: true });
    expect(r.amount).toBe('1949.75');
    expect(r.currency).toBe('CHF');
    expect(r.ultimate_debtor.present).toBe(true);
    expect(r.next_steps.join(' ')).toContain('/v1/iban/validate');
  });

  it('flags a combined (K) creditor address, proposes the structured fields, and is not ready for 14.11.2026', () => {
    const r = checkSwissQrBill(
      payload({
        creditor: ['K', 'Robert Schneider AG', 'Rue du Lac 1268', '2501 Biel', '', '', 'CH'],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.ready_for_2026_11_14).toBe(false);
    expect(r.creditor.structured).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('combined_address');
    expect(r.creditor.proposed_structured).toMatchObject({
      strt_nm: 'Rue du Lac',
      bldg_nb: '1268',
      pst_cd: '2501',
      twn_nm: 'Biel',
      ctry: 'CH',
      confidence: 'high',
    });
    expect(r.next_steps[0]).toContain(COMBINED_ADDRESS_PROCESSING_STOPS);
  });

  it('accepts an ordinary IBAN with SCOR and a valid RF reference, and with NON and no reference', () => {
    const scor = checkSwissQrBill(payload({ iban: IBAN, refType: 'SCOR', ref: RF }));
    expect(scor.findings).toEqual([]);
    expect(scor.creditor_iban.qr_iban).toBe(false);
    expect(scor.reference).toMatchObject({ type: 'SCOR', valid: true });
    const non = checkSwissQrBill(payload({ iban: IBAN, refType: 'NON', ref: '' }));
    expect(non.findings).toEqual([]);
  });

  it('enforces the QR-IBAN and reference-type pairing both ways', () => {
    const a = checkSwissQrBill(payload({ iban: IBAN })); // ordinary IBAN + QRR
    expect(a.findings.map((f) => f.code)).toContain('qrr_requires_qr_iban');
    const b = checkSwissQrBill(payload({ refType: 'SCOR', ref: RF })); // QR-IBAN + SCOR
    expect(b.findings.map((f) => f.code)).toContain('qr_iban_requires_qrr');
    const c = checkSwissQrBill(payload({ refType: 'NON', ref: '' })); // QR-IBAN + NON
    expect(c.findings.map((f) => f.code)).toContain('qr_iban_requires_qrr');
  });

  it('checks the reference checksums', () => {
    const bad = checkSwissQrBill(payload({ ref: '210000000003139471430009018' }));
    expect(bad.findings.map((f) => f.code)).toContain('qrr_reference_invalid');
    const badRf = checkSwissQrBill(
      payload({ iban: IBAN, refType: 'SCOR', ref: 'RF19539007547034' }),
    );
    expect(badRf.findings.map((f) => f.code)).toContain('scor_reference_invalid');
  });

  it('rejects wrong header lines, amount, currency, trailer, and a filled ultimate creditor', () => {
    const r = checkSwissQrBill(
      payload({
        version: '0100',
        amount: '1949,75',
        currency: 'USD',
        trailer: 'END',
        ultimateCreditor: ['S', 'Someone', '', '', '8000', 'Zurich', 'CH'],
      }),
    );
    const codes = r.findings.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'version_unsupported',
        'amount_invalid',
        'currency_invalid',
        'trailer_missing',
        'ultimate_creditor_not_allowed',
      ]),
    );
    expect(r.valid).toBe(false);
  });

  it('rejects a short payload and a wrong QR type without throwing', () => {
    const r = checkSwissQrBill('hello\nworld');
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['payload_too_short', 'qr_type_invalid']),
    );
  });

  it('accepts billing information and alternative schemes within their limits, and ignores CRLF', () => {
    const r = checkSwissQrBill(
      payload({ billing: '//S1/10/10201409/11/220101', alt: ['eBill/B/x'] }).replace(/\n/g, '\r\n'),
    );
    expect(r.findings).toEqual([]);
    expect(r.billing_information).toBe('//S1/10/10201409/11/220101');
    expect(r.alternative_schemes).toEqual(['eBill/B/x']);
    const bad = checkSwissQrBill(payload({ billing: 'S1/10/1' }));
    expect(bad.findings.map((f) => f.code)).toContain('billing_information_invalid');
  });

  it('flags a structured address that misses the town, with a sourced SPS finding', () => {
    const r = checkSwissQrBill(
      payload({ creditor: ['S', 'Robert Schneider AG', 'Rue du Lac', '1268', '2501', '', 'CH'] }),
    );
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('address_field_missing');
    expect(r.findings.some((f) => f.code.startsWith('sps_') && f.source.includes('SIX'))).toBe(
      true,
    );
  });

  it('splits CR, LF and CRLF payloads the same way', () => {
    expect(splitPayload('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
  });
});
