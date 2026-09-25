/**
 * La sauvegarde au format 8 porte le registre des achats et les références de
 * recharge (chantier « clé unique », lot B1, 25.09.2026). Sans eux, une base
 * restaurée perdrait l'idempotence de chaque paiement et toutes les ventes par
 * recharge, et un lien de recharge déjà envoyé frapperait une clé neuve.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { BACKUP_FORMAT, READABLE_FORMATS, exportPaidState, restorePaidState } from './backup.js';
import { generateApiKey } from './api-keys.js';
import { ensureTopupRef } from './key-purchases.js';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import { closeAll, getStatsDB } from './db.js';

afterAll(() => closeAll());

describe('sauvegarde du registre des achats', () => {
  it('exporte et restaure les deux tables, sans écraser ni doubler un paiement', () => {
    expect(BACKUP_FORMAT).toBe(8);
    expect(READABLE_FORMATS).toContain(7);
    expect(READABLE_FORMATS).toContain(8);
    const key = generateApiKey(`backup-${Date.now()}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const session = `cs_test_backup_${Date.now()}`;
    processStripeEvent({
      id: `evt_backup_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: session,
          metadata: { bundle: '1k' },
          customer_email: 'acme@example.com',
          customer_details: { email: 'acme@example.com' },
          payment_status: 'paid',
          amount_total: 400,
          currency: 'usd',
          client_reference_id: ref,
          payment_intent: null,
        },
      },
    } as unknown as Stripe.Event);

    const dump = exportPaidState('2026-09-25T10:00:00Z');
    expect(dump.format).toBe(8);
    const purchase = dump.key_purchases!.find((r) => r.payment_ref === `stripe:${session}`);
    expect(purchase).toMatchObject({ outcome: 'credited', payer_email: 'acme@example.com' });
    expect(dump.key_topup_refs!.some((r) => r.ref === ref)).toBe(true);
    expect(dump.counts.key_purchases).toBe(dump.key_purchases!.length);
    expect(dump.counts.key_topup_refs).toBe(dump.key_topup_refs!.length);

    // La base perd les deux lignes ; la restauration les rend, une fois.
    const db = getStatsDB();
    db.prepare('DELETE FROM key_purchases WHERE payment_ref = ?').run(`stripe:${session}`);
    db.prepare('DELETE FROM key_topup_refs WHERE ref = ?').run(ref);
    const only = {
      ...dump,
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      key_revocations: [],
      lineage_facts: [],
      breaker_transitions: [],
      key_creations: [],
      device_grant_daily: [],
      mcp_remote_daily: [],
      key_purchases: [purchase!],
      key_topup_refs: dump.key_topup_refs!.filter((r) => r.ref === ref),
    };
    const report = restorePaidState(only);
    expect(report.purchases_inserted).toBe(1);
    expect(report.topup_refs_inserted).toBe(1);
    const again = restorePaidState(only);
    expect(again.purchases_inserted).toBe(0);
    expect(again.purchases_skipped).toBe(1);
    expect(again.topup_refs_skipped).toBe(1);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM key_purchases WHERE payment_ref = ?')
          .get(`stripe:${session}`) as { n: number }
      ).n,
    ).toBe(1);
  });

  it('un dump au format 7 se restaure sans les deux tables', () => {
    const report = restorePaidState({
      format: 7,
      taken_at: '2026-09-24T10:00:00Z',
      counts: { api_keys: 0, api_usage: 0 },
      api_keys: [],
      api_usage: [],
    });
    expect(report.purchases_inserted).toBe(0);
    expect(report.topup_refs_inserted).toBe(0);
  });
});
