/**
 * La remise à zéro à la date anniversaire d'un abonnement (chantier « compte
 * client et alertes », lot 2, 27.11.2026). Décision du propriétaire : « il faut
 * toujours que ce soit à l'avantage du client. Arrondi de manière à ce que les
 * clients soient avantagés avec ce changement. »
 *
 * Chaque règle dure a son test ici :
 *  1. bascule à la première facture de renouvellement payée dont la période
 *     commence le 28.12.2026 ou après (30 jours de préavis), jamais avant ;
 *  2. la remise à zéro n'attend jamais un paiement ;
 *  3. arrondi en faveur du client (début du jour à Zurich, jour 29-31 ramené
 *     au dernier jour d'un mois plus court) ;
 *  4. l'invariant : jamais moins de remises à zéro cumulées qu'avec l'ancien
 *     compte (le reste d'une période qui se termine, lui, ne se reporte pas) ;
 *  5. un plafond relevé à la main est gardé.
 *
 * Fixtures inventées (dépôt public) : alpha.example.net, identifiants Stripe fictifs.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  ANCHOR_EFFECTIVE_FROM_ISO,
  anchorEffectiveFromMs,
  anchoredPeriodAt,
  anchoredPeriodUsage,
  civilPeriod,
  currentPeriodFor,
  formatResetOfPeriod,
  periodLabelOf,
  recordSubscriptionAnchorInTx,
  resetsOnOf,
} from './quota-period.js';
import {
  attachSubscriptionInTx,
  chargeAllowanceThenCredits,
  checkAndIncrementQuota,
  decrementQuota,
  endSubscriptionOnKeyInTx,
  generateApiKey,
  getUsage,
  refundMixed,
  rotateApiKey,
} from './api-keys.js';
import { closeAll, getStatsDB } from './db.js';
import { processStripeEvent } from '../routes/stripe-webhook.js';
import { renewalPeriodStartUnix } from './subscription-payments.js';

afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => closeAll());

let seq = 0;
const uid = (tag: string) => `${tag}_${Date.now()}_${++seq}`;
const at = (iso: string) => new Date(iso);
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Une clé d'abonnement vivante, au mois civil tant qu'aucun renouvellement n'est payé. */
function subscriberKey(limit: number): { keyHash: string; subscriptionId: string } {
  const key = generateApiKey(`${uid('abonne')}@alpha.example.net`);
  if (!key) throw new Error('frappe impossible');
  const subscriptionId = uid('sub');
  const db = getStatsDB();
  const ok = db.transaction(() =>
    attachSubscriptionInTx(db, key.key_hash, subscriptionId, limit),
  )();
  expect(ok).toBe(true);
  return { keyHash: key.key_hash, subscriptionId };
}

function anchor(
  keyHash: string,
  subscriptionId: string,
  periodStart: string,
  paidAt: string = periodStart,
) {
  const db = getStatsDB();
  return db
    .transaction(() =>
      recordSubscriptionAnchorInTx(db, {
        keyHash,
        subscriptionId,
        periodStartUnix: unix(periodStart),
        nowMs: Date.parse(paidAt),
      }),
    )
    .immediate();
}

