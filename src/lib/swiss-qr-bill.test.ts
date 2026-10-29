import { describe, it, expect } from 'vitest';
import {
  checkSwissQrBill,
  isQrBillCharacter,
  splitPayload,
  COMBINED_ADDRESS_NOTICE,
  COMBINED_ADDRESS_SOURCE,
  QR_BILL_CHARSET_SOURCE,
  QR_BILL_IG24_SOURCE,
  QR_BILL_SOURCE,
} from './swiss-qr-bill.js';

const QR_IBAN = 'CH4431999123000889012'; // IID 31999, in the QR range
// Invisible or combining characters, built from their code points so that the
// source carries none of them.
const BOM = String.fromCodePoint(0xfeff);
const DIAERESIS = String.fromCodePoint(0x308);
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

  it('flags a combined (K) creditor address, proposes the structured fields, and is not ready', () => {
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
    // The dates a bank actually published, never the payment-order date of
    // 14.11.2026 sold as the day banks stop paying a type K QR-bill.
    const finding = r.findings.find((f) => f.code === 'combined_address');
    expect(finding?.detail).toBe(COMBINED_ADDRESS_NOTICE.en);
    expect(finding?.source).toBe(COMBINED_ADDRESS_SOURCE);
    expect(r.next_steps[0]).toContain('type S');
    expect(r.next_steps[0]).toContain('end of September 2026');
    expect(r.next_steps[0]).not.toMatch(/2026-11-14|14\.11\.2026/);
    // That guarantee ended on 30.09.2026: the step says it in the past tense
    // (29.10.2026), never as a guarantee still running.
    expect(r.next_steps[0]).toContain('the banks guaranteed payment of a type K QR-bill');
    expect(r.next_steps[0]).not.toContain('the banks guarantee payment');
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

/**
 * Version 2.4 of the guidelines (24.02.2026, valid from 14 November 2026)
 * keeps the QR-IBAN and the QR reference for CHF (ch. 2.10, 2.12.1, 4.3.2).
 * Version 2.3 has no such rule and remains valid until November 2027, so the
 * finding is a warning: `valid` and `ready_for_2026_11_14` stay as they were.
 */
describe('QR-IBAN and QR reference in EUR (guidelines 2.4)', () => {
  const codes = (r: ReturnType<typeof checkSwissQrBill>) => r.findings.map((f) => f.code);

  it('warns on an invoice in EUR to a QR-IBAN with a QR reference, and changes no verdict', () => {
    const r = checkSwissQrBill(payload({ currency: 'EUR' }));
    expect(r.findings).toHaveLength(1);
    const [f] = r.findings;
    expect(f).toMatchObject({
      code: 'qr_iban_chf_only_ig24',
      severity: 'warning',
      field: 'currency',
      source: QR_BILL_IG24_SOURCE,
    });
    expect(f!.detail).toContain('version 2.4 (valid from 14.11.2026)');
    expect(f!.detail).toContain('remains valid until November 2027');
    expect(r.valid).toBe(true);
    expect(r.ready_for_2026_11_14).toBe(true);
    // The rest of the response keeps the 2.3 source its rules were checked against.
    expect(r.source).toBe(QR_BILL_SOURCE);
  });

  it('cites the document, its date, its validity and the version still in force', () => {
    for (const needle of [
      'version 2.4 of 24.02.2026',
      'valid from 14 November 2026',
      'ig-qr-bill-v2.4-en.pdf',
      'read 29.10.2026',
      'ch. 2.10, 2.12.1 and 4.3.2',
      'Version 2.3 remains valid until November 2027',
    ])
      expect(QR_BILL_IG24_SOURCE).toContain(needle);
  });

  it('says nothing new in EUR with an ordinary IBAN and SCOR, or without a reference', () => {
    expect(
      checkSwissQrBill(payload({ iban: IBAN, currency: 'EUR', refType: 'SCOR', ref: RF })).findings,
    ).toEqual([]);
    expect(
      checkSwissQrBill(payload({ iban: IBAN, currency: 'EUR', refType: 'NON', ref: '' })).findings,
    ).toEqual([]);
  });

  it('says nothing new in CHF with a QR-IBAN and a QR reference', () => {
    expect(codes(checkSwissQrBill(payload()))).toEqual([]);
  });

  it('warns on a QR reference in EUR even beside an ordinary IBAN, next to the error already there', () => {
    const r = checkSwissQrBill(payload({ iban: IBAN, currency: 'EUR' }));
    expect(codes(r)).toEqual(
      expect.arrayContaining(['qrr_requires_qr_iban', 'qr_iban_chf_only_ig24']),
    );
  });

  it.each([
    ['SCOR', RF],
    ['NON', ''],
  ])(
    'warns on a QR-IBAN in EUR with reference type %s; valid stays false from the 2.3 error alone',
    (refType, ref) => {
      const eur = checkSwissQrBill(payload({ currency: 'EUR', refType, ref }));
      expect(eur.findings.map((f) => [f.code, f.severity])).toEqual([
        ['qr_iban_requires_qrr', 'error'],
        ['qr_iban_chf_only_ig24', 'warning'],
      ]);
      expect(eur.valid).toBe(false);
      // In CHF, the same payload keeps the error and loses the warning: the
      // warning is not what turns `valid` false.
      const chf = checkSwissQrBill(payload({ currency: 'CHF', refType, ref }));
      expect(codes(chf)).toEqual(['qr_iban_requires_qrr']);
      expect(chf.valid).toBe(false);
    },
  );
});

/**
 * Ch. 4.1.1, the same in version 2.3 (in force since 21 November 2025) and in
 * version 2.4: an error, which turns `valid` and `ready_for_2026_11_14` false.
 */
describe('the character set (ch. 4.1.1)', () => {
  const charset = (r: ReturnType<typeof checkSwissQrBill>) =>
    r.findings.filter((f) => f.code === 'character_not_permitted');

  it('names the field and the code point of an emoji, never the character itself', () => {
    const r = checkSwissQrBill(payload({ message: 'Order of 15 June 2026 \u{1F600}' }));
    const found = charset(r);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: 'error',
      field: 'unstructured_message',
      source: QR_BILL_CHARSET_SOURCE,
    });
    expect(found[0]!.detail).toContain('Line 30 (unstructured_message)');
    expect(found[0]!.detail).toContain('U+1F600 at position 23');
    expect(found[0]!.detail).not.toContain('\u{1F600}');
    expect(r.valid).toBe(false);
    expect(r.ready_for_2026_11_14).toBe(false);
  });

  it('gives one finding per field, listing each Cyrillic letter once', () => {
    const r = checkSwissQrBill(
      payload({
        creditor: ['S', 'Жук Жук', 'Rue du Lac', '1268', '2501', 'Biel', 'CH'],
      }),
    );
    const found = charset(r);
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('creditor.name');
    expect(found[0]!.detail).toContain('3 characters');
    expect(found[0]!.detail).toContain(
      'U+0416 at position 1, U+0443 at position 2, U+043A at position 3.',
    );
    expect(r.valid).toBe(false);
  });

  it('accepts Ș ș Ț ț, the euro sign and the letters of Latin-1 and Latin Extended-A', () => {
    const r = checkSwissQrBill(
      payload({
        creditor: ['S', 'Țară Șantier SRL', 'Bahnhofstraße', '1', '8001', 'Zürich', 'CH'],
        message: 'Facture ș ț € 100, Łódź, Œuvre',
      }),
    );
    expect(r.findings).toEqual([]);
    expect(r.valid).toBe(true);
    for (const cp of [0x20, 0x7e, 0xa0, 0xff, 0x100, 0x17f, 0x218, 0x21b, 0x20ac])
      expect(isQrBillCharacter(cp), cp.toString(16)).toBe(true);
    for (const cp of [0x09, 0x7f, 0x9f, 0x180, 0x217, 0x21c, 0x2019, 0xfeff, 0x1f600])
      expect(isQrBillCharacter(cp), cp.toString(16)).toBe(false);
  });

  it('tolerates one byte-order mark at the head of the payload, and names one anywhere else', () => {
    const head = checkSwissQrBill(`${BOM}${payload()}`);
    expect(head.findings).toEqual([]);
    expect(head.valid).toBe(true);
    const inside = checkSwissQrBill(
      payload({
        creditor: ['S', `${BOM}Robert Schneider AG`, 'Rue du Lac', '1268', '2501', 'Biel', 'CH'],
      }),
    );
    expect(
      charset(inside).map((f) => [f.field, f.detail.includes('U+FEFF at position 1')]),
    ).toEqual([['creditor.name', true]]);
  });

  it('names a typographic apostrophe, which the other checks let through today', () => {
    const r = checkSwissQrBill(payload({ message: 'Order l’atelier' }));
    expect(charset(r)[0]!.detail).toContain('U+2019 at position 8');
    expect(r.valid).toBe(false);
  });

  it('reads a tab at the end of a line, where the other checks trim it', () => {
    const r = checkSwissQrBill(payload().replace('\nBiel\n', '\nBiel\t\n'));
    expect(charset(r).map((f) => f.field)).toEqual(['creditor.town']);
    expect(r.creditor.address.town).toBe('Biel');
  });

  it('names a decomposed letter and says the precomposed one is in the set', () => {
    const r = checkSwissQrBill(
      payload({
        creditor: [
          'S',
          'Robert Schneider AG',
          'Rue du Lac',
          '1268',
          '8001',
          `Zu${DIAERESIS}rich`,
          'CH',
        ],
      }),
    );
    const found = charset(r);
    expect(found.map((f) => f.field)).toEqual(['creditor.town']);
    expect(found[0]!.detail).toContain('U+0308 at position 3');
    expect(found[0]!.detail).toContain('the precomposed letter (Unicode NFC) is in the set');
  });

  it('names the address lines of a combined address as the other findings do', () => {
    const r = checkSwissQrBill(
      payload({
        creditor: [
          'K',
          'Robert Schneider AG',
          'Rue du Lac 1268 \u{1F3E0}',
          '2501 Biel',
          '',
          '',
          'CH',
        ],
      }),
    );
    expect(charset(r).map((f) => f.field)).toEqual(['creditor.address_line_1']);
  });

  it('names the ultimate creditor block with the field of ultimate_creditor_not_allowed', () => {
    const r = checkSwissQrBill(
      payload({
        ultimateCreditor: ['S', 'Société Alpha \u{1F600}', 'Rue du Lac', '1', '2501', 'Biel', 'CH'],
      }),
    );
    const block = r.findings.find((f) => f.code === 'ultimate_creditor_not_allowed');
    expect(block!.field).toBe('ultimate_creditor');
    expect(charset(r).map((f) => f.field)).toEqual([block!.field]);
    expect(charset(r)[0]!.detail).toContain('Line 13 (ultimate_creditor)');
  });

  it('names both alternative schemes with the field of their field_too_long, line apart', () => {
    const r = checkSwissQrBill(
      payload({
        billing: '',
        alt: [`eBill/B/acme@example.com \u{1F600}`, `${'x'.repeat(100)}\u{1F600}`],
      }),
    );
    const tooLong = r.findings.find((f) => f.code === 'field_too_long');
    expect(tooLong!.field).toBe('alternative_scheme');
    const found = charset(r);
    expect(found.map((f) => f.field)).toEqual([tooLong!.field, tooLong!.field]);
    expect(found[0]!.detail).toContain('Line 33 (alternative_scheme)');
    expect(found[1]!.detail).toContain('Line 34 (alternative_scheme)');
  });

  it('cites chapter 4.1.1 of both versions, with the date each is valid from', () => {
    for (const needle of [
      'version 2.3, valid from 21 November 2025',
      'ig-qr-bill-v2.3-en.pdf',
      'read 29.10.2026',
      'ch. 4.1.1 Character set',
      'version 2.4, valid from 14 November 2026, ch. 4.1.1',
    ])
      expect(QR_BILL_CHARSET_SOURCE).toContain(needle);
  });
});

