/**
 * La forme sur laquelle « une personne, une clé gratuite » se mesure.
 *
 * Sans elle, you+1@gmail.com et y.o.u@gmail.com sont trois personnes pour la
 * base et une seule boîte pour leur porteur, et les CGU promettent une règle
 * que le contrôle ne tient pas. Module FEUILLE, sans import : il est appelé
 * par le backfill de src/lib/db.ts, qui ne peut dépendre de rien d'autre.
 *
 * Deux arbitrages, et ce qu'ils coûtent :
 *  - l'étiquette après « + » est retirée sur tous les domaines. Le faux positif
 *    possible est deux personnes réelles chez le même employeur dont les
 *    adresses ne diffèrent que par une étiquette ; le faux négatif inverse est
 *    un multiplicateur illimité. On penche du côté de l'opérateur ;
 *  - les points ne sont retirés que sur gmail.com et googlemail.com, les deux
 *    seuls domaines documentés pour les ignorer. Les retirer partout casserait
 *    prenom.nom@entreprise.com, la forme la plus répandue en entreprise.
 *
 * Une sentinelle sans arobase (« anonymous », « credits-buyer ») rend null :
 * elle n'est pas une adresse, donc aucun contrôle d'unicité ne doit la voir.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (!e.includes('@')) return null;
  const at = e.lastIndexOf('@');
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('.').join('');
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}