describe('anchoredPeriodAt : les débuts de période, à Zurich, au plus tôt', () => {
  it('abonnement du 10 : début de période = 00:00 à Zurich le 10 (hiver : 23:00 UTC la veille)', () => {
    const p = anchoredPeriodAt('2026-12-10T14:23:11.000Z', at('2026-12-20T12:00:00Z'));
    expect(p).toEqual({
      month: '2026-12',
      start: '2026-12-09T23:00:00.000Z',
      resetsAt: '2027-01-09T23:00:00.000Z',
      anchored: true,
      renewalDay: 10,
    });
    expect(resetsOnOf(p!)).toBe('2027-01-10');
    expect(periodLabelOf(p!)).toBe('2026-12-10');
    expect(formatResetOfPeriod(p!)).toBe('2027-01-10 00:00 Zurich time (2027-01-09 23:00 UTC)');
  });

  it('en été, minuit de Zurich est 22:00 UTC la veille', () => {
    const p = anchoredPeriodAt('2026-07-10T09:00:00.000Z', at('2026-07-15T00:00:00Z'));
    expect(p?.start).toBe('2026-07-09T22:00:00.000Z');
    expect(p?.resetsAt).toBe('2026-08-09T22:00:00.000Z');
  });

  it('arrondi en faveur du client : un début à 23:30 UTC est déjà le lendemain à Zurich, jamais plus tard que Stripe', () => {
    const stripeStart = '2026-12-10T23:30:00.000Z'; // le 11 à 00:30 à Zurich
    const p = anchoredPeriodAt(stripeStart, at('2026-12-11T01:00:00Z'))!;
    expect(p.start).toBe('2026-12-10T23:00:00.000Z');
    expect(Date.parse(p.start)).toBeLessThanOrEqual(Date.parse(stripeStart));
  });

  it('jour 31 : le dernier jour d’un mois plus court, puis de nouveau le 31 (calculé depuis l’ancre)', () => {
    const a = '2026-01-31T10:00:00.000Z';
    const startOf = (now: string) => anchoredPeriodAt(a, at(now))!.start;
    expect(startOf('2026-02-28T12:00:00Z')).toBe('2026-02-27T23:00:00.000Z'); // 28 février, Zurich
    expect(startOf('2026-03-31T12:00:00Z')).toBe('2026-03-30T22:00:00.000Z'); // 31 mars, heure d'été
    expect(startOf('2026-04-30T12:00:00Z')).toBe('2026-04-29T22:00:00.000Z'); // 30 avril
    expect(startOf('2026-05-31T12:00:00Z')).toBe('2026-05-30T22:00:00.000Z');
  });

  it('jour 29 et 30 d’une année bissextile : le 29 février 2028 existe', () => {
    const a29 = '2028-01-29T10:00:00.000Z';
    expect(anchoredPeriodAt(a29, at('2028-02-29T12:00:00Z'))!.start).toBe(
      '2028-02-28T23:00:00.000Z',
    );
    expect(anchoredPeriodAt(a29, at('2028-02-28T12:00:00Z'))!.start).toBe(
      '2028-01-28T23:00:00.000Z',
    );
    // 2027 n'est pas bissextile : le 29 devient le 28.
    expect(anchoredPeriodAt('2027-01-29T10:00:00.000Z', at('2027-02-28T12:00:00Z'))!.start).toBe(
      '2027-02-27T23:00:00.000Z',
    );
    // Un 31 janvier 2028 donne le 29 février, puis le 31 mars.
    const a31 = '2028-01-31T10:00:00.000Z';
    expect(anchoredPeriodAt(a31, at('2028-02-29T12:00:00Z'))!.start).toBe(
      '2028-02-28T23:00:00.000Z',
    );
    expect(anchoredPeriodAt(a31, at('2028-03-31T12:00:00Z'))!.start).toBe(
      '2028-03-30T22:00:00.000Z',
    );
  });

  it('le changement d’heure ne décale pas le jour : 00:00 à Zurich reste minuit des deux côtés', () => {
    const a = '2026-03-25T10:00:00.000Z';
    expect(anchoredPeriodAt(a, at('2026-03-26T00:00:00Z'))!.start).toBe('2026-03-24T23:00:00.000Z');
    // L'heure d'été commence le 29 mars 2026 : le 25 avril est à +2.
    expect(anchoredPeriodAt(a, at('2026-04-26T00:00:00Z'))!.start).toBe('2026-04-24T22:00:00.000Z');
  });

  it('la remise à zéro tombe à la seconde exacte : une seconde avant, encore la période ; à l’instant, la suivante', () => {
    const a = '2026-12-10T08:00:00.000Z';
    expect(anchoredPeriodAt(a, at('2027-01-09T22:59:59.999Z'))!.start).toBe(
      '2026-12-09T23:00:00.000Z',
    );
    expect(anchoredPeriodAt(a, at('2027-01-09T23:00:00.000Z'))!.start).toBe(
      '2027-01-09T23:00:00.000Z',
    );
  });
});

describe('aucune période n’est raccourcie par l’arrondi', () => {
  it('pour chaque jour d’ancrage, de 2026 à 2029, deux débuts de période se suivent de 28 à 31 jours (une heure de changement d’heure près), et jamais après l’instant de Stripe', () => {
    const DAY = 86_400_000;
    for (let day = 1; day <= 31; day++) {
      for (const startMonth of [0, 1, 6, 10]) {
        const anchorIso = new Date(
          Date.UTC(2026, startMonth, Math.min(day, 28), 13, 40),
        ).toISOString();
        // Jour 29 à 31 : on ancre sur un mois qui l'a.
        const real = new Date(Date.UTC(2026, startMonth === 1 ? 2 : startMonth, day, 13, 40));
        if (real.getUTCDate() !== day) continue;
        const a = real.toISOString();
        let previous = anchoredPeriodAt(a, new Date(a))!;
        expect(Date.parse(previous.start), anchorIso).toBeLessThanOrEqual(Date.parse(a));
        for (let k = 1; k < 40; k++) {
          const next = anchoredPeriodAt(a, new Date(Date.parse(previous.resetsAt)))!;
          expect(next.start).toBe(previous.resetsAt);
          const length = Date.parse(next.start) - Date.parse(previous.start);
          expect(length, `jour ${day}, période ${k}`).toBeGreaterThanOrEqual(28 * DAY - 3_600_000);
          expect(length, `jour ${day}, période ${k}`).toBeLessThanOrEqual(31 * DAY + 3_600_000);
          previous = next;
        }
      }
    }
  });
});

