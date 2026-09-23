/**
 * GET /v1/admin/stripe-revenue — l'argent encaissé, lu chez Stripe.
 *
 * La tuile « Encaissé » du tableau de bord lit ici. Deux blocs, toujours
 * servis ensemble, avec un statut 200 même quand Stripe ne répond pas :
 *
 *  - `stripe` : la lecture de la source (src/lib/stripe-revenue.ts), brut par
 *    nature et par devise, net et frais dans la devise de règlement, virements
 *    payés et en attente, heure de lecture. NULL quand Stripe est indisponible ;
 *  - `derived` : le total selon nos propres traces (clés et registres,
 *    src/lib/derived-revenue.ts), le repli que la tuile affiche alors avec la
 *    mention « selon les clés, Stripe indisponible ».
 *
 * 🚨 200 et non 503 sur une panne de Stripe : le tableau de bord jette le
 * corps de toute réponse non 2xx (fetchJSON), et le repli n'arriverait jamais.
 * `source: 'indisponible'` et `reason` disent la panne.
 *
 * Lecture seule chez Stripe : aucune écriture, aucun prix touché. Agrégats
 * seulement : ni adresse, ni identifiant de paiement, ni chiffres de carte.
 * Mise en cache 15 minutes, une seule lecture en vol (voir StripeRevenueCache).
 */
import { Hono } from 'hono';
import Stripe from 'stripe';
import { isAdminAuthorized } from './api-keys.js';
import {
  CACHE_TTL_MS,
  StripeRevenueCache,
  type StripeRevenueCacheOptions,
  type StripeRevenueClient,
  type StripeRevenueSnapshot,
  type StripeUnavailableReason,
} from '../lib/stripe-revenue.js';
import { readDerivedRevenue, type DerivedRevenue } from '../lib/derived-revenue.js';

export interface StripeRevenuePayload {
  version: 1;
  source: 'stripe' | 'indisponible';
  reason: StripeUnavailableReason | null;
  served_at: string;
  cache_ttl_seconds: number;
  stripe: StripeRevenueSnapshot | null;
  derived: DerivedRevenue;
}

/**
 * Une requête Stripe ne dure pas plus de 10 s, avec une seule nouvelle
 * tentative. Le défaut du SDK (80 s) figerait la section de l'argent, que le
 * tableau de bord attend sans délai de garde.
 */
const STRIPE_TIMEOUT_MS = 10_000;

let client: StripeRevenueClient | null = null;
function defaultFactory(): StripeRevenueClient | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key, { timeout: STRIPE_TIMEOUT_MS, maxNetworkRetries: 1 });
  return client;
}

let cache = new StripeRevenueCache({ factory: defaultFactory });

/** Les tests posent leur fabrique et leur horloge ; la production n'appelle jamais ceci. */
export function _setStripeRevenueForTests(opts: StripeRevenueCacheOptions | null): void {
  client = null;
  cache = new StripeRevenueCache(opts ?? { factory: defaultFactory });
}

export const adminStripeRevenue = new Hono();

adminStripeRevenue.get('/v1/admin/stripe-revenue', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.header('Cache-Control', 'private, no-store');
  const result = await cache.get();
  const payload: StripeRevenuePayload = {
    version: 1,
    source: result.ok ? 'stripe' : 'indisponible',
    reason: result.ok ? null : result.reason,
    served_at: new Date().toISOString(),
    cache_ttl_seconds: CACHE_TTL_MS / 1000,
    stripe: result.ok ? result.snapshot : null,
    derived: readDerivedRevenue(),
  };
  return c.json(payload);
});
