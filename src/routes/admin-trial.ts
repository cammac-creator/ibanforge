import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import {
  countTrialActivitySince,
  countTrialBucketsSince,
  countTrialBucketsToday,
  getTrialDaily,
} from '../lib/daily-ip-ledger.js';
import { REST_TRIAL_DAILY_LIMIT } from '../lib/trial.js';

/**
 * Ce que l'essai sans clé a servi, aujourd'hui et les jours d'avant.
 *
 * Sans cette route, `trial_daily` serait une table écrite et jamais lue : la
 * seule trace qui survit à la purge nocturne ne serait consultable par
 * personne, et c'est elle qui donnera le seuil du plafond dégradé
 * (`peak_hour_buckets` dit combien de sources distinctes une heure paisible
 * produit vraiment, au lieu d'une intuition).
 *
 * 🚨 Aucune source ici, même hachée : des COMPTES, jamais des seaux.
 * `trial_daily` n'a aucune politique de rétention, et l'attribution fine vit
 * dans `request_log`, qui en a une.
 */
export const adminTrial = new Hono();

adminTrial.get('/v1/admin/trial', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const days = Number.parseInt(c.req.query('days') ?? '14', 10);
  // Borné et non pas fait confiance : une fenêtre non bornée serait un
  // balayage complet, et la table n'est jamais purgée.
  const bounded = Number.isFinite(days) ? Math.min(Math.max(days, 1), 90) : 14;
  // 🚨 Pas de cache : le tableau de bord lit ici des compteurs d'abus, et un
  // intermédiaire qui garderait la réponse montrerait une rafale éteinte.
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    daily_limit: REST_TRIAL_DAILY_LIMIT,
    // La journée courante, lue dans le registre vivant : elle n'est pas encore
    // dans `trial_daily`, que `snapshotTrialDay` n'écrira qu'au tick suivant.
    today: {
      day: new Date().toISOString().slice(0, 10),
      ...countTrialBucketsToday(),
    },
    // Les deux fenêtres glissantes, côte à côte : l'apparition de sources
    // neuves, et l'activité réelle. Un amorçage lent puis une libération d'un
    // coup ne se voit que dans la seconde, et c'est le MAX des deux que le
    // disjoncteur lira.
    last_60_minutes: {
      appeared: countTrialBucketsSince(60),
      active: countTrialActivitySince(60),
    },
    days: getTrialDaily(bounded),
  });
});