describe('règle 1 : la bascule se fait à la prochaine facture payée, jamais avant', () => {
  it('abonnement du 10 novembre, 9 500 sur 10 000 le 30 : le 1er décembre repart comme avant, la facture du 10 décembre ouvre une nouvelle période à 0', () => {
    const { keyHash, subscriptionId } = subscriberKey(10_000);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-30T12:00:00Z'));
    expect(checkAndIncrementQuota(keyHash, 10_000, 9_500).allowed).toBe(true);
    expect(currentPeriodFor(keyHash).anchored).toBe(false);
    expect(getUsage(keyHash, 10_000).used).toBe(9_500);

    // Le 1er décembre : la remise à zéro du mois civil, comme avant.
    vi.setSystemTime(at('2026-12-01T00:00:00Z'));
    const first = currentPeriodFor(keyHash);
    expect(first).toMatchObject({ anchored: false, month: '2026-12' });
    expect(getUsage(keyHash, 10_000).used).toBe(0);
    expect(checkAndIncrementQuota(keyHash, 10_000, 300).allowed).toBe(true);

    // Le 10 décembre au matin, tant que la facture n'est pas payée : toujours au mois civil.
    vi.setSystemTime(at('2026-12-10T05:00:00Z'));
    expect(currentPeriodFor(keyHash).anchored).toBe(false);
    expect(getUsage(keyHash, 10_000).used).toBe(300);

    // La facture de renouvellement est payée le 10 décembre à 08:12.
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    expect(anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z')).toBe('anchored');
    const p = currentPeriodFor(keyHash);
    expect(p).toEqual({
      month: '2026-12',
      start: '2026-12-09T23:00:00.000Z',
      resetsAt: '2027-01-09T23:00:00.000Z',
      anchored: true,
      renewalDay: 10,
    });
    expect(getUsage(keyHash, 10_000)).toMatchObject({
      used: 0,
      remaining: 10_000,
      month: '2026-12',
    });

    // Le plafond est celui de la clé : seule la période a changé.
    expect(checkAndIncrementQuota(keyHash, 10_000, 10_000).allowed).toBe(true);
    expect(checkAndIncrementQuota(keyHash, 10_000, 1).allowed).toBe(false);
    // Le compte civil de tous les appels reste complet (graphiques, rapports).
    const civil = getStatsDB()
      .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
      .get(keyHash, '2026-12') as { count: number };
    expect(civil.count).toBe(300 + 10_000);

    // Le 1er janvier n'est plus une remise à zéro : le compteur de la période continue.
    vi.setSystemTime(at('2027-01-01T00:30:00Z'));
    expect(currentPeriodFor(keyHash).start).toBe('2026-12-09T23:00:00.000Z');
    expect(checkAndIncrementQuota(keyHash, 10_000, 1).allowed).toBe(false);
    // Le 10 janvier à 00:00 à Zurich : remise à zéro.
    vi.setSystemTime(at('2027-01-09T23:00:00Z'));
    expect(checkAndIncrementQuota(keyHash, 10_000, 1).allowed).toBe(true);
    expect(currentPeriodFor(keyHash).resetsAt).toBe('2027-02-09T23:00:00.000Z');
  });

  it('une clé qui n’a jamais payé de renouvellement reste au mois civil, quelle que soit sa date d’abonnement', () => {
    const { keyHash } = subscriberKey(50);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const d of ['2026-12-10T12:00:00Z', '2027-02-14T12:00:00Z', '2028-02-29T12:00:00Z']) {
      vi.setSystemTime(at(d));
      expect(currentPeriodFor(keyHash)).toEqual(civilPeriod(at(d)));
    }
  });

  it('seule la facture d’une clé qui porte CET abonnement ancre quelque chose', () => {
    const { keyHash } = subscriberKey(50);
    expect(anchor(keyHash, 'sub_autre', '2026-12-10T08:00:00Z')).toBe('key_not_subscribed');
    expect(anchor(keyHash, 'sub_x', '2026-12-10T08:00:00Z')).toBe('key_not_subscribed');
    const db = getStatsDB();
    expect(
      db.prepare('SELECT 1 FROM subscription_periods WHERE key_hash = ?').get(keyHash),
    ).toBeUndefined();
  });

  it('un abonnement posé de nouveau sur une clé déjà basculée ouvre une période neuve (voir anchor2) ; sur une clé jamais basculée, elle reste au mois civil', () => {
    const fresh = subscriberKey(50);
    expect(currentPeriodFor(fresh.keyHash).anchored).toBe(false);
    const db0 = getStatsDB();
    db0.transaction(() => attachSubscriptionInTx(db0, fresh.keyHash, uid('sub_neuf0'), 50))();
    expect(currentPeriodFor(fresh.keyHash).anchored).toBe(false);
    const { keyHash, subscriptionId } = subscriberKey(50);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
    const db = getStatsDB();
    db.transaction(() => attachSubscriptionInTx(db, keyHash, uid('sub_neuf'), 50))();
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
  });
});

describe('règle 2 : la remise à zéro n’attend jamais un paiement', () => {
  it('facture suivante en retard ou jamais payée : la période suivante commence à la date prévue', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    expect(checkAndIncrementQuota(keyHash, 100, 100).allowed).toBe(true);
    expect(checkAndIncrementQuota(keyHash, 100, 1).allowed).toBe(false);

    // Janvier : la facture du 10 janvier est relancée, aucun webhook ne vient.
    vi.setSystemTime(at('2027-01-09T23:00:00Z'));
    expect(checkAndIncrementQuota(keyHash, 100, 1).allowed).toBe(true);
    vi.setSystemTime(at('2027-01-25T12:00:00Z'));
    expect(currentPeriodFor(keyHash).start).toBe('2027-01-09T23:00:00.000Z');
    // Février aussi, toujours sans facture.
    vi.setSystemTime(at('2027-02-09T23:00:00Z'));
    expect(currentPeriodFor(keyHash).start).toBe('2027-02-09T23:00:00.000Z');
    expect(getUsage(keyHash, 100).used).toBe(0);
  });

  it('la relance réussit tard : la période reste celle de la facturation, pas celle du paiement', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    // Facture du 10 décembre, payée seulement le 22.
    vi.setSystemTime(at('2026-12-22T09:00:00Z'));
    expect(anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z', '2026-12-22T09:00:00Z')).toBe(
      'anchored',
    );
    expect(currentPeriodFor(keyHash).start).toBe('2026-12-09T23:00:00.000Z');
    expect(currentPeriodFor(keyHash).resetsAt).toBe('2027-01-09T23:00:00.000Z');
  });

  it('une résiliation rend la clé au mois civil et à son allocation propre ; l’allocation d’abonné reste jusqu’à la fin', () => {
    const { keyHash, subscriptionId } = subscriberKey(10_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    // Résiliée en cours de période : tant que `subscription_ended_at` n'est pas posé
    // (fin de la période payée), l'allocation et la période restent.
    vi.setSystemTime(at('2026-12-28T12:00:00Z'));
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
    expect(checkAndIncrementQuota(keyHash, 10_000, 10_000).allowed).toBe(true);
    // La fin réelle de l'abonnement (logique existante) : au mois civil.
    vi.setSystemTime(at('2027-01-09T23:00:00Z'));
    const db = getStatsDB();
    db.transaction(() =>
      endSubscriptionOnKeyInTx(db, keyHash, subscriptionId, { monthlyLimit: 200, noRecredit: 0 }),
    )();
    expect(currentPeriodFor(keyHash)).toEqual(civilPeriod(new Date()));
  });
});

