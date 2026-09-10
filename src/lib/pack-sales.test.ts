import { describe, expect, it, vi } from 'vitest';
import type { PackKeyRow } from './business-summary.js';
import { summarizePackSales } from './pack-sales.js';

vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

const now = new Date('2026-09-10T20:00:00Z');

function key(overrides: Partial<PackKeyRow> = {}): PackKeyRow {
  return {
    email: 'buyer@alpha.example.net',
    credits_total: 1000,
    amount_paid_minor: 500,
    amount_paid_currency: 'usd',
    stripe_session_id: 'cs_fictif_1',
    x402_payment_ref: null,
    issued_by_us: 0,
    created_at: '2026-08-01 12:00:00',
    ...overrides,
  };
}

describe('Montants de packs depuis les métadonnées conservées', () => {
  it('annonce sa source et distingue aucune observation d’un montant nul confirmé', () => {
    expect(summarizePackSales([], now)).toEqual({
      version: 1,
      source: 'retained_api_keys_payment_metadata',
      generated_at: now.toISOString(),
      scope: 'all_retained_credit_keys',
      stripe: {
        groups: 0,
        usd_amount_minor: null,
        usd_known_groups: 0,
        usd_zero_groups: 0,
        amount_missing_groups: 0,
        other_currency_groups: 0,
        invalid_amount_groups: 0,
        conflicting_groups: 0,
        first_key_created_at: null,
        last_key_created_at: null,
      },
      x402: {
        distinct_references: 0,
        settlement_status: 'not_reconciled',
        confirmed_amount_usdc: null,
      },
      unattributed_credit_keys: 0,
      granted_credit_keys: 0,
      excluded_internal_credit_keys: 0,
      duplicate_reference_rows: 0,
      ambiguous_rail_keys: 0,
    });
  });

  it('compte deux achats distincts à la même adresse, avec leurs montants exacts', () => {
    const out = summarizePackSales(
      [
        key(),
        key({ stripe_session_id: 'cs_fictif_2', credits_total: 5000, amount_paid_minor: 1275 }),
      ],
      now,
    );
    expect(out.stripe).toMatchObject({ groups: 2, usd_amount_minor: 1775, usd_known_groups: 2 });
  });

  it('ne multiplie pas un paiement copié et conserve la date de la clé d’origine', () => {
    const out = summarizePackSales(
      [
        key({ created_at: '2026-09-01 12:00:00' }),
        key({ amount_paid_currency: ' USD ' }),
        key({ stripe_session_id: 'cs_fictif_2', created_at: '2026-08-05 12:00:00' }),
      ],
      now,
    );
    expect(out.stripe).toMatchObject({
      groups: 2,
      usd_amount_minor: 1000,
      usd_known_groups: 2,
      first_key_created_at: '2026-08-01T12:00:00.000Z',
      last_key_created_at: '2026-08-05T12:00:00.000Z',
    });
    expect(out.duplicate_reference_rows).toBe(1);
  });

  it('garde le montant connu quand une copie ne possède aucun montant', () => {
    const out = summarizePackSales(
      [key(), key({ amount_paid_minor: null, amount_paid_currency: null })],
      now,
    );
    expect(out.stripe).toMatchObject({ groups: 1, usd_known_groups: 1, usd_amount_minor: 500 });
  });

  it.each([
    { amount_paid_minor: 400 },
    { amount_paid_currency: 'chf' },
    { amount_paid_minor: null, amount_paid_currency: 'chf' },
    { amount_paid_minor: 400, amount_paid_currency: null },
  ])('écarte une référence contradictoire quelle que soit l’ordre des copies : %j', (overrides) => {
    const rows = [key(), key(overrides)];
    const out = summarizePackSales(rows, now);
    expect(out).toEqual(summarizePackSales([...rows].reverse(), now));
    expect(out.stripe).toMatchObject({
      groups: 1,
      conflicting_groups: 1,
      usd_known_groups: 0,
      usd_amount_minor: null,
    });
  });

  it('n’assemble pas deux fragments incomplets en un montant prétendument enregistré', () => {
    const out = summarizePackSales(
      [key({ amount_paid_currency: null }), key({ amount_paid_minor: null })],
      now,
    );
    expect(out.stripe).toMatchObject({ amount_missing_groups: 1, usd_amount_minor: null });
  });

  it.each([{ issued_by_us: 1 }, { email: 'internal@example.org' }])(
    'conserve une exclusion cadeau ou interne malgré une copie non marquée : %j',
    (overrides) => {
      const rows = [key(), key(overrides)];
      const out = summarizePackSales(rows, now);
      expect(out).toEqual(summarizePackSales([...rows].reverse(), now));
      expect(out.stripe).toMatchObject({ groups: 0, usd_amount_minor: null });
      expect(out.granted_credit_keys + out.excluded_internal_credit_keys).toBe(1);
    },
  );

  it.each(['ops@ibanforge.internal', 'ops@ibf-internal.dev', 'service-probe@alpha.example.net'])(
    'exclut aussi les sondes internes du CRM, malgré une copie externe : %s',
    (email) => {
      const out = summarizePackSales([key(), key({ email })], now);
      expect(out).toMatchObject({
        excluded_internal_credit_keys: 1,
        stripe: { groups: 0, usd_amount_minor: null },
      });
    },
  );

  it.each(['stripe-buyer', 'credits-buyer'])(
    'préserve les références des achats anonymes cachés du CRM : %s',
    (email) => {
      const out = summarizePackSales(
        [
          key({ email }),
          key({ email, stripe_session_id: null, x402_payment_ref: 'ref_fictive_anonyme' }),
        ],
        now,
      );
      expect(out).toMatchObject({
        excluded_internal_credit_keys: 0,
        stripe: { groups: 1, usd_known_groups: 1, usd_amount_minor: 500 },
        x402: { distinct_references: 1, confirmed_amount_usdc: null },
      });
    },
  );

  it('distingue zéro, ancien montant absent et devise étrangère sans prix de remplacement', () => {
    const out = summarizePackSales(
      [
        key({ amount_paid_minor: 0 }),
        key({
          stripe_session_id: 'cs_fictif_2',
          amount_paid_minor: null,
          amount_paid_currency: null,
        }),
        key({ stripe_session_id: 'cs_fictif_3', amount_paid_currency: 'eur' }),
      ],
      now,
    );
    expect(out.stripe).toMatchObject({
      groups: 3,
      usd_amount_minor: 0,
      usd_known_groups: 1,
      usd_zero_groups: 1,
      amount_missing_groups: 1,
      other_currency_groups: 1,
    });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'écarte un montant invalide sans l’arrondir : %s',
    (minor) => {
      const out = summarizePackSales([key({ amount_paid_minor: minor })], now);
      expect(out.stripe).toMatchObject({
        invalid_amount_groups: 1,
        usd_amount_minor: null,
        usd_known_groups: 0,
      });
    },
  );

  it('signale une devise mal formée et ne blanchit pas une copie invalide', () => {
    const out = summarizePackSales([key(), key({ amount_paid_currency: 'dollars' })], now);
    expect(out.stripe).toMatchObject({ invalid_amount_groups: 1, usd_amount_minor: null });
  });

  it('refuse un total dépassant la précision entière au lieu de publier un arrondi', () => {
    expect(() =>
      summarizePackSales(
        [
          key({ amount_paid_minor: Number.MAX_SAFE_INTEGER }),
          key({ stripe_session_id: 'cs_fictif_2', amount_paid_minor: 1 }),
        ],
        now,
      ),
    ).toThrow(RangeError);
  });

  it('distingue les références x402 sans prétendre à un règlement ni convertir leurs montants', () => {
    const out = summarizePackSales(
      [
        key({ stripe_session_id: null, x402_payment_ref: 'ref_fictive_a' }),
        key({ stripe_session_id: null, x402_payment_ref: 'ref_fictive_a' }),
        key({ stripe_session_id: null, x402_payment_ref: 'ref_fictive_b' }),
      ],
      now,
    );
    expect(out.x402).toEqual({
      distinct_references: 2,
      settlement_status: 'not_reconciled',
      confirmed_amount_usdc: null,
    });
    expect(out.stripe).toMatchObject({ groups: 0, usd_amount_minor: null });
    expect(out.duplicate_reference_rows).toBe(1);
  });

  it('conserve les exclusions cadeau et interne dans les groupes x402', () => {
    const out = summarizePackSales(
      [
        key({ stripe_session_id: null, x402_payment_ref: 'ref_fictive_a' }),
        key({ stripe_session_id: null, x402_payment_ref: 'ref_fictive_a', issued_by_us: 1 }),
        key({ stripe_session_id: null, x402_payment_ref: 'ref_fictive_b' }),
        key({
          stripe_session_id: null,
          x402_payment_ref: 'ref_fictive_b',
          email: 'internal@example.org',
        }),
      ],
      now,
    );
    expect(out.x402.distinct_references).toBe(0);
    expect(out.granted_credit_keys).toBe(1);
    expect(out.excluded_internal_credit_keys).toBe(1);
  });

  it('signale une attribution aux deux rails sans la compter dans les montants Stripe', () => {
    const out = summarizePackSales([key(), key({ x402_payment_ref: 'ref_fictive_a' })], now);
    expect(out).toMatchObject({
      ambiguous_rail_keys: 1,
      duplicate_reference_rows: 0,
      stripe: { groups: 1, conflicting_groups: 1, usd_amount_minor: null },
      x402: { distinct_references: 1, confirmed_amount_usdc: null },
    });
  });

  it('compte les clés sans référence comme clés, jamais comme ventes déduites', () => {
    const out = summarizePackSales(
      [
        key({ stripe_session_id: null }),
        key({ stripe_session_id: '   ' }),
        key({ stripe_session_id: null, issued_by_us: 1 }),
        key({ stripe_session_id: null, email: 'internal@example.org' }),
        key({ stripe_session_id: 'cs_gratuit', credits_total: null }),
        key({ stripe_session_id: 'cs_sans_credits', credits_total: 0 }),
      ],
      now,
    );
    expect(out).toMatchObject({
      unattributed_credit_keys: 2,
      granted_credit_keys: 1,
      excluded_internal_credit_keys: 1,
      stripe: { groups: 0, usd_amount_minor: null },
    });
  });

  it('tolère une date absente ou invalide sans inventer une date de paiement', () => {
    const out = summarizePackSales(
      [key({ created_at: null }), key({ created_at: 'date inconnue' })],
      now,
    );
    expect(out.stripe).toMatchObject({
      first_key_created_at: null,
      last_key_created_at: null,
      usd_amount_minor: 500,
    });
  });
});
