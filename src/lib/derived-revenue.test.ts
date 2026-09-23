import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAll, getStatsDB } from './db.js';
import { readDerivedRevenue } from './derived-revenue.js';

/**
 * Le repli « selon les clés », affiché quand Stripe ne répond pas, ne compte
 * que trois choses : packs, abonnements, audits. Aucune notion d'« autre » n'y
 * existe, et chaque intrus plausible ci-dessous doit rester dehors.
 *
 * Montants et adresses inventés : ce dépôt est public.
 */
vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

afterAll(() => closeAll());

function key(row: {
  hash: string;
  email: string;
  credits?: number | null;
  amount?: number | null;
  currency?: string | null;
  session?: string | null;
  subscription?: string | null;
  x402?: string | null;
  granted?: 0 | 1;
}) {
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, credits_total, credits_remaining,
         amount_paid_minor, amount_paid_currency, stripe_session_id, stripe_subscription_id,
         x402_payment_ref, issued_by_us, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2030-01-01 00:00:00')`,
    )
    .run(
      row.hash,
      `ifk_${row.hash}`.slice(0, 12),
      row.email,
      row.credits ?? null,
      row.credits ?? null,
      row.amount ?? null,
      row.currency ?? null,
      row.session ?? null,
      row.subscription ?? null,
      row.x402 ?? null,
      row.granted ?? 0,
    );
}

beforeEach(() => {
  getStatsDB().exec(
    'DELETE FROM api_keys; DELETE FROM subscription_payments; DELETE FROM audit_sales;',
  );
});

describe('le repli selon les clés ne compte que packs, abonnements et audits', () => {
  it('additionne les trois natures et laisse chaque intrus dehors', () => {
    // Ce qui compte.
    key({
      hash: 'dr01',
      email: 'pack@alpha.example.net',
      credits: 5000,
      amount: 2000,
      currency: 'usd',
      session: 'cs_dr_pack',
    });
    key({
      hash: 'dr02',
      email: 'abonne@alpha.example.net',
      amount: 1700,
      currency: 'usd',
      session: 'cs_dr_sub',
      subscription: 'sub_dr',
    });
    // Les intrus.
    // Un pack x402 portant un montant : une référence x402 n'est pas un encaissement confirmé.
    key({
      hash: 'dr03',
      email: 'agent@beta.example.net',
      credits: 1000,
      amount: 999,
      currency: 'usd',
      x402: 'ref_dr_x402',
    });
    // Un pack offert : un coût, pas une recette.
    key({
      hash: 'dr04',
      email: 'pilote@beta.example.net',
      credits: 25000,
      amount: 8000,
      currency: 'usd',
      session: 'cs_dr_gift',
      granted: 1,
    });
    // Un pack interne : un test à nous.
    key({
      hash: 'dr05',
      email: 'acme@example.com',
      credits: 25000,
      amount: 8000,
      currency: 'usd',
      session: 'cs_dr_internal',
    });
    // Une clé gratuite, sans rien de payé.
    key({ hash: 'dr06', email: 'libre@beta.example.net' });

    const db = getStatsDB();
    const payment = db.prepare(
      `INSERT INTO subscription_payments (stripe_event_id, invoice_id, subscription_id, key_hash,
         amount_paid_minor, amount_paid_currency, billing_reason, paid_at)
       VALUES (?, ?, 'sub_dr', 'dr02', ?, 'usd', ?, '2030-02-01 00:00:00')`,
    );
    payment.run('evt_dr_cycle', 'in_dr_cycle', 1700, 'subscription_cycle');
    // Une facture qui n'est pas un renouvellement : jamais comptée par le registre.
    payment.run('evt_dr_update', 'in_dr_update', 600, 'subscription_update');

    const audit = db.prepare(
      `INSERT INTO audit_sales (job_id, rows, tier, price, currency, amount_paid_minor,
         amount_paid_currency, paid_at) VALUES (?, 10, 'small', 149, ?, ?, ?, '2030-01-05 00:00:00')`,
    );
    audit.run('job_dr_usd', 'USD', 14900, 'usd');
    // Un audit en francs : compté à part, jamais converti ni ajouté.
    audit.run('job_dr_chf', 'CHF', 14900, 'chf');

    const d = readDerivedRevenue(db);
    expect(Object.keys(d.by_kind).sort()).toEqual(['abonnement', 'audit', 'pack']);
    expect(d.by_kind).toEqual({ pack: 2000, abonnement: 3400, audit: 14900 });
    expect(d.total_minor).toBe(d.by_kind.pack + d.by_kind.abonnement + d.by_kind.audit);
    expect(d.total_minor).toBe(20300);
    expect(d.currency).toBe('usd');
    expect(d.other_currency_payments).toBe(1);
  });

  it('rend zéro, jamais un montant deviné, quand rien n’a été payé', () => {
    key({ hash: 'dr10', email: 'libre@beta.example.net' });
    const d = readDerivedRevenue(getStatsDB());
    expect(d.total_minor).toBe(0);
    expect(d.by_kind).toEqual({ pack: 0, abonnement: 0, audit: 0 });
    expect(d.last_payment_at).toBeNull();
  });
});