describe('règle 3 : arrondi en faveur du client, à l’enregistrement de la facture', () => {
  it('le début de période est celui de la facturation Stripe, ramené au début du jour à Zurich', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T23:45:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T23:30:00Z');
    // 23:30 UTC est déjà le 11 à Zurich : la période commence à minuit de Zurich, le 11.
    expect(currentPeriodFor(keyHash).start).toBe('2026-12-10T23:00:00.000Z');
    expect(resetsOnOf(currentPeriodFor(keyHash))).toBe('2027-01-11');
  });

  it('31 janvier puis 28 février : l’ancre ne dérive pas vers le 28 (le 31 mars reste le 31)', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2027-01-31T08:05:00Z'));
    expect(anchor(keyHash, subscriptionId, '2027-01-31T08:00:00Z')).toBe('anchored');
    vi.setSystemTime(at('2027-02-28T08:05:00Z'));
    expect(anchor(keyHash, subscriptionId, '2027-02-28T08:00:00Z')).toBe('unchanged');
    vi.setSystemTime(at('2027-03-31T12:00:00Z'));
    expect(currentPeriodFor(keyHash).start).toBe('2027-03-30T22:00:00.000Z');
    vi.setSystemTime(at('2027-03-30T21:59:59Z'));
    expect(currentPeriodFor(keyHash).start).toBe('2027-02-27T23:00:00.000Z');
  });

  it('une facture hors du calendrier connu (ancre de facturation changée) déplace l’ancre ; un évènement plus ancien est laissé', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:05:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    vi.setSystemTime(at('2027-01-17T08:05:00Z'));
    expect(anchor(keyHash, subscriptionId, '2027-01-17T08:00:00Z')).toBe('re_anchored');
    expect(currentPeriodFor(keyHash).start).toBe('2027-01-16T23:00:00.000Z');
    // Un évènement rejoué dans le désordre (la facture de décembre) ne remet rien en cause.
    expect(anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z', '2027-01-17T09:00:00Z')).toBe(
      'older_than_known',
    );
    expect(currentPeriodFor(keyHash).start).toBe('2027-01-16T23:00:00.000Z');
  });

  it('un début de période absurde n’ancre rien (loin dans le passé ou dans le futur)', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    expect(anchor(keyHash, subscriptionId, '2026-06-10T08:00:00Z', '2026-12-10T08:00:00Z')).toBe(
      'out_of_range',
    );
    expect(anchor(keyHash, subscriptionId, '2027-03-10T08:00:00Z', '2026-12-10T08:00:00Z')).toBe(
      'out_of_range',
    );
  });
});

describe('le quantième d’ancrage, pour dire « le 31 de chaque mois » même en février', () => {
  it('un abonnement du 31 janvier vu le 10 février : jour 31, prochaine date le 28', () => {
    const p = anchoredPeriodAt('2027-01-31T10:00:00.000Z', at('2027-02-10T12:00:00Z'))!;
    expect(p.renewalDay).toBe(31);
    expect(resetsOnOf(p)).toBe('2027-02-28');
    // Le mois civil n'a pas de jour d'ancrage.
    expect(civilPeriod(at('2027-02-10T12:00:00Z')).renewalDay).toBeNull();
  });
});

