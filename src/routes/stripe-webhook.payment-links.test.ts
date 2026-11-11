/**
 * Les liens de paiement reconnus par le webhook Stripe, en OBSERVATION
 * seulement (SEC-09#2, audit du 10.11.2026).
 *
 * Un client qui a payé est toujours livré : sans liste rien ne change ; avec
 * une liste, un paiement venu d'un lien hors liste est livré exactement comme
 * avant et lève une alerte d'exploitation, une par épisode. Jamais sur un
 * évènement rejoué ou une session déjà livrée, jamais sur une session encore en
 * attente de paiement, jamais sur une session créée par l'API (audit de
 * fichier). Tous les identifiants ici sont inventés.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

vi.mock('../lib/ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ops-alert.js')>();
  return {
    ...actual,
    opsFail: vi.fn(async () => undefined),
    opsOk: vi.fn(async () => undefined),
  };
});

import {
  PAYMENT_LINK_UNLISTED_ALERT,
  notePaymentLinkObservation,
  processStripeEvent,
  resetPaymentLinkObservation,
  resetStripeClient,
  sendWebhookAlertsUnderTest,
  stripeWebhook,
} from './stripe-webhook.js';
import {
  PAYMENT_LINK_ALLOWLIST_ENV,
  checkPaymentLink,
  paymentLinkAllowlist,
} from '../lib/payment-links.js';
import { generateApiKey } from '../lib/api-keys.js';
import { createAuditJob, getAuditJob } from '../lib/audit-jobs.js';
import { ensureTopupRef } from '../lib/key-purchases.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { opsFail, opsOk } from '../lib/ops-alert.js';

const SK = 'sk_test_fictif_sans_compte';
const WHSEC = 'whsec_fictif_sans_compte';

/** Des liens inventés : aucun n'existe chez Stripe. */
const PACK_LINK = 'plink_TestPackAlpha1k';
const PRO_LINK = 'plink_TestProAlpha';
const OEM_LINK = 'plink_TestOemAlpha';
const FOREIGN_LINK = 'plink_TestAutreProduitBeta';
const LIST = `${PACK_LINK}, ${PRO_LINK} ${OEM_LINK}`;

let seq = 0;
const uniq = (tag: string): string => `${tag}_${Date.now()}_${++seq}`;
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.mocked(opsFail).mockClear();
  vi.mocked(opsOk).mockClear();
});

afterEach(() => {
  sendWebhookAlertsUnderTest(false);
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  resetStripeClient();
});

afterAll(() => closeAll());

function checkout(opts: {
  link: unknown;
  plan?: 'pro' | 'oem';
  bundle?: string;
  sessionId?: string;
  eventId?: string;
  type?: string;
  paymentStatus?: 'paid' | 'unpaid';
  clientReferenceId?: string;
}): Stripe.Event {
  const sessionId = opts.sessionId ?? `cs_test_${uniq('lien')}`;
  return {
    id: opts.eventId ?? `evt_${uniq('lien')}`,
    type: opts.type ?? 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        metadata: opts.plan ? { plan: opts.plan } : { bundle: opts.bundle ?? '1k' },
        payment_link: opts.link,
        client_reference_id: opts.clientReferenceId ?? null,
        customer_email: null,
        customer_details: null,
        payment_status: opts.paymentStatus ?? 'paid',
        amount_total: opts.plan ? 2900 : 400,
        currency: 'usd',
        ...(opts.plan ? { mode: 'subscription', subscription: `sub_${uniq('lien')}` } : {}),
      },
    },
  } as unknown as Stripe.Event;
}

const sessionOf = (event: Stripe.Event): string =>
  (event.data.object as unknown as { id: string }).id;

/** Les clés que cette session a frappées. */
function keysOf(sessionId: string): number {
  return (
    getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE stripe_session_id = ?')
      .get(sessionId) as { n: number }
  ).n;
}

describe('la liste, lue dans l’environnement', () => {
  it('absente ou vide : off ; posée : dans la liste ou hors liste, rien d’autre', () => {
    expect(paymentLinkAllowlist({})).toBeNull();
    expect(paymentLinkAllowlist({ [PAYMENT_LINK_ALLOWLIST_ENV]: ' , ' })).toBeNull();
    expect(checkPaymentLink(FOREIGN_LINK, {})).toBe('off');
    const list = { [PAYMENT_LINK_ALLOWLIST_ENV]: LIST };
    expect(checkPaymentLink(PRO_LINK, list)).toBe('listed');
    expect(checkPaymentLink(OEM_LINK, list)).toBe('listed');
    expect(checkPaymentLink(FOREIGN_LINK, list)).toBe('unlisted');
    expect(checkPaymentLink(null, list)).toBe('unlisted');
  });
});

