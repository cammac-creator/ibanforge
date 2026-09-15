/**
 * Les deux routes d'administration du radar anonyme.
 *
 * Fichier à part et non un ajout à `api-keys.ts`, pour une raison de méthode :
 * ce module est le SEUL endroit du service où un appel HTTP désactive des clés
 * de clients. Il doit se relire d'un écran, et il ne doit pas grossir un fichier
 * de routes qui en fait déjà deux mille.
 *
 * 🚨 Les deux se montent en `/v1/admin/...`. Le dépôt porte deux conventions
 * héritées — trois routes admin anciennes vivent sans le `v1` — et toute route
 * NEUVE prend la forme majoritaire. Se tromper ici produit un 404 qu'on prend
 * pour un problème de secret.
 */

import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { listKeyRevocations, REVOCATIONS_PAGE_DEFAULT } from '../lib/key-revocations.js';
import { cutCohortNow } from '../lib/cohort-radar-server.js';

export const adminCohorts = new Hono();

/**
 * Le journal d'annulation : qui a été coupé, quand, sur quelle ancre, et avec
 * quel solde d'avant.
 *
 * `total` compte les lignes du filtre, `n` celles de la page : un opérateur qui
 * lit `n: 200` doit savoir s'il en reste. Filtres : `?episode=`, `?prefix=`
 * (courant ou d'origine), `?pending=1` (non restaurées), `?limit=`.
 *
 * 🚨 `Cache-Control: private, no-store` : une réponse d'administration ne se
 * range dans aucun cache intermédiaire.
 */
adminCohorts.get('/v1/admin/key-revocations', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const out = listKeyRevocations({
    episodeId: c.req.query('episode') ?? undefined,
    prefix: c.req.query('prefix') ?? undefined,
    pendingOnly: c.req.query('pending') === '1',
    limit: Number.isFinite(rawLimit) ? rawLimit : REVOCATIONS_PAGE_DEFAULT,
  });
  c.header('Cache-Control', 'private, no-store');
  return c.json(out);
});

/**
 * La voie MANUELLE de coupe, celle qu'exige la décision de livrer la révocation
 * éteinte.
 *
 * Corps : `{ "anchor": "ua:python-requests/2.34.2", "episode_id": "…" }`.
 * `anchor` est obligatoire et se lit tel quel dans le rapport du scan
 * (`GET /v1/admin/cohort-scan`) ou dans l'alerte « rafale VUE, non coupée ».
 * `episode_id` est facultatif : absent, l'épisode en cours est utilisé.
 *
 * Réponse `{ revoked, skipped, pending, candidates }`, plus `reason` quand rien
 * n'a pu être fait : `no_burst` (plus aucune rafale dans la fenêtre de six
 * heures — la cohorte a vieilli, il n'y a plus de bornes à consigner) ou
 * `anchor_not_found` (l'ancre n'est plus dans le rayon).
 *
 * 🚨 Cette route coupe pour de vrai, et son effet n'est réparable QUE par les
 * anciens soldes consignés dans `key_revocations`. Elle applique les clauses SQL
 * du rayon — jamais une clé réclamée, à crédits, achetée, réglée au seuil,
 * interne, ou déjà coupée — mais aucune des gardes consultatives de la passe
 * automatique : un humain a lu le rapport et porte la décision. Le détail du
 * motif est dans `cutCohortNow`.
 *
 * 🚨 Plafond de 500 clés par appel, le même que la passe automatique. Le reste
 * revient en `pending` et se coupe par un second appel : better-sqlite3 est
 * synchrone, et une boucle sans borne ici bloquerait l'API pour tous les
 * clients, payants compris.
 */
adminCohorts.post('/v1/admin/cohorts/cut', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = (await c.req.json().catch(() => null)) as {
    anchor?: unknown;
    episode_id?: unknown;
  } | null;
  const anchor = typeof body?.anchor === 'string' ? body.anchor.trim() : '';
  if (!anchor) {
    return c.json({ error: 'anchor_required' }, 400);
  }
  const episodeId = typeof body?.episode_id === 'string' ? body.episode_id : null;
  const out = await cutCohortNow({ anchor, episodeId });
  c.header('Cache-Control', 'private, no-store');
  return c.json(out);
});
