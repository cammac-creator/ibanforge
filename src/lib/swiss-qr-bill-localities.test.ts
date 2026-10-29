import { describe, it, expect } from 'vitest';
import { checkSwissQrBill } from './swiss-qr-bill.js';

/**
 * NPA et localité au répertoire officiel de swisstopo, vus depuis la
 * QR-facture (29.10.2026). Fichier à part de swiss-qr-bill.test.ts, pour ne
 * pas croiser les ajouts d'autres chantiers sur le même fichier.
 */

const QR_IBAN = 'CH4431999123000889012'; // IID 31999, dans la plage QR
const QRR = '210000000003139471430009017';

/** La QR-facture d'exemple de SIX ; créancier et débiteur final remplaçables (7 lignes chacun). */
function payload(o: { creditor?: string[]; debtor?: string[] } = {}): string {
  return [
    'SPC',
    '0200',
    '1',
    QR_IBAN,
    ...(o.creditor ?? ['S', 'Robert Schneider AG', 'Rue du Lac', '1268', '2501', 'Biel', 'CH']),
    ...['', '', '', '', '', '', ''],
    '1949.75',
    'CHF',
    ...(o.debtor ?? [
      'S',
      'Pia-Maria Rutschmann-Schnyder',
      'Grosse Marktgasse',
      '28',
      '9400',
      'Rorschach',
      'CH',
    ]),
    'QRR',
    QRR,
    'Order of 15 June 2026',
    'EPD',
  ].join('\n');
}

describe('checkSwissQrBill: postcode and town in the official directory of localities (29.10.2026)', () => {
  const codes = (p: string) => checkSwissQrBill(p).findings.map((f) => f.code);
  const creditor = (pst: string, town: string, ctry = 'CH') => [
    'S',
    'Société Alpha',
    'Rue du Lac',
    '12',
    pst,
    town,
    ctry,
  ];

  it('the example of SIX, 2501 Biel, a post-office box postcode: no warning, and the lookup says why', () => {
    const r = checkSwissQrBill(payload());
    expect(r.findings).toEqual([]);
    expect(r.creditor.sps_check?.postcode_locality?.status).toBe('not_verifiable');
    expect(r.ultimate_debtor.sps_check?.postcode_locality?.status).toBe('match');
  });

  it('a postcode and a town that do not go together: a warning, and valid and ready do not move', () => {
    const r = checkSwissQrBill(payload({ creditor: creditor('8001', 'Bern') }));
    const f = r.findings.find((x) => x.code === 'postcode_town_mismatch');
    expect(f).toMatchObject({ severity: 'warning', field: 'creditor.town' });
    expect(f!.source).toContain('©swisstopo');
    expect(f!.source).toContain('version of 01.10.2026');
    expect(r.valid).toBe(true);
    expect(r.ready_for_2026_11_14).toBe(true);
    expect(r.creditor.sps_check?.conforms).toBe(true);
  });

  it('Vaduz written with CH: postcode_other_country; Büsingen and Campione: postcode_not_listed', () => {
    expect(codes(payload({ creditor: creditor('9490', 'Vaduz') }))).toContain(
      'postcode_other_country',
    );
    expect(codes(payload({ creditor: creditor('9490', 'Vaduz', 'LI') }))).toEqual([]);
    expect(codes(payload({ creditor: creditor('8238', 'Büsingen') }))).toContain(
      'postcode_not_listed',
    );
    expect(codes(payload({ creditor: creditor('6911', 'Campione') }))).toContain(
      'postcode_not_listed',
    );
    // Büsingen écrit avec son pays, l'Allemagne : rien à comparer.
    expect(codes(payload({ creditor: creditor('8238', 'Büsingen', 'DE') }))).toEqual([]);
  });

  it('Moutier, Biel/Bienne, Zürich and Zurich: no warning', () => {
    for (const [p, t] of [
      ['2740', 'Moutier'],
      ['2502', 'Bienne'],
      ['2502', 'Biel/Bienne'],
      ['8001', 'Zurich'],
      ['8001', 'Zürich'],
    ] as const) {
      expect(codes(payload({ creditor: creditor(p, t) })), `${p} ${t}`).toEqual([]);
    }
  });

  it('the ultimate debtor is looked up too', () => {
    const r = checkSwissQrBill(
      payload({ debtor: ['S', 'Société Beta', 'Grosse Marktgasse', '28', '9400', 'Genève', 'CH'] }),
    );
    expect(r.findings.find((x) => x.code === 'postcode_town_mismatch')?.field).toBe(
      'ultimate_debtor.town',
    );
    expect(r.valid).toBe(true);
  });

  it('a combined (K) address is not looked up', () => {
    const r = checkSwissQrBill(
      payload({ creditor: ['K', 'Société Alpha', 'Rue du Lac 12', '8001 Bern', '', '', 'CH'] }),
    );
    expect(r.creditor.sps_check).toBeNull();
    expect(r.findings.map((f) => f.code)).not.toContain('postcode_town_mismatch');
  });
});
