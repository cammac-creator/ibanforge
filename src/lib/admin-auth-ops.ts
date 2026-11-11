/**
 * Les clés d'administration vues par l'exploitation : l'alerte du démarrage
 * quand une clé à portée recopie une autre valeur (audit C08, réserve de la
 * relecture de la partie 1).
 *
 * Séparé de `src/lib/admin-auth.ts`, qui n'importe aucun fichier de l'API (son
 * en-tête, ARCH-02) : la porte reste importable partout, et ce module, appelé une
 * fois par `src/index.ts`, porte le lien avec `ops-alert.ts`.
 *
 * Une seule clé d'alerte, `admin:scoped-key-reuse`, quel que soit le nombre de
 * variables en cause : le message les nomme toutes. Fermée par le premier
 * démarrage sans conflit (l'état d'une alerte survit aux redémarrages, et une
 * clé laissée ouverte ferait taire la prochaine erreur). Jamais une valeur, ni
 * dans l'alerte, ni dans le journal : seulement des noms de variables.
 */
import { scopedKeyConflicts } from './admin-auth.js';
import { opsFail, opsOk } from './ops-alert.js';

export const SCOPED_KEY_REUSE_ALERT = 'admin:scoped-key-reuse';

/** La phrase de l'alerte : les variables ignorées, et à quoi elles ressemblent. */
export function describeScopedKeyConflicts(
  conflicts: ReturnType<typeof scopedKeyConflicts>,
): string {
  const lines = conflicts.map(
    (c) => `- ${c.name} ignorée : même valeur que ${c.sameValueAs.join(', ')}.`,
  );
  return [
    'Clé(s) d’administration à portée ignorée(s) au démarrage :',
    ...lines,
    'Chaque variable citée est traitée comme absente. Deux clés à portée identiques ' +
      'n’ouvrent plus rien (401) ; une clé recopiée d’ADMIN_SECRET ouvre encore tout, ' +
      'par la porte du secret complet. Générer une valeur propre par variable ' +
      '(openssl rand -hex 32), puis redémarrer.',
  ].join('\n');
}

/** Au démarrage : alerte si une clé à portée est ignorée, fermeture sinon. */
export function reportScopedKeyConflicts(): void {
  const conflicts = scopedKeyConflicts();
  if (conflicts.length === 0) {
    void opsOk(SCOPED_KEY_REUSE_ALERT, 'Chaque clé d’administration à portée a sa propre valeur.');
    return;
  }
  const detail = describeScopedKeyConflicts(conflicts);
  console.error(`[admin-auth] ${detail.replace(/\n/g, ' ')}`);
  void opsFail(SCOPED_KEY_REUSE_ALERT, detail);
}
