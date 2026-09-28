import { describe, expect, it } from 'vitest';
import {
  formatMinorAmount,
  readReceiptLink,
  readReceipts,
  receiptRowFrom,
  STRIPE_RECEIPT_PREFIX,
} from './account-receipts';

/**
 * La lecture des reçus du compte (28.09.2026). Fixtures inventées : aucun
 * client réel (dépôt public).
 */

const PORTAL = 'https://billing.stripe.com/p/login/alpha';
const REF = 'rcpt_0123456789abcdef01234567';

const PACK = {
  ref: REF,
  paid_at: '2026-09-23T16:43:08Z',
  kind: 'pack',
  plan: null,
  rail: 'card',
  credits: 1000,
  amount: { minor: 400, currency: 'usd' },
  status: 'paid',
  key_prefix: 'ifk_3f9c1a7e',
  receipt: `/v1/account/receipt?ref=${REF}`,
  invoices: null,
};

describe('readReceipts', () => {
  it('lit chaque achat de la liste', () => {
    const outcome = readReceipts({ status: 200, body: { receipts: [PACK] } });
    expect(outcome).toEqual({
      kind: 'ready',
      rows: [
        {
          ref: REF,
          day: '2026-09-23',
          kind: 'pack',
          plan: null,
          rail: 'card',
          credits: 1000,
          amount: { minor: 400, currency: 'usd' },
          status: 'paid',
          keyPrefix: 'ifk_3f9c1a7e',
          receiptPath: `/v1/account/receipt?ref=${REF}`,
          invoicesUrl: null,
        },
      ],
    });
  });

  it('401 : la session a pris fin ; toute autre réponse inattendue : échec', () => {
    expect(readReceipts({ status: 401, body: { error: 'signed_out' } })).toEqual({ kind: 'session_ended' });
    expect(readReceipts({ status: 0, body: null })).toEqual({ kind: 'failed' });
    expect(readReceipts({ status: 500, body: { receipts: [PACK] } })).toEqual({ kind: 'failed' });
    expect(readReceipts({ status: 200, body: { receipts: 'nope' } })).toEqual({ kind: 'failed' });
  });

  it('une liste vide est prête, pas en échec', () => {
    expect(readReceipts({ status: 200, body: { receipts: [] } })).toEqual({ kind: 'ready', rows: [] });
  });

  it('ignore un achat mal formé sans jeter les autres', () => {
    const outcome = readReceipts({
      status: 200,
      body: {
        receipts: [
          { ...PACK, ref: 42 },
          { ...PACK, ref: 'rcpt_nothex' },
          { ...PACK, kind: 'gift' },
          { ...PACK, status: 'weird' },
          null,
          PACK,
        ],
      },
    });
    expect(outcome.kind === 'ready' && outcome.rows.map((r) => r.ref)).toEqual([REF]);
  });
});

describe('receiptRowFrom', () => {
  it("ne suit un reçu que par le chemin exact de la route du compte", () => {
    for (const receipt of [
      'https://pay.stripe.com/receipts/payment/x',
      `/v1/account/receipt?ref=${REF}&then=https://evil.example.net`,
      `//evil.example.net/v1/account/receipt?ref=${REF}`,
      '/v1/account/receipt?id=42',
      '/v1/account/receipt?ref=rcpt_0',
      'javascript:alert(1)',
    ]) {
      expect(receiptRowFrom({ ...PACK, receipt })?.receiptPath, receipt).toBeNull();
    }
  });

  it("un abonnement mène au portail de Stripe en https, et nulle part ailleurs", () => {
    const sub = { ...PACK, kind: 'subscription', plan: 'editor', credits: null, receipt: null, invoices: PORTAL };
    expect(receiptRowFrom(sub)?.invoicesUrl).toBe(PORTAL);
    expect(receiptRowFrom(sub)?.plan).toBe('editor');
    expect(receiptRowFrom({ ...sub, plan: 'gold' })?.plan).toBeNull();
    for (const invoices of [
      'javascript:alert(1)',
      'http://billing.stripe.com/p/login/alpha',
      'https://evil.example.net/p/login/alpha',
      'https://billing.stripe.com.evil.example.net/p/login/alpha',
    ]) {
      expect(receiptRowFrom({ ...sub, invoices })?.invoicesUrl, invoices).toBeNull();
    }
  });

  it("un montant absent ou mal formé ne s'affiche pas ; un préfixe inattendu non plus", () => {
    expect(receiptRowFrom({ ...PACK, amount: null })?.amount).toBeNull();
    expect(receiptRowFrom({ ...PACK, amount: { minor: -4, currency: 'usd' } })?.amount).toBeNull();
    expect(receiptRowFrom({ ...PACK, amount: { minor: 400, currency: '<b>' } })?.amount).toBeNull();
    expect(receiptRowFrom({ ...PACK, key_prefix: '<img src=x>' })?.keyPrefix).toBeNull();
    expect(receiptRowFrom({ ...PACK, paid_at: 'hier' })?.day).toBeNull();
  });

  it('garde le statut remboursé ou contesté', () => {
    expect(receiptRowFrom({ ...PACK, status: 'refunded' })?.status).toBe('refunded');
    expect(receiptRowFrom({ ...PACK, status: 'disputed' })?.status).toBe('disputed');
  });
});

describe('readReceiptLink', () => {
  it('ne rend que la page des reçus de Stripe, en https', () => {
    const url = `${STRIPE_RECEIPT_PREFIX}payment/CAcaFwoVYWxwaGE`;
    expect(readReceiptLink({ status: 200, body: { ref: REF, url } })).toEqual({ kind: 'ready', url });
    for (const bad of [
      'https://evil.example.net/receipts/payment/x',
      'http://pay.stripe.com/receipts/payment/x',
      'https://pay.stripe.com.evil.example.net/receipts/x',
      'javascript:alert(1)',
      null,
    ]) {
      expect(readReceiptLink({ status: 200, body: { ref: REF, url: bad } }), String(bad)).toEqual({ kind: 'failed' });
    }
  });

  it('401 : session terminée ; 404, 503 ou réseau : échec', () => {
    expect(readReceiptLink({ status: 401, body: null })).toEqual({ kind: 'session_ended' });
    for (const status of [0, 404, 503]) {
      expect(readReceiptLink({ status, body: { error: 'receipt_unavailable' } })).toEqual({ kind: 'failed' });
    }
  });
});

describe('formatMinorAmount', () => {
  it('écrit le montant sans Intl, selon la langue', () => {
    expect(formatMinorAmount({ minor: 400, currency: 'usd' }, 'en')).toBe('4.00 USD');
    expect(formatMinorAmount({ minor: 400, currency: 'usd' }, 'fr')).toBe('4,00 USD');
    expect(formatMinorAmount({ minor: 8000, currency: 'usd' }, 'de')).toBe('80,00 USD');
    expect(formatMinorAmount({ minor: 250_000, currency: 'usd' }, 'en')).toBe('2,500.00 USD');
  });
});
