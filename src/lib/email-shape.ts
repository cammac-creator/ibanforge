/**
 * Une adresse simple, et une seule : la partie locale en `dot-atom` (RFC 5322),
 * le domaine en étiquettes DNS, une extension d'au moins deux caractères.
 *
 * Rien de ce qu'un en-tête de mail lirait comme une seconde adresse ne passe :
 * ni virgule ni point-virgule, ni nom affiché (`Nom <a@b>`), ni guillemets, ni
 * espace, ni retour à la ligne. Le relais d'envoi applique la même règle et
 * refuse le reste : une adresse acceptée ici est une adresse qu'il enverra.
 *
 * Toute route qui envoie un mail à une adresse saisie passe par ici, avant la
 * normalisation (`normalizeEmail`) et avant les listes de domaines refusés.
 */
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]";
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const PLAIN_EMAIL = new RegExp(`^${ATEXT}+(?:\\.${ATEXT}+)*@${LABEL}(?:\\.${LABEL})+$`);

export function isPlainEmail(value: string): boolean {
  if (value.length > 254) return false;
  const at = value.lastIndexOf('@');
  if (at < 1 || at > 64) return false;
  if (!PLAIN_EMAIL.test(value)) return false;
  return value.length - value.lastIndexOf('.') - 1 >= 2;
}
