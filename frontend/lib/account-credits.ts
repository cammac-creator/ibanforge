/**
 * Ce que la page du compte doit annoncer comme solde, et rien d'autre.
 *
 * Le bloc `usage` servi par /v1/keys/report porte TROIS champs numériques
 * (`used`, `limit`, `remaining`) plus un `basis` qui dit lequel gouverne. Pour
 * une clé adossée à un lot de crédits prépayés, `basis` vaut `credits` et les
 * trois premiers ne sont qu'une observation : rien ne leur est opposé. Leur
 * `monthly_limit` est vide côté API et retombe sur la valeur par défaut du
 * palier gratuit, si bien que `remaining` s'y lit comme un plafond mensuel
 * qui n'existe pas. Un porteur de lot y voyait donc un petit nombre — celui du
 * palier gratuit moins ses appels du mois — au lieu de son solde.
 *
 * C'est la seule page où revient quelqu'un qui a déjà payé. Le chiffre qu'il y
 * lit doit être celui qui peut arrêter ses appels.
 *
 * Fonction pure, sans DOM et sans traduction : le runner du site ne monte pas
 * de composants (`vitest.config.ts` : environnement `node`, fichiers `.ts`), et
 * la règle qui compte ici est une règle de lecture, pas de mise en page.
 */

/**
 * Le bloc `usage` tel qu'il arrive. Tout ce qui est venu après la première
 * version de la page est optionnel À DESSEIN : la page est servie au visiteur
 * par le navigateur, contre l'API de production, et une réponse plus ancienne
 * que le site doit se dégrader vers l'affichage d'hier plutôt que blanchir.
 */
export interface AccountUsage {
  used: number;
  limit: number;
  remaining: number;
  month: string;
  /** `credits` | `lifetime` | `monthly` — lequel des plafonds gouverne. */
  basis?: string;
  tier?: string;
  credits_remaining?: number;
  credits_total?: number;
  note?: string;
}

export type AccountBalance =
  | {
      kind: 'quota';
      /** Appels consommés sur la période que le plafond mesure. */
      used: number;
      /** Ce qui reste avant ce plafond, jamais négatif. */
      remaining: number;
    }
  | {
      kind: 'credits';
      /** Appels facturés ce mois-ci, pour information seulement. */
      used: number;
      /** Le solde qui gouverne. `null` si l'API ne l'a pas servi : mieux vaut
       *  un tiret qu'un nombre inventé sur une page où quelqu'un a payé. */
      creditsRemaining: number | null;
      /** Le lot acheté, `null` quand il n'est pas connu (clé d'avant le champ,
       *  ou lot dont le total n'a jamais été renseigné : l'API sert alors 0). */
      creditsTotal: number | null;
    };

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Deux témoins, pas un seul.
 *
 * `basis` est la réponse d'autorité, mais il est arrivé après `credits_remaining`
 * dans le contrat : une clé à crédits lue par une API antérieure n'aurait que le
 * second. Les deux suffisent séparément, et un `basis` à `credits` fait foi même
 * si le solde manque — auquel cas la page dit qu'elle ne sait pas, au lieu de
 * réafficher le plafond mensuel qui ne s'applique pas.
 */
export function isCreditKey(usage: AccountUsage): boolean {
  return usage.basis === 'credits' || finite(usage.credits_remaining) !== null;
}

export function readBalance(usage: AccountUsage): AccountBalance {
  if (!isCreditKey(usage)) {
    return {
      kind: 'quota',
      used: finite(usage.used) ?? 0,
      // Le serveur borne déjà, la page ne s'en remet pas à lui : une clé
      // mesurée sur sa vie entière a déjà servi un reste négatif.
      remaining: Math.max(0, finite(usage.remaining) ?? 0),
    };
  }
  const total = finite(usage.credits_total);
  return {
    kind: 'credits',
    used: finite(usage.used) ?? 0,
    creditsRemaining: finite(usage.credits_remaining),
    // L'API sert `credits_total: credits_total ?? 0`. Un 0 n'est pas un lot de
    // zéro crédit, c'est un total inconnu : « 24 939 / 0 » serait pire que rien.
    creditsTotal: total !== null && total > 0 ? total : null,
  };
}