/**
 * The six examples of Annex A of the guidelines 2.4 (24.02.2026, tables 17 to
 * 22), line by line, with SIX's own sample names. None of them meets a new
 * finding. Example 4 already met one before 29.10.2026 and keeps it: its
 * reference RF720191230100405JSH0438, printed the same in the table and on the
 * payment part (p. 55), fails the ISO 11649 modulo 97 check (remainder 49).
 */
describe('the examples of the guidelines 2.4, Annex A', () => {
  const CR = [
    'S',
    'Max Muster & Söhne (sample company)',
    'Musterstrasse',
    '123',
    '8000',
    'Seldwyla',
    'CH',
  ];
  const UCR = ['', '', '', '', '', '', ''];
  const UD_SIMON = ['S', 'Simon Muster', 'Musterstrasse', '1', '8000', 'Seldwyla', 'CH'];
  const UD_SARAH = ['S', 'Sarah Beispiel', 'Musterstrasse', '1', '8000', 'Seldwyla', 'CH'];
  // prettier-ignore
  const EXAMPLES: Record<string, string[]> = {
    'example 1': ['SPC', '0200', '1', 'CH6431961000004421557', ...CR, ...UCR, '50.00', 'CHF', ...UD_SIMON,
      'QRR', '000008207791225857421286694', 'Payment of travel', 'EPD', '', ''],
    'example 2': ['SPC', '0200', '1', 'CH4431999123000889012', ...CR, ...UCR, '1949.75', 'CHF', ...UD_SIMON,
      'QRR', '210000000003139471430009017', 'Order from 15.10.2020', 'EPD',
      '//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30', 'eBill/B/simon.muster@example.com'],
    'example 3': ['SPC', '0200', '1', 'CH5204835012345671000',
      'S', 'Muster Stiftung (sample foundation)', 'P.O. box', '', '3001', 'Bern', 'CH',
      ...UCR, '', 'CHF', ...UCR, 'NON', '', '', 'EPD'],
    'example 4': ['SPC', '0200', '1', 'CH5800791123000889012',
      'S', 'Muster Krankenkasse (sample health insurer)', 'Musterstrasse', '12', '8000', 'Seldwyla', 'CH',
      ...UCR, '211.00', 'CHF', ...UD_SARAH, 'SCOR', 'RF720191230100405JSH0438', '', 'EPD'],
    'example 5': ['SPC', '0200', '1', 'CH5800791123000889012',
      'S', 'Max Muster & Söhne (sample company)', 'Musterstrasse', '123', '9490', 'Vaduz', 'LI',
      ...UCR, '199.95', 'CHF', ...UD_SARAH, 'SCOR', 'RF18539007547034', '', 'EPD'],
    'example 6': ['SPC', '0200', '1', 'CH5800791123000889012', ...CR, ...UCR, '199.95', 'CHF',
      'S', 'Sarah Beispiel', 'Musterstrasse', '1', '78462', 'Konstanz', 'DE',
      'SCOR', 'RF18539007547034', '', 'EPD'],
  };

  it.each(Object.keys(EXAMPLES))('%s meets no new finding, with CR+LF as printed', (name) => {
    const r = checkSwissQrBill(EXAMPLES[name]!.join('\r\n'));
    const codes = r.findings.map((f) => f.code);
    expect(codes).not.toContain('character_not_permitted');
    expect(codes).not.toContain('qr_iban_chf_only_ig24');
    if (name === 'example 4') {
      expect(codes).toEqual(['scor_reference_invalid']);
    } else {
      expect(r.findings).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });

  it('example 2 in EUR: the S1 line still passes, the 2.4 rule warns', () => {
    const lines = [...EXAMPLES['example 2']!];
    lines[19] = 'EUR';
    const r = checkSwissQrBill(lines.join('\n'));
    expect(r.findings.map((f) => f.code)).toEqual(['qr_iban_chf_only_ig24']);
    expect(r.valid).toBe(true);
  });
});
