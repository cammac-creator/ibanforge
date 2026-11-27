/**
 * La période de remise à zéro d'un compteur de quota, et les seuils d'alerte
 * (chantier « compte client et alertes », lot 1, 27.11.2026).
 *
 * 🚨 UN SEUL ENDROIT décide de quelle période une clé est dans. Aujourd'hui,
 * c'est le mois civil UTC pour toutes les clés : du 1er à 00:00 UTC au 1er du
 * mois suivant à 00:00 UTC. Un lot suivant (remise à zéro à la date
 * d'anniversaire d'un abonnement) n'aura qu'à changer `currentPeriodFor`, qui
 * reçoit déjà le hash de la clé pour cela : le compteur (`api_usage.month`),
 * la page du compte, `GET /v1/keys/usage` et les alertes la lisent tous ici.
 *
 * Module feuille, sans import : il se lit depuis `api-keys.ts`, `email.ts` et
 * les routes sans créer de cycle.
 */

/** La période en cours d'une clé. */
export interface QuotaPeriod {
  /** La clé du compteur (`api_usage.month`) : « AAAA-MM ». */
  month: string;
  /** Le début de la période, en ISO 8601 UTC. */
  start: string;
  /** L'instant de la remise à zéro, en ISO 8601 UTC. */
  resetsAt: string;
}

/**
 * La période de la clé à l'instant `now`. Pure : aucune lecture de base
 * aujourd'hui (le hash est là pour le lot de l'anniversaire).
 */
export function currentPeriodFor(_keyHash: string, now: Date = new Date()): QuotaPeriod {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    month: now.toISOString().slice(0, 7),
    start: new Date(Date.UTC(y, m, 1)).toISOString(),
    // Date.UTC rend le mois 12 comme janvier de l'année suivante.
    resetsAt: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
  };
}

/**
 * La liste fermée des seuils que le titulaire peut choisir, en pourcentage de
 * l'allocation de la période. Rien d'autre n'est accepté : ni 0, ni 95, ni un
 * texte.
 */
export const ALERT_THRESHOLDS = [50, 80, 90, 100] as const;
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number];

/** Le choix de quiconque n'a rien réglé : l'alerte des 80 %, comme avant ce lot. */
export const DEFAULT_ALERT_THRESHOLDS: readonly AlertThreshold[] = [80];

export function isAlertThreshold(n: unknown): n is AlertThreshold {
  return typeof n === 'number' && (ALERT_THRESHOLDS as readonly number[]).includes(n);
}

/**
 * Les seuils de la liste fermée que CET appel fait franchir : l'usage passe de
 * `before` (strictement en dessous) à `after` (au seuil ou au-dessus). De la
 * pure arithmétique, sans lecture de base : c'est ce qui permet au chemin chaud
 * de ne rien lire des préférences d'une clé. Un lot peut en franchir plusieurs
 * d'un coup. Le seuil se compte en unités, arrondi vers le haut (même règle que
 * l'alerte des 80 % d'avant ce lot).
 */
export function crossedThresholds(before: number, after: number, limit: number): AlertThreshold[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return ALERT_THRESHOLDS.filter((pct) => {
    const at = Math.ceil((limit * pct) / 100);
    return before < at && after >= at;
  });
}

/** « 2026-12-01 00:00 UTC » : la date de remise à zéro, dite pareil dans un mail et sur la page. */
export function formatResetUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
