/**
 * Les portes d'administration de l'API : qui a le droit d'entrer, et par où.
 *
 * Sorti de `src/routes/api-keys.ts` et de `src/routes/stats.ts` le 10.11.2026
 * (audit d'architecture, ARCH-02) : le limiteur de débit, le paywall et une
 * vingtaine de fichiers de routes importaient un fichier de ROUTES de trois mille
 * lignes pour une seule fonction, et entraient avec lui dans un cycle d'imports.
 * Ce module n'importe que `node:crypto` ; il doit le rester, pour que tout le
 * monde puisse l'importer sans tirer le reste de l'API.
 *
 * Trois portes, trois rayons d'explosion :
 *
 *  - `ADMIN_SECRET` (en-tête `X-Admin-Secret`) ouvre TOUTES les routes
 *    `/v1/admin/*` : créer des clés, créditer, lire le registre des clients ;
 *  - `BACKUP_TOKEN` (même en-tête) n'ouvre QUE `GET /v1/admin/backup`. Il existe
 *    pour que le script de sauvegarde nocturne du serveur ne détienne plus la clé
 *    qui ouvre tout (audit OPS-24) : s'il fuit, on peut lire la sauvegarde, et
 *    rien d'autre. Le secret complet continue d'ouvrir la sauvegarde ;
 *  - `STATS_TOKEN` (en-tête `Authorization: Bearer`) ouvre `/stats/*`.
 *
 * 🚨 Ne jamais faire accepter `BACKUP_TOKEN` par `isAdminAuthorized` : cette
 * seule ligne ouvrirait toutes les routes d'administration à la clé de la
 * sauvegarde. `src/routes/admin-routes-auth.test.ts` présente le jeton de la
 * sauvegarde à chaque route montée et exige un refus partout ailleurs.
 */
import { timingSafeEqual } from 'node:crypto';

/** La seule route que `BACKUP_TOKEN` ouvre, lue aussi par le limiteur de débit. */
export const BACKUP_ROUTE = '/v1/admin/backup';

/**
 * Comparaison à temps constant. Faux si l'attendu ou le présenté est absent ou
 * vide : une variable non posée, ou posée vide, ne s'ouvre jamais par défaut.
 * À longueurs différentes, une comparaison factice garde le même coût, pour que
 * la durée de la réponse ne dise pas la longueur du secret.
 */
function secretMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Le secret d'administration complet, `ADMIN_SECRET`. Vrai seulement s'il est
 * posé ET que l'en-tête présenté lui est identique.
 */
export function isAdminAuthorized(provided: string | undefined): boolean {
  return secretMatches(process.env.ADMIN_SECRET, provided);
}

/**
 * La porte de `GET /v1/admin/backup` : le secret complet, ou `BACKUP_TOKEN`.
 *
 * `BACKUP_TOKEN` absent, vide ou fait seulement d'espaces : seul le secret
 * complet ouvre, exactement comme avant ce jeton. Les deux comparaisons sont
 * faites à chaque appel, pour que la durée ne dise pas laquelle a réussi.
 */
export function isBackupAuthorized(provided: string | undefined): boolean {
  const admin = isAdminAuthorized(provided);
  const token = process.env.BACKUP_TOKEN;
  const backup = !!token && token.trim() !== '' && secretMatches(token, provided);
  return admin || backup;
}

/**
 * Le jeton des statistiques, `STATS_TOKEN`, présenté en `Authorization: Bearer`.
 * Non posé : les routes `/stats/*` refusent tout.
 *
 * À temps constant, comme les autres : un `===` s'arrête au premier octet
 * différent et dit la longueur du jeton, et `/stats` est exempté du limiteur.
 */
export function isStatsAuthorized(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  return secretMatches(`Bearer ${token}`, authHeader);
}