describe('la période de chaque clé ancrée, pour les rapports de l’exploitant', () => {
  it('anchoredPeriodUsage donne les appels de la période en cours, pas ceux du mois civil', () => {
    const { keyHash, subscriptionId } = subscriberKey(10_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-05T12:00:00Z'));
    checkAndIncrementQuota(keyHash, 10_000, 4_000);
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    checkAndIncrementQuota(keyHash, 10_000, 300);
    const used = anchoredPeriodUsage(getStatsDB(), new Date());
    expect(used.get(keyHash)).toBe(300);
    // Une clé non ancrée n'y figure pas.
    const other = subscriberKey(10);
    expect(used.has(other.keyHash)).toBe(false);
  });
});

describe('un rattachement rejoué du même abonnement ne fait pas retomber la clé au mois civil', () => {
  it('le même identifiant garde l’ancre ; un autre la remplace par une période neuve', () => {
    const { keyHash, subscriptionId } = subscriberKey(50);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    const db = getStatsDB();
    db.transaction(() => attachSubscriptionInTx(db, keyHash, subscriptionId, 50))();
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
    db.transaction(() => attachSubscriptionInTx(db, keyHash, uid('sub_autre'), 50))();
    // Un autre abonnement sur une clé déjà basculée : période neuve, toujours ancrée.
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
  });
});

describe('règle 5 : un plafond relevé à la main est gardé', () => {
  it('l’ancrage ne touche ni monthly_limit ni les crédits : seule la période change', () => {
    const { keyHash, subscriptionId } = subscriberKey(10_000);
    const db = getStatsDB();
    db.prepare(
      'UPDATE api_keys SET monthly_limit = 15000, credits_remaining = 40 WHERE key_hash = ?',
    ).run(keyHash);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    const row = db
      .prepare('SELECT monthly_limit, credits_remaining FROM api_keys WHERE key_hash = ?')
      .get(keyHash) as { monthly_limit: number; credits_remaining: number };
    expect(row).toEqual({ monthly_limit: 15_000, credits_remaining: 40 });
    // Mesuré sur le plafond relevé, sur le compteur de la période.
    expect(checkAndIncrementQuota(keyHash, 15_000, 15_000).allowed).toBe(true);
    expect(checkAndIncrementQuota(keyHash, 15_000, 1).allowed).toBe(false);
  });
});

describe('le compteur par période suit le compteur civil', () => {
  it('un 4xx remboursé retombe sur la période et sur le mois où l’appel a été facturé', () => {
    const { keyHash, subscriptionId } = subscriberKey(10);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    const q = checkAndIncrementQuota(keyHash, 10, 4);
    expect(q.periodStart).toBe('2026-12-09T23:00:00.000Z');
    expect(q.periodLabel).toBe('2026-12-10');
    expect(getUsage(keyHash, 10).used).toBe(4);
    // Le remboursement arrive après minuit le 1er janvier : il retombe sur la période facturée.
    vi.setSystemTime(at('2027-01-01T00:00:05Z'));
    decrementQuota(keyHash, 4, q.month, q.periodStart);
    expect(getUsage(keyHash, 10).used).toBe(0);
    const civil = getStatsDB()
      .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
      .get(keyHash, '2026-12') as { count: number };
    expect(civil.count).toBe(0);
  });

  it('une rotation emporte l’ancre et le compteur : la clé neuve reste à la même période, au même nombre d’appels', () => {
    const email = `${uid('rot')}@alpha.example.net`;
    const key = generateApiKey(email);
    if (!key) throw new Error('frappe impossible');
    const sub = uid('sub_rot');
    const db = getStatsDB();
    db.transaction(() => attachSubscriptionInTx(db, key.key_hash, sub, 10))();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(key.key_hash, sub, '2026-12-10T08:00:00Z');
    checkAndIncrementQuota(key.key_hash, 10, 7);
    const rotated = rotateApiKey(key.api_key);
    if (!rotated) throw new Error('rotation impossible');
    const newHash = (
      db.prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?').get(rotated.key_prefix) as {
        key_hash: string;
      }
    ).key_hash;
    expect(currentPeriodFor(newHash).anchored).toBe(true);
    expect(getUsage(newHash, 10).used).toBe(7);
    expect(currentPeriodFor(key.key_hash).anchored).toBe(false);
  });
});

// ─── L'invariant : jamais moins de remises à zéro cumulées qu'avec l'ancien compte

/** Un générateur déterministe, pour des scénarios qui se rejouent à l'identique. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  name: string;
  /** Le premier jour simulé (début de mois), l'abonnement existe déjà. */
  from: string;
  days: number;
  limit: number;
  /** Les débuts de période de facturation (Stripe) des factures de renouvellement, et leur date de paiement. */
  invoices: Array<{ periodStart: string; paidAt: string }>;
}

/**
 * Un client qui dépense dès que c'est disponible : combien d'appels sont servis EN
 * CUMUL, à chaque pas de six heures, avec le nouveau compte et avec l'ancien (le
 * mois civil seul, calculé à part). Rend la première date où le nouveau compte a
 * servi MOINS que l'ancien, ou null.
 *
 * Ce que cela prouve : le nombre cumulé d'appels autorisés n'est jamais inférieur
 * à celui de l'ancien compte. Ce que cela ne prouve pas : qu'une demande isolée
 * soit toujours servie. Déplacer la date de remise à zéro peut refuser à un
 * client qui garde son allocation pour la fin de période, entre le 1er et son jour
 * anniversaire, un appel que le mois civil aurait servi ; c'est inhérent au
 * déplacement, et la bascule (une remise à zéro de plus) le paie d'avance.
 */
function firstShortfall(sc: Scenario): { at: string; neu: number; old: number } | null {
  const { keyHash, subscriptionId } = subscriberKey(sc.limit);
  vi.useFakeTimers({ toFake: ['Date'] });
  const oldCounts = new Map<string, number>();
  let neu = 0;
  let old = 0;
  const pending = [...sc.invoices].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt));
  const step = 6 * 3_600_000;
  const t0 = Date.parse(sc.from);
  for (let t = t0; t < t0 + sc.days * 86_400_000; t += step) {
    // Les factures payées dans l'intervalle, à l'instant exact de leur paiement.
    while (pending.length && Date.parse(pending[0].paidAt) <= t) {
      const inv = pending.shift()!;
      vi.setSystemTime(Date.parse(inv.paidAt));
      anchor(keyHash, subscriptionId, inv.periodStart, inv.paidAt);
    }
    vi.setSystemTime(t);
    // Nouveau compte : tant que c'est servi.
    for (let i = 0; i < sc.limit + 1; i++) {
      if (!checkAndIncrementQuota(keyHash, sc.limit, 1).allowed) break;
      neu++;
    }
    // Ancien compte : le mois civil UTC seul.
    const month = new Date(t).toISOString().slice(0, 7);
    const used = oldCounts.get(month) ?? 0;
    const room = Math.max(0, sc.limit - used);
    oldCounts.set(month, used + room);
    old += room;
    if (neu < old) return { at: new Date(t).toISOString(), neu, old };
  }
  return null;
}

