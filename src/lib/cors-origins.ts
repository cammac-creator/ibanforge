/**
 * La liste des origines autorisées, lue en un seul endroit.
 *
 * `buildApp()` la passe au middleware CORS. Les routes du device grant en ont
 * besoin AUSSI, et pour une autre raison : `approve` et `deny` contrôlent
 * l'en-tête `Origin` quand il est présent, en ceinture du jeton d'approbation.
 * Deux copies de cette liste auraient divergé au premier ajout de domaine, et
 * la copie périmée aurait refusé la page qui vient d'être publiée.
 *
 * 🚨 Lue à CHAQUE appel, jamais figée à l'import : `CORS_ORIGIN` est posée par
 * l'environnement de déploiement, et plusieurs tests de la suite la changent
 * entre deux constructions d'application. Une valeur capturée à l'import
 * rendrait le comportement dépendant de l'ordre des fichiers de test.
 */

/** Le développement local, sur n'importe quel port. */
export const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** La liste configurée, telle quelle : `['*']` quand rien n'est posé (refusé en
 *  production par la garde de `buildApp`). */
export function corsConfiguredOrigins(): string[] {
  return (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());
}

/**
 * Cette origine a-t-elle le droit d'écrire ?
 *
 * Le joker n'est honoré que hors production, exactement comme le middleware :
 * `buildApp()` refuse de démarrer en production sans liste explicite, donc un
 * `'*'` qui arriverait jusqu'ici ne peut venir que d'un poste de
 * développement.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (origin === '') return false;
  const configured = corsConfiguredOrigins();
  if (process.env.NODE_ENV !== 'production' && configured.includes('*')) return true;
  // La tolérance localhost est un confort de développement : en production elle
  // n'a rien à faire (audit du 16/09/2026, constat 7).
  if (process.env.NODE_ENV !== 'production' && LOCALHOST_ORIGIN.test(origin)) return true;
  return configured.includes(origin);
}
