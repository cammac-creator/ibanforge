/**
 * Les trois routes d'administration du disjoncteur de création (lot 5).
 *
 * Fichier à part et non un ajout à `api-keys.ts`, pour la même raison de
 * méthode que les routes du radar : l'état de ce module décide du plafond des
 * clés neuves du service entier, et cela doit se relire d'un écran plutôt que
 * s'ajouter à un fichier de routes qui en fait déjà deux mille lignes.
 *
 * 🚨 Les trois se montent en `/v1/admin/...`. Le dépôt porte deux conventions
 * héritées — trois routes admin anciennes vivent sans le `v1` — et toute route
 * NEUVE prend la forme majoritaire. Se tromper ici produit un 404 qu'on prend
 * pour un problème de secret.
 *
 * 🚨 `Cache-Control: private, no-store` sur les trois : une réponse
 * d'administration ne se range dans aucun cache intermédiaire.
 *
 * Ce que ces routes NE font PAS : il n'y a pas de `/v1/admin/breaker/disarm`
 * dans cette livraison. Le désarmement à la main se fait par l'interrupteur de
 * crise `IBANFORGE_BREAKER_DISABLED=1`, que le balayage du radar transforme en
 * désarmement journalisé au tick suivant. Une route qui arme ou désarme sur
 * demande viendra avec les trois routes restantes du chantier.
 */

import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import {
  readBreakerState,
  readCreations,
  listTransitions,
  countEpisodeKeys,
  revocationEnabled,
  breakerDisabledByEnv,
  BREAKER_THRESHOLD,
  BREAKER_EPISODE_MAX_HOURS,
  TRANSITIONS_PAGE_DEFAULT,
} from '../lib/creation-breaker.js';
import { undegradeEpisode } from '../lib/api-keys.js';
import { BREAKER_MIN_DISTINCT_SOURCES, BREAKER_WINDOW_MINUTES } from '../lib/cohort-radar.js';

export const adminBreaker = new Hono();

/**
 * L'état du disjoncteur, et les réglages qui le gouvernent.
 *
 * Les réglages voyagent avec l'état parce qu'un opérateur qui lit
 * `creations_in_window: 7` doit pouvoir dire tout de suite s'il est loin du
 * seuil, sans aller chercher une constante dans le code d'une version dont il
 * ne sait pas laquelle tourne.
 *
 * `breaker_disabled` et `blind_streak` répondent à la seule question que
 * `armed: false` laisse ouverte : est-ce le calme, l'interrupteur de crise, ou
 * un compteur qui ne se lit plus ? Sans eux, les trois se ressemblent.
 */
adminBreaker.get('/v1/admin/breaker', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const st = readBreakerState();
  let reading = { count: 0, distinctSources: 0 };
  try {
    reading = readCreations();
  } catch {
    // Une mesure impossible ne doit pas rendre la route muette : l'état, lui,
    // se lit. `blind_streak` dit déjà que le compteur ne répond plus.
  }
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    armed: st.armed,
    creations_in_window: reading.count,
    distinct_sources_in_window: reading.distinctSources,
    threshold: BREAKER_THRESHOLD,
    min_distinct_sources: BREAKER_MIN_DISTINCT_SOURCES,
    window_minutes: BREAKER_WINDOW_MINUTES,
    episode_max_hours: BREAKER_EPISODE_MAX_HOURS,
    revocation_enabled: revocationEnabled(),
    breaker_disabled: breakerDisabledByEnv(),
    blind_streak: st.blind_streak,
    episode: st.armed
      ? {
          episode_id: st.episode_id,
          armed_at: st.armed_at,
          last_exceeded_at: st.last_exceeded_at,
          keys_born: countEpisodeKeys(st.episode_id),
        }
      : null,
    last_disarmed_at: st.disarmed_at,
  });
});

/**
 * Le journal des bascules, la plus récente d'abord.
 *
 * Deux lignes par épisode, quelques épisodes par an : la page par défaut couvre
 * largement l'historique, et `?limit=` sert au rejeu d'un incident ancien.
 */
adminBreaker.get('/v1/admin/breaker/transitions', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const rows = listTransitions(Number.isFinite(rawLimit) ? rawLimit : TRANSITIONS_PAGE_DEFAULT);
  c.header('Cache-Control', 'private, no-store');
  return c.json(rows);
});

/**
 * Rattraper une remontée que le désarmement n'a pas faite.
 *
 * Corps : `{ "episode_id": "…" }`, et `{ "all": true }` pour rendre AUSSI aux
 * clés qu'une cohorte avait nommées.
 *
 * 🚨 Cette route existe pour un cas précis et daté : un `git revert` du lot.
 * Le code revient, le schéma reste — mais une clé DÉJÀ dégradée reste à son
 * plafond réduit, parce que plus rien ne tourne pour la remonter. C'est la
 * seule donnée de ce lot qui ne se répare pas toute seule, et c'est pourquoi
 * cet appel se lance AVANT le revert, pas après.
 *
 * Elle est aussi la voie du faux positif relu : un opérateur qui a lu le
 * rapport du radar et conclu qu'une cohorte n'était pas une ferme rend tout
 * avec `all: true`. Elle ne touche jamais à `active` : une clé COUPÉE se rend
 * par le journal d'annulation, qui seul porte son état d'avant.
 */
adminBreaker.post('/v1/admin/breaker/undegrade', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = (await c.req.json().catch(() => null)) as {
    episode_id?: unknown;
    all?: unknown;
  } | null;
  const episodeId = typeof body?.episode_id === 'string' ? body.episode_id.trim() : '';
  if (!episodeId) {
    return c.json({ error: 'episode_id_required' }, 400);
  }
  const all = body?.all === true;
  const undegraded = undegradeEpisode(episodeId, { all });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ episode_id: episodeId, all, undegraded, remaining: countEpisodeKeys(episodeId) });
});
