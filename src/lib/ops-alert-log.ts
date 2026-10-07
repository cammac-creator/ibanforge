/**
 * L'historique des alertes d'exploitation (bulletin du lundi, étape A2, 07.10.2026).
 *
 * `ops-alert.ts` ne garde que l'état COURANT d'une alerte (`kv_state`) : une alerte
 * ouverte le mardi et refermée le jeudi ne laissait aucune trace le lundi suivant.
 * Ce module écrit une ligne dans `ops_alert_log` aux deux seules transitions qui
 * comptent pour un lecteur :
 *
 *  - l'ouverture, quand le message de l'alerte est PARTI (`opsFail`, après un envoi
 *    réussi) : une alerte que personne n'a reçue n'est pas ouverte, la règle de
 *    `ops-alert.ts` est gardée telle quelle ;
 *  - la fermeture, quand un succès referme une alerte ouverte (`opsOk`).
 *
 * Une alerte déjà ouverte avant que l'historique soit tenu n'a pas de ligne
 * d'ouverture : sa fermeture en écrit une, `opened_at` vide (« ouverte avant
 * l'historique »), plutôt que de se perdre.
 *
 * Comme `ops-alert.ts`, ce module NE JETTE JAMAIS : un historique qui casserait
 * l'alerte qu'il raconte serait pire que pas d'historique. Pas de texte du message,
 * seulement la clé et le nombre d'échecs.
 */
import { getStatsDB } from './db.js';

/** Une ligne d'ouverture : le message de l'alerte vient de partir. */
export function logAlertOpened(key: string, fails: number): void {
  try {
    getStatsDB()
      .prepare(
        `INSERT INTO ops_alert_log (alert_key, opened_at, fails) VALUES (?, datetime('now'), ?)`,
      )
      .run(key, Math.max(0, Math.floor(fails)) || 0);
  } catch (err) {
    console.error('[ops-alert-log] open write failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * La fermeture de l'alerte ouverte de cette clé. Sans ligne ouverte (alerte ouverte
 * avant l'historique), une ligne à ouverture inconnue est écrite à sa place.
 */
export function logAlertClosed(key: string, fails: number): void {
  try {
    const db = getStatsDB();
    const n = Math.max(0, Math.floor(fails)) || 0;
    const open = db
      .prepare(
        `SELECT id FROM ops_alert_log WHERE alert_key = ? AND closed_at IS NULL
          ORDER BY id DESC LIMIT 1`,
      )
      .get(key) as { id: number } | undefined;
    if (open) {
      db.prepare(
        `UPDATE ops_alert_log SET closed_at = datetime('now'), fails = MAX(fails, ?) WHERE id = ?`,
      ).run(n, open.id);
    } else {
      db.prepare(
        `INSERT INTO ops_alert_log (alert_key, opened_at, closed_at, fails)
         VALUES (?, NULL, datetime('now'), ?)`,
      ).run(key, n);
    }
  } catch (err) {
    console.error('[ops-alert-log] close write failed:', err instanceof Error ? err.message : err);
  }
}