/** Les débuts de période d'un abonnement Stripe de jour `day`, mois après mois (jour ramené au dernier jour du mois). */
function stripeStarts(first: string, day: number, count: number): string[] {
  const f = new Date(first);
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    const total = f.getUTCFullYear() * 12 + f.getUTCMonth() + k;
    const y = Math.floor(total / 12);
    const m = total % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    out.push(
      new Date(
        Date.UTC(y, m, Math.min(day, last), f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds()),
      ).toISOString(),
    );
  }
  return out;
}

describe('règle 4 : aucun client n’a jamais moins de remises à zéro cumulées qu’avec l’ancien compte', () => {
  const monthly = (first: string, day: number, count: number, lateDays: number) =>
    stripeStarts(first, day, count).map((periodStart) => ({
      periodStart,
      paidAt: new Date(Date.parse(periodStart) + lateDays * 86_400_000 + 600_000).toISOString(),
    }));

  const scenarios: Scenario[] = [
    {
      name: 'abonnement du 10 novembre, factures payées à l’heure',
      from: '2026-11-01T00:00:00Z',
      days: 240,
      limit: 3,
      invoices: monthly('2026-12-10T08:00:00Z', 10, 7, 0),
    },
    {
      name: 'abonnement du 31 octobre (28 février, 29 février 2028 compris)',
      from: '2027-10-01T00:00:00Z',
      days: 330,
      limit: 2,
      invoices: monthly('2027-11-30T09:30:00Z', 31, 10, 0),
    },
    {
      name: 'abonnement du 29 janvier 2028, février bissextile',
      from: '2028-01-01T00:00:00Z',
      days: 200,
      limit: 3,
      invoices: monthly('2028-02-29T11:00:00Z', 29, 6, 0),
    },
    {
      name: 'première facture relancée et payée vingt jours après',
      from: '2026-11-01T00:00:00Z',
      days: 220,
      limit: 2,
      invoices: monthly('2026-12-12T08:00:00Z', 12, 6, 20),
    },
    {
      name: 'factures payées tard chaque mois (cinq jours)',
      from: '2026-12-01T00:00:00Z',
      days: 220,
      limit: 2,
      invoices: monthly('2026-12-26T08:00:00Z', 26, 6, 5),
    },
    {
      name: 'une facture sautée au milieu (relance qui n’aboutit pas), puis la suivante payée',
      from: '2026-11-01T00:00:00Z',
      days: 240,
      limit: 3,
      invoices: monthly('2026-12-10T08:00:00Z', 10, 7, 0).filter((_, i) => i !== 2),
    },
    {
      name: 'aucun renouvellement payé : rien ne change, rien ne manque',
      from: '2026-11-01T00:00:00Z',
      days: 120,
      limit: 3,
      invoices: [],
    },
    {
      name: 'abonnement du 1er du mois',
      from: '2026-11-01T00:00:00Z',
      days: 150,
      limit: 2,
      invoices: monthly('2026-12-01T00:10:00Z', 1, 4, 0),
    },
    {
      name: 'abonnement du 30, février court',
      from: '2026-11-01T00:00:00Z',
      days: 200,
      limit: 3,
      invoices: monthly('2026-11-30T10:00:00Z', 30, 6, 1),
    },
  ];

  for (const sc of scenarios) {
    it(sc.name, () => {
      expect(firstShortfall(sc)).toBeNull();
    });
  }

  it('propriété : sur des scénarios tirés au sort (jour 1 à 31, retard de 0 à 25 jours, factures manquantes), jamais moins de remises cumulées qu’avec l’ancien compte', () => {
    const rnd = mulberry32(20261127);
    for (let i = 0; i < 40; i++) {
      const monthIndex = Math.floor(rnd() * 24); // 2026-11 à 2028-10
      const base = new Date(Date.UTC(2026, 10 + monthIndex, 1));
      const day = 1 + Math.floor(rnd() * 31);
      const hour = Math.floor(rnd() * 24);
      const late = Math.floor(rnd() * 26);
      const limit = 2 + Math.floor(rnd() * 3);
      const skip = rnd() < 0.3 ? 1 + Math.floor(rnd() * 3) : -1;
      const firstStart = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, hour, 17),
      ).toISOString();
      const invoices = monthly(firstStart, day, 6, late).filter((_, k) => k !== skip);
      const sc: Scenario = {
        name: `tirage ${i}`,
        from: base.toISOString(),
        days: 200,
        limit,
        invoices,
      };
      const shortfall = firstShortfall(sc);
      expect(
        shortfall,
        `tirage ${i} : jour ${day}, retard ${late}, début ${firstStart}`,
      ).toBeNull();
    }
  });

  it('et la bascule rapporte réellement : plus d’appels servis que l’ancien compte autour de la bascule', () => {
    const sc: Scenario = {
      name: 'gain',
      from: '2026-12-01T00:00:00Z',
      days: 30,
      limit: 5,
      invoices: [{ periodStart: '2026-12-10T08:00:00Z', paidAt: '2026-12-10T08:10:00Z' }],
    };
    const { keyHash, subscriptionId } = subscriberKey(sc.limit);
    vi.useFakeTimers({ toFake: ['Date'] });
    let neu = 0;
    for (const t of ['2026-12-05T12:00:00Z', '2026-12-10T09:00:00Z']) {
      vi.setSystemTime(at(t));
      if (t.startsWith('2026-12-10'))
        anchor(keyHash, subscriptionId, sc.invoices[0].periodStart, t);
      for (let i = 0; i < 20; i++) {
        if (!checkAndIncrementQuota(keyHash, sc.limit, 1).allowed) break;
        neu++;
      }
    }
    // Le 5 : 5 appels (comme avant) ; le 10 : 5 de plus, que l'ancien compte n'accordait pas avant le 1er janvier.
    expect(neu).toBe(10);
  });
});