describe('sans liste : rien ne change', () => {
  it('un Pro venu de n’importe quel lien est livré, sans observation', () => {
    const event = checkout({ link: FOREIGN_LINK, plan: 'pro' });
    const result = processStripeEvent(event);
    expect(result.body.key_prefix).toBeTruthy();
    expect(result.alert).toBeUndefined();
    expect(result.paymentLink).toBeUndefined();
    expect(keysOf(sessionOf(event))).toBe(1);
  });
});

describe('liste posée : livré comme avant, observé', () => {
  beforeEach(() => vi.stubEnv(PAYMENT_LINK_ALLOWLIST_ENV, LIST));

  it('Pro, lien hors liste : livré, et observé hors liste', () => {
    const event = checkout({ link: FOREIGN_LINK, plan: 'pro' });
    const result = processStripeEvent(event);
    expect(result.body.error).toBeUndefined();
    expect(result.body.key_prefix).toBeTruthy();
    expect(keysOf(sessionOf(event))).toBe(1);
    expect(result.paymentLink).toBe('unlisted');
  });

  it('OEM : lien hors liste livré et observé hors liste ; lien de la liste observé dedans', () => {
    const foreign = checkout({ link: FOREIGN_LINK, plan: 'oem' });
    const foreignResult = processStripeEvent(foreign);
    expect(foreignResult.body.plan).toBe('oem');
    expect(keysOf(sessionOf(foreign))).toBe(1);
    expect(foreignResult.paymentLink).toBe('unlisted');
    const listed = processStripeEvent(checkout({ link: OEM_LINK, plan: 'oem' }));
    expect(listed.paymentLink).toBe('listed');
  });

  it('un lien présenté sous forme d’objet étendu est lu par son identifiant', () => {
    const event = checkout({ link: { id: PRO_LINK, object: 'payment_link' }, plan: 'pro' });
    expect(processStripeEvent(event).paymentLink).toBe('listed');
  });

  it('pack neuf et recharge d’une clé : observés tous les deux', () => {
    const fresh = processStripeEvent(checkout({ link: PACK_LINK, bundle: '1k' }));
    expect(fresh.body.credits_minted).toBe(1000);
    expect(fresh.paymentLink).toBe('listed');

    const key = generateApiKey(`lien-${Date.now()}@alpha.example.net`);
    if (!key) throw new Error('frappe impossible');
    const ref = ensureTopupRef(key.key_hash);
    if (!ref) throw new Error('référence impossible');
    const topup = processStripeEvent(
      checkout({ link: FOREIGN_LINK, bundle: '5k', clientReferenceId: ref }),
    );
    expect((topup.body.topup as { outcome: string }).outcome).toBe('credited');
    expect(topup.paymentLink).toBe('unlisted');
  });

  it('jamais sur un rejeu : ni le même évènement, ni un autre évènement d’une session livrée', () => {
    const sessionId = `cs_test_${uniq('rejeu')}`;
    const first = checkout({ link: FOREIGN_LINK, plan: 'pro', sessionId });
    expect(processStripeEvent(first).paymentLink).toBe('unlisted');
    const sameEvent = processStripeEvent(first);
    expect(sameEvent.body.idempotent).toBe(true);
    expect(sameEvent.paymentLink).toBeUndefined();
    const later = processStripeEvent(
      checkout({
        link: FOREIGN_LINK,
        plan: 'pro',
        sessionId,
        type: 'checkout.session.async_payment_succeeded',
      }),
    );
    expect(later.body.idempotent).toBe(true);
    expect(later.paymentLink).toBeUndefined();
    expect(keysOf(sessionId)).toBe(1);
  });

  it('jamais sur une session encore en attente de paiement', () => {
    const result = processStripeEvent(
      checkout({ link: FOREIGN_LINK, bundle: '1k', paymentStatus: 'unpaid' }),
    );
    expect(result.body.pending).toBe(true);
    expect(result.paymentLink).toBeUndefined();
  });

  it('un audit de fichier, session créée par l’API sans lien : payé, jamais observé', () => {
    const job = createAuditJob({
      filename: 'fictif.csv',
      rows: 3,
      tier: 'standard',
      price: 149,
      currency: 'USD',
      lang: 'fr',
      summary: {
        rows: 3,
        ok: 3,
        warning: 0,
        error: 0,
        by_code: {},
        countries: [],
        rows_without_authoritative_register: 0,
        columns_detected: ['iban'],
        address_checked: false,
        tier: 'standard',
        price: 149,
        currency: 'USD',
      },
      preview: [],
      report: Buffer.from('rapport fictif'),
    });
    const event = {
      id: `evt_${uniq('audit')}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${uniq('audit')}`,
          object: 'checkout.session',
          status: 'complete',
          payment_status: 'paid',
          payment_link: null,
          amount_total: 14900,
          currency: 'usd',
          customer_email: null,
          customer_details: null,
          metadata: { audit_job: job.id },
        },
      },
    } as unknown as Stripe.Event;
    const result = processStripeEvent(event);
    expect(result.body.paid).toBe(true);
    expect(result.alert).toBeUndefined();
    expect(result.paymentLink).toBeUndefined();
    expect(getAuditJob(job.id)?.paid_at).toBeTruthy();
  });

  it('une alerte par épisode, sans donnée de personne, refermée par un lien de la liste', () => {
    resetPaymentLinkObservation();
    notePaymentLinkObservation('unlisted');
    notePaymentLinkObservation('unlisted');
    // ops-alert n'envoie qu'un message tant que la clé est ouverte : deux
    // appels sur la même clé, un seul épisode.
    const keys = vi.mocked(opsFail).mock.calls.map(([key]) => key);
    expect(new Set(keys)).toEqual(new Set([PAYMENT_LINK_UNLISTED_ALERT]));
    const detail = String(vi.mocked(opsFail).mock.calls[0][1]);
    expect(detail).not.toMatch(/@|\$|USD|cs_|plink_|\d/);

    notePaymentLinkObservation('listed');
    notePaymentLinkObservation('listed');
    expect(vi.mocked(opsOk)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(opsOk).mock.calls[0][0]).toBe(PAYMENT_LINK_UNLISTED_ALERT);
  });
});

