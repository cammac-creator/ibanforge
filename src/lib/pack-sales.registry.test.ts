/**
 * Les lecteurs d'argent lisent le registre des achats (chantier « clé unique »,
 * lot B1, 25.09.2026) : une recharge est une vente, datée à son paiement, et
 * une rotation ne double rien. Sans ces lecteurs, une recharge serait invisible
 * au tableau de bord.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import { generateApiKey, generateOemKey, PRO_MONTHLY_LIMIT, rotateApiKey } from './api-keys.js';
import { ensureTopupRef } from './key-purchases.js';
import { readPackSaleRows, summarizePackSales } from './pack-sales.js';
import { packsSold } from './business-summary.js';
import { getWeeklyFacts } from './weekly-facts.js';
import { readSubscriptionRows, subscriptionsSold } from './subscription-payments.js';
import { getActivation } from './activation.js';
import { getLineageFunnel } from './lineage-funnel.js';
import { closeAll, getStatsDB } from './db.js';

afterAll(() => closeAll());

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

function pay(opts: { session: string; ref?: string | null; bundle?: string; amount?: number }) {
  return processStripeEvent({
    id: `evt_${uniq('reader')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.session,
        metadata: { bundle: opts.bundle ?? '1k' },
        customer_email: null,
        customer_details: null,
        payment_status: 'paid',
        amount_total: opts.amount ?? 400,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: null,
      },
    },
  } as unknown as Stripe.Event);
}

function salesFor(sessions: string[]) {
  const wanted = new Set(sessions);
  return readPackSaleRows().filter((r) => r.stripe_session_id && wanted.has(r.stripe_session_id));
}

describe('une recharge est une vente', () => {
  it('chaque recharge par carte compte une vente, avec son montant réel', () => {
    const key = generateApiKey(`${uniq('sale')}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const s1 = `cs_test_${uniq('sale1')}`;
    const s2 = `cs_test_${uniq('sale2')}`;
    pay({ session: s1, ref });
    pay({ session: s2, ref, bundle: '5k', amount: 2000 });
    const rows = salesFor([s1, s2]);
    expect(rows).toHaveLength(2);
    const summary = summarizePackSales(rows);
    expect(summary.stripe.groups).toBe(2);
    expect(summary.stripe.usd_amount_minor).toBe(2400);
    expect(summary.rows).toBe('key_purchases_registry');
    const sold = packsSold(rows);
    expect(sold.count).toBe(2);
    expect(sold.by_rail.card.count).toBe(2);
    expect(sold.usd).toBe(24);
    expect(sold.deduced_count).toBe(0);
  });

  it('une rotation ne double rien (constat C5)', () => {
    const s = `cs_test_${uniq('rotated')}`;
    const minted = pay({ session: s, bundle: '5k', amount: 2000 });
    const before = readPackSaleRows().length;
    const rotated = rotateApiKey(minted.notify!.rawKey)!;
    rotateApiKey(rotated.api_key);
    // Le lecteur d'avant comptait chaque ligne à crédits : chaque copie
    // tournée, sans session, devenait un second pack au rail « unknown ». Au
    // registre, deux rotations ne changent rien.
    expect(readPackSaleRows()).toHaveLength(before);
    expect(readPackSaleRows().filter((r) => r.stripe_session_id === s)).toHaveLength(1);
  });
});

describe('les faits de la semaine datent un achat à son paiement', () => {
  it('une recharge de la semaine passée compte, une rotation de la semaine non', () => {
    const now = new Date();
    const key = generateApiKey(`${uniq('weekly')}@alpha.example.net`)!;
    const ref = ensureTopupRef(key.key_hash)!;
    const before = getWeeklyFacts(now).purchases.current;
    const s = `cs_test_${uniq('weekly')}`;
    pay({ session: s, ref });
    // Daté au mardi de la semaine passée : la fenêtre des faits.
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 6);
    const lastTuesday = monday.toISOString().slice(0, 10) + ' 10:00:00';
    getStatsDB()
      .prepare('UPDATE key_purchases SET created_at = ? WHERE payment_ref = ?')
      .run(lastTuesday, `stripe:${s}`);
    expect(getWeeklyFacts(now).purchases.current).toBe(before + 1);
    // Une clé tournée la même semaine n'est pas un achat.
    rotateApiKey(key.api_key);
    expect(getWeeklyFacts(now).purchases.current).toBe(before + 1);
  });
});

describe('le premier paiement d’une clé Pro rechargée ne disparaît pas', () => {
  it('la session de l’abonnement reste un premier paiement, la recharge un pack', () => {
    const session = `cs_test_${uniq('pro')}`;
    const pro = generateOemKey(
      `${uniq('pro')}@alpha.example.net`,
      PRO_MONTHLY_LIMIT,
      session,
      `sub_${uniq('pro')}`,
    );
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET amount_paid_minor = 2900, amount_paid_currency = 'usd' WHERE stripe_session_id = ?",
      )
      .run(session);
    const beforeRecharge = subscriptionsSold(readSubscriptionRows(), () => false);
    const proHash = getStatsDB()
      .prepare('SELECT key_hash FROM api_keys WHERE stripe_session_id = ?')
      .get(session) as { key_hash: string };
    // Le registre de la souscription, comme le webhook l'écrit depuis le lot B1.
    getStatsDB()
      .prepare(
        `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix,
                                    amount_minor, currency, stripe_session_id)
         VALUES (?, 'card', 'subscription', 'minted', ?, ?, ?, 2900, 'usd', ?)`,
      )
      .run(`stripe:${session}`, proHash.key_hash, proHash.key_hash, pro.key_prefix, session);
    pay({ session: `cs_test_${uniq('prorecharge')}`, ref: ensureTopupRef(proHash.key_hash)! });
    const afterRecharge = subscriptionsSold(readSubscriptionRows(), () => false);
    // La clé porte maintenant des crédits : l'ancienne règle aurait écarté sa
    // session, et le premier paiement de l'abonnement aurait disparu.
    expect(afterRecharge.first_payments).toBe(beforeRecharge.first_payments);
    expect(afterRecharge.first_payments_usd_minor).toBe(beforeRecharge.first_payments_usd_minor);
  });
});

describe('l’activation compte une clé mixte des deux côtés', () => {
  it('son gratuit reste un gratuit, ses crédits un achat', () => {
    const email = `${uniq('mixte')}@alpha.example.net`;
    const key = generateApiKey(email)!;
    pay({ session: `cs_test_${uniq('mixte')}`, ref: ensureTopupRef(key.key_hash)! });
    const client = getActivation(30).clients.find((c) => c.email === email)!;
    expect(client.free_quota).toBe(200);
    expect(client.credits_total).toBe(1000);
    expect(client.packs).toBe(1);
  });
});

describe('l’entonnoir voit la conversion créée par la recharge', () => {
  it('une recharge compte comme un achat réglé et remis, et la lignée est reliée', () => {
    const key = generateApiKey(`${uniq('funnel')}@alpha.example.net`)!;
    const today = new Date().toISOString().slice(0, 10);
    const before = getLineageFunnel({ since: today, days: 1 });
    pay({ session: `cs_test_${uniq('funnel')}`, ref: ensureTopupRef(key.key_hash)! });
    const after = getLineageFunnel({ since: today, days: 1 });
    const d5 = (f: typeof after) => f.indicators.paid_key_delivered;
    expect((d5(after).denominator ?? 0) - (d5(before).denominator ?? 0)).toBe(1);
    expect((d5(after).numerator ?? 0) - (d5(before).numerator ?? 0)).toBe(1);
    const fact = getStatsDB()
      .prepare(
        'SELECT paid_key_hash, paid_key_delivered_at FROM lineage_facts WHERE lineage_hash = ?',
      )
      .get(key.key_hash) as { paid_key_hash: string; paid_key_delivered_at: string };
    expect(fact.paid_key_hash).toBe(key.key_hash);
    expect(fact.paid_key_delivered_at).toBeTruthy();
  });
});