describe('la clé mixte (allocation puis crédits) se mesure aussi sur la période', () => {
  it('l’allocation de la période passe d’abord, les crédits ensuite ; un 4xx rembourse les deux compteurs', () => {
    const { keyHash, subscriptionId } = subscriberKey(3);
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 10, credits_total = 10 WHERE key_hash = ?')
      .run(keyHash);
    vi.useFakeTimers({ toFake: ['Date'] });
    // Le mois civil de décembre a déjà consommé 3 : sans la bascule, plus d'allocation.
    vi.setSystemTime(at('2026-12-05T12:00:00Z'));
    expect(chargeAllowanceThenCredits(keyHash, 3, 3).fromAllowance).toBe(3);
    vi.setSystemTime(at('2026-12-10T08:12:00Z'));
    anchor(keyHash, subscriptionId, '2026-12-10T08:00:00Z');
    const c = chargeAllowanceThenCredits(keyHash, 3, 5);
    expect(c).toMatchObject({
      allowed: true,
      fromAllowance: 3,
      fromCredits: 2,
      periodStart: '2026-12-09T23:00:00.000Z',
      periodLabel: '2026-12-10',
    });
    refundMixed(keyHash, c);
    expect(getUsage(keyHash, 3).used).toBe(0);
    const credits = getStatsDB()
      .prepare('SELECT credits_remaining FROM api_keys WHERE key_hash = ?')
      .get(keyHash) as { credits_remaining: number };
    expect(credits.credits_remaining).toBe(10);
  });
});

describe('le webhook invoice.paid ancre la clé depuis la période de la facture', () => {
  function checkout(sub: string, email: string): Stripe.Event {
    return {
      id: uid('evt_co'),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: uid('cs_test'),
          metadata: { plan: 'pro' },
          customer_email: email,
          customer_details: { email },
          payment_status: 'paid',
          mode: 'subscription',
          subscription: sub,
          amount_total: 2900,
          currency: 'usd',
        },
      },
    } as unknown as Stripe.Event;
  }

  function invoice(opts: {
    sub: string;
    reason?: string;
    lines: unknown[];
    paidAtIso: string;
  }): Stripe.Event {
    return {
      id: uid('evt_inv'),
      type: 'invoice.paid',
      created: unix(opts.paidAtIso),
      data: {
        object: {
          id: uid('in'),
          object: 'invoice',
          billing_reason: opts.reason ?? 'subscription_cycle',
          amount_paid: 2900,
          currency: 'usd',
          status: 'paid',
          status_transitions: { paid_at: unix(opts.paidAtIso) },
          parent: {
            type: 'subscription_details',
            subscription_details: { subscription: opts.sub, metadata: {} },
          },
          lines: { data: opts.lines },
        },
      },
    } as unknown as Stripe.Event;
  }

  const line = (start: string, end: string, extra: object = {}) => ({
    period: { start: unix(start), end: unix(end) },
    ...extra,
  });

  it('abonné Pro : bascule à la facture de renouvellement, pas à la première facture', () => {
    const sub = uid('sub_hook');
    const minted = processStripeEvent(checkout(sub, `${uid('pro')}@alpha.example.net`));
    const keyHash = (
      getStatsDB()
        .prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?')
        .get(minted.body.key_prefix as string) as { key_hash: string }
    ).key_hash;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-10T09:00:00Z'));

    // La facture de création : rien ne bascule.
    const first = processStripeEvent(
      invoice({
        sub,
        reason: 'subscription_create',
        lines: [line('2026-11-10T08:00:00Z', '2026-12-10T08:00:00Z')],
        paidAtIso: '2026-11-10T08:00:30Z',
      }),
    );
    expect(first.body.recorded).toBe(false);
    expect(currentPeriodFor(keyHash).anchored).toBe(false);

    // Le renouvellement du 10 décembre, payé tard (le 14) : la période est celle de la facturation.
    vi.setSystemTime(at('2026-12-14T10:00:00Z'));
    const renewal = processStripeEvent(
      invoice({
        sub,
        lines: [
          // Une ligne de prorata d'une modification de formule : écartée.
          line('2026-12-01T00:00:00Z', '2026-12-10T08:00:00Z', { proration: true }),
          line('2026-12-10T08:00:00Z', '2027-01-10T08:00:00Z'),
        ],
        paidAtIso: '2026-12-14T09:59:00Z',
      }),
    );
    expect(renewal.body.recorded).toBe(true);
    expect(renewal.body.period_anchor).toBe('anchored');
    expect(currentPeriodFor(keyHash)).toMatchObject({
      anchored: true,
      start: '2026-12-09T23:00:00.000Z',
      resetsAt: '2027-01-09T23:00:00.000Z',
    });
  });

  it('avec la vraie date (28.12.2026) : un renouvellement de décembre laisse la clé au mois civil, celui de janvier la fait basculer', () => {
    const saved = process.env.IBF_ANCHOR_EFFECTIVE_FROM;
    process.env.IBF_ANCHOR_EFFECTIVE_FROM = ANCHOR_EFFECTIVE_FROM_ISO;
    try {
      const sub = uid('sub_hook_vrai');
      const minted = processStripeEvent(checkout(sub, `${uid('pro')}@alpha.example.net`));
      const keyHash = (
        getStatsDB()
          .prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?')
          .get(minted.body.key_prefix as string) as { key_hash: string }
      ).key_hash;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(at('2026-12-10T09:00:00Z'));
      const december = processStripeEvent(
        invoice({
          sub,
          lines: [line('2026-12-10T08:00:00Z', '2027-01-10T08:00:00Z')],
          paidAtIso: '2026-12-10T08:30:00Z',
        }),
      );
      expect(december.body.recorded).toBe(true);
      expect(december.body.period_anchor).toBe('before_effective');
      expect(
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM subscription_periods WHERE key_hash = ?')
          .get(keyHash),
      ).toEqual({ n: 0 });
      expect(currentPeriodFor(keyHash).anchored).toBe(false);
      vi.setSystemTime(at('2027-01-01T12:00:00Z'));
      expect(currentPeriodFor(keyHash).start).toBe('2027-01-01T00:00:00.000Z');

      vi.setSystemTime(at('2027-01-10T09:00:00Z'));
      const january = processStripeEvent(
        invoice({
          sub,
          lines: [line('2027-01-10T08:00:00Z', '2027-02-10T08:00:00Z')],
          paidAtIso: '2027-01-10T08:30:00Z',
        }),
      );
      expect(january.body.period_anchor).toBe('anchored');
      expect(currentPeriodFor(keyHash)).toMatchObject({
        anchored: true,
        start: '2027-01-09T23:00:00.000Z',
        resetsAt: '2027-02-09T23:00:00.000Z',
      });
    } finally {
      process.env.IBF_ANCHOR_EFFECTIVE_FROM = saved;
    }
  });

  it('une facture rejouée sous un autre évènement, ou sans période, n’ancre rien', () => {
    const sub = uid('sub_hook2');
    const minted = processStripeEvent(checkout(sub, `${uid('pro')}@alpha.example.net`));
    const keyHash = (
      getStatsDB()
        .prepare('SELECT key_hash FROM api_keys WHERE key_prefix = ?')
        .get(minted.body.key_prefix as string) as { key_hash: string }
    ).key_hash;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T09:00:00Z'));
    const none = processStripeEvent(invoice({ sub, lines: [], paidAtIso: '2026-12-10T08:30:00Z' }));
    expect(none.body.period_anchor).toBe('no_period_on_invoice');
    expect(currentPeriodFor(keyHash).anchored).toBe(false);
  });

  it('renewalPeriodStartUnix : la ligne d’abonnement la plus récente, jamais invoice.period_start', () => {
    expect(
      renewalPeriodStartUnix({
        period_start: 1,
        lines: {
          data: [
            line('2026-11-10T08:00:00Z', '2026-12-10T08:00:00Z'),
            line('2026-12-10T08:00:00Z', '2027-01-10T08:00:00Z'),
          ],
        },
      }),
    ).toBe(unix('2026-12-10T08:00:00Z'));
    expect(renewalPeriodStartUnix({ lines: { data: [] } })).toBeNull();
    expect(renewalPeriodStartUnix({})).toBeNull();
    expect(renewalPeriodStartUnix(null)).toBeNull();
  });
});

