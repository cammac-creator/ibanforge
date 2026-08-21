/**
 * POST /internal/heartbeat/:name — un cron GitHub dit « je suis passé ».
 *
 * ## Pourquoi cette route existe
 *
 * Un workflow qui ÉCHOUE peut prévenir ; un workflow qui NE TOURNE PAS n'échoue
 * jamais, donc aucune notification n'existe ni ne peut exister. C'est arrivé :
 * `refresh-bic` a échoué le 01/05 et le 01/06/2026 et personne n'a réagi
 * pendant deux mois (audit D2). L'homme mort inverse la question : au lieu de
 * « as-tu échoué ? », il demande « as-tu donné signe de vie ? ».
 *
 * Pourquoi une route et pas un ping externe : les battements vivent dans
 * `kv_state`, c'est-à-dire dans stats.sqlite sur le volume Railway. C'est le
 * seul endroit qui survit à la fois aux redéploiements et à l'arrêt du Mac.
 *
 * Protégée : sans jeton, n'importe qui pourrait faire taire l'homme mort en
 * pointant à la place du cron mort — l'exact contraire du but.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { heartbeat, HEARTBEATS } from '../lib/ops-alert.js';

const opsHeartbeat = new Hono();

/**
 * ⚠️ HEARTBEAT_TOKEN, et SURTOUT PAS ADMIN_SECRET.
 *
 * ADMIN_SECRET ouvre le dashboard et le registre client. Le copier dans les
 * secrets GitHub d'un dépôt PUBLIC pour qu'un cron puisse dire « je suis
 * vivant » échangerait le plus haut privilège du système contre la commodité
 * d'une variable déjà existante. Un jeton dédié a le bon rayon d'explosion :
 * s'il fuite, l'attaquant peut faire exactement une chose — faire taire un
 * homme mort — au lieu de lire le registre.
 *
 * Comparaison à temps constant, même idiome que `admin-forums.ts`.
 */
function isHeartbeatAuthorized(provided: string | undefined): boolean {
  const expected = process.env.HEARTBEAT_TOKEN;
  // Secret non posé : la route refuse tout, elle ne s'ouvre jamais par défaut.
  // Le workflow, lui, dégrade proprement (warning, pas d'échec de run).
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

opsHeartbeat.post('/internal/heartbeat/:name', (c) => {
  // Le refus est muet : ne jamais dire si c'est le nom ou le jeton qui cloche.
  if (!isHeartbeatAuthorized(c.req.header('x-heartbeat-token'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const name = c.req.param('name');
  // Liste blanche : un nom libre créerait des battements fantômes que
  // checkHeartbeats ne regarde jamais — un homme mort qu'on croit posé et qui
  // ne surveille rien est pire que pas d'homme mort.
  if (!HEARTBEATS.some((h) => h.name === name)) return c.json({ error: 'unknown_heartbeat' }, 404);
  heartbeat(name);
  return c.json({ ok: true, name });
});

export { opsHeartbeat };