describe('la route signée réelle, alertes rallumées pour ce seul test', () => {
  function signedSend(event: Stripe.Event): Promise<Response> {
    const payload = JSON.stringify(event);
    const signature = new Stripe(SK).webhooks.generateTestHeaderString({
      payload,
      secret: WHSEC,
    });
    return Promise.resolve(
      stripeWebhook.request('/v1/stripe/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      }),
    );
  }

  it('hors liste : livré et alerté ; un rejeu ne rouvre ni ne referme rien ; un lien listé neuf referme', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', SK);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WHSEC);
    vi.stubEnv(PAYMENT_LINK_ALLOWLIST_ENV, LIST);
    // Aucun message ne sort : la notification d'achat n'a ni jeton ni réseau.
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    vi.stubEnv('TELEGRAM_CHAT_ID', '');
    globalThis.fetch = vi.fn(async () => new Response('{"ok":true}')) as unknown as typeof fetch;
    resetStripeClient();
    resetPaymentLinkObservation();
    sendWebhookAlertsUnderTest(true);

    // A : une livraison venue d'un lien de la liste, alerte fermée.
    const listedSession = `cs_test_${uniq('route-a')}`;
    const a = await signedSend(checkout({ link: PRO_LINK, plan: 'pro', sessionId: listedSession }));
    expect(a.status).toBe(200);
    expect(vi.mocked(opsOk)).not.toHaveBeenCalled();

    // B : hors liste, livré comme avant, et l'alerte part.
    const b = checkout({ link: FOREIGN_LINK, plan: 'pro' });
    const bRes = await signedSend(b);
    expect(bRes.status).toBe(200);
    expect(((await bRes.json()) as { key_prefix?: string }).key_prefix).toBeTruthy();
    expect(keysOf(sessionOf(b))).toBe(1);
    expect(vi.mocked(opsFail).mock.calls.map(([key]) => key)).toEqual([
      PAYMENT_LINK_UNLISTED_ALERT,
    ]);

    // Rejeu de B (même évènement) : rien de plus.
    await signedSend(b);
    // Rejeu de A (autre évènement, session déjà livrée, lien listé) : il ne
    // referme pas l'alerte ouverte par B.
    await signedSend(
      checkout({
        link: PRO_LINK,
        plan: 'pro',
        sessionId: listedSession,
        type: 'checkout.session.async_payment_succeeded',
      }),
    );
    expect(vi.mocked(opsFail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(opsOk)).not.toHaveBeenCalled();

    // C : une livraison NEUVE d'un lien de la liste referme l'épisode.
    await signedSend(checkout({ link: PACK_LINK, bundle: '1k' }));
    expect(vi.mocked(opsOk)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(opsOk).mock.calls[0][0]).toBe(PAYMENT_LINK_UNLISTED_ALERT);
  });
});