describe('mise en vigueur : 30 jours de préavis (conditions §9, version 1.12)', () => {
  const real = Date.parse(ANCHOR_EFFECTIVE_FROM_ISO);
  function anchorReal(keyHash: string, subscriptionId: string, periodStart: string) {
    const db = getStatsDB();
    return db
      .transaction(() =>
        recordSubscriptionAnchorInTx(db, {
          keyHash,
          subscriptionId,
          periodStartUnix: unix(periodStart),
          nowMs: Date.parse(periodStart),
          effectiveFromMs: real,
        }),
      )
      .immediate();
  }

  it('la date est le 28 décembre 2026 à 00:00 à Zurich', () => {
    expect(ANCHOR_EFFECTIVE_FROM_ISO).toBe('2026-12-27T23:00:00.000Z');
  });

  it('une facture dont la période commence avant le 28.12 laisse la clé au mois civil', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    expect(anchorReal(keyHash, subscriptionId, '2026-12-10T08:00:00Z')).toBe('before_effective');
    expect(anchorReal(keyHash, subscriptionId, '2026-12-27T22:59:59Z')).toBe('before_effective');
    const db = getStatsDB();
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM subscription_periods WHERE key_hash = ?').get(keyHash),
    ).toEqual({ n: 0 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-20T12:00:00Z'));
    expect(currentPeriodFor(keyHash).start).toBe(civilPeriod(at('2026-12-20T12:00:00Z')).start);
    vi.useRealTimers();
  });

  it('la première facture dont la période commence le 28.12 ou après fait basculer la clé', () => {
    const { keyHash, subscriptionId } = subscriberKey(100);
    expect(anchorReal(keyHash, subscriptionId, '2026-12-27T23:00:00Z')).toBe('anchored');
    const other = subscriberKey(100);
    expect(anchorReal(other.keyHash, other.subscriptionId, '2027-01-10T08:00:00Z')).toBe(
      'anchored',
    );
  });

  it('hors des essais, la date ne se déplace pas', () => {
    const saved = process.env.VITEST;
    const savedOverride = process.env.IBF_ANCHOR_EFFECTIVE_FROM;
    try {
      process.env.IBF_ANCHOR_EFFECTIVE_FROM = '2000-01-01T00:00:00.000Z';
      delete process.env.VITEST;
      expect(anchorEffectiveFromMs()).toBe(real);
    } finally {
      process.env.VITEST = saved;
      process.env.IBF_ANCHOR_EFFECTIVE_FROM = savedOverride;
    }
  });
});
