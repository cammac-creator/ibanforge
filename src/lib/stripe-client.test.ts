import { afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { createStripeClient } from './stripe-client.js';
import * as stripeFactory from './stripe-client.js';
import { receiptLinkFor, setReceiptUrlFetcherForTests } from './account-receipts.js';
import type { OwnedPurchase } from './account.js';

afterEach(() => {
  setReceiptUrlFetcherForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Contrat HTTP Stripe 23, transport simulé', () => {
  it('relit le reçu avec un mandat chaîne ou développé et conserve le délai du lecteur', async () => {
    const url = 'https://pay.stripe.com/receipts/payment/fictif';
    let mandate: string | { id: string; object: string } = 'mandate_fictif';
    const transport = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: 'cs_test_recu',
            object: 'checkout.session',
            payment_intent: {
              id: 'pi_test_recu',
              object: 'payment_intent',
              latest_charge: {
                id: 'ch_test_recu',
                object: 'charge',
                receipt_url: url,
                payment_method_details: { type: 'card', card: { mandate } },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = createStripeClient('sk_test_fictif_sans_compte', {
      httpClient: Stripe.createFetchHttpClient(transport),
      maxNetworkRetries: 0,
    });
    const factory = vi.spyOn(stripeFactory, 'createStripeClient').mockReturnValue(client);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fictif_sans_compte');
    setReceiptUrlFetcherForTests(null);
    const purchase = {
      id: 1,
      rail: 'card',
      kind: 'pack',
      stripe_session_id: 'cs_test_recu',
    } as OwnedPurchase;
    expect(await receiptLinkFor(purchase)).toEqual({ kind: 'ok', url });
    mandate = { id: 'mandate_fictif', object: 'mandate' };
    expect(await receiptLinkFor({ ...purchase, id: 2 })).toEqual({ kind: 'ok', url });
    expect(factory).toHaveBeenCalledWith('sk_test_fictif_sans_compte', {
      timeout: 8000,
      maxNetworkRetries: 1,
    });
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [requestUrl, init] of transport.mock.calls) {
      const requested = new URL(String(requestUrl));
      expect(requested.pathname).toBe('/v1/checkout/sessions/cs_test_recu');
      expect(requested.searchParams.get('expand[0]')).toBe('payment_intent.latest_charge');
      expect(new Headers(init?.headers).get('stripe-version')).toBe('2026-09-30.endive');
    }
  });

  it('envoie Endive et le nouveau paramètre, avec la même clé de reprise', async () => {
    const transport = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'cs_test_fictif', object: 'checkout.session' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createStripeClient('sk_test_fictif_sans_compte', {
      httpClient: Stripe.createFetchHttpClient(transport),
      maxNetworkRetries: 0,
    });
    await client.checkout.sessions.create(
      {
        mode: 'payment',
        allowed_payment_method_types: ['card'],
      },
      { idempotencyKey: 'audit:fictif' },
    );
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const headers = new Headers(init?.headers);
    expect(headers.get('stripe-version')).toBe('2026-09-30.endive');
    expect(headers.get('idempotency-key')).toBe('audit:fictif');
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('allowed_payment_method_types[0]')).toBe('card');
    expect(form.has('payment_method_types[0]')).toBe(false);
  });

  it('transmet encore une réservation Dahlia inchangée quand sa version est précisée', async () => {
    const transport = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'cs_test_ancien', object: 'checkout.session' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createStripeClient('sk_test_fictif_sans_compte', {
      httpClient: Stripe.createFetchHttpClient(transport),
      maxNetworkRetries: 0,
    });
    // Même forme que le JSON durable ; aucune conversion avant un rejeu.
    const reserved = { mode: 'payment' as const, payment_method_types: ['card'] };
    await client.checkout.sessions.create(reserved, {
      idempotencyKey: 'audit:ancien',
      apiVersion: '2026-08-26.dahlia',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const init = transport.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get('stripe-version')).toBe('2026-08-26.dahlia');
    expect(headers.get('idempotency-key')).toBe('audit:ancien');
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('payment_method_types[0]')).toBe('card');
    expect(form.has('allowed_payment_method_types[0]')).toBe(false);
  });
});
