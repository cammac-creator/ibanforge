/**
 * La période de remise à zéro d'un compteur de quota, et les seuils d'alerte
 * (chantier « compte client et alertes », lots 1 et 2, 27.11.2026).
 *
 * 🚨 UN SEUL ENDROIT décide de quelle période une clé est dans.
 *
 *  - Une clé GRATUITE, un pack de crédits, une clé d'abonnement qui n'a pas
 *    encore payé de renouvellement : le mois civil UTC, du 1er à 00:00 UTC au 1er
 *    du mois suivant à 00:00 UTC.
 *  - Une clé d'ABONNEMENT « ancrée » : la période de facturation de son
 *    abonnement. Elle est ancrée par la première facture de RENOUVELLEMENT payée
 *    dont la période commence le 28.12.2026 ou après (ANCHOR_EFFECTIVE_FROM_ISO)
 *    (`recordSubscriptionAnchorInTx`, appelée par le
 *    webhook `invoice.paid`), jamais avant. Le début de période est ramené au
 *    début du jour à Zurich (00:00, Europe/Zurich) : un arrondi toujours à
 *    l'avantage du client, qui gagne les heures du début de journée. Les périodes
 *    suivantes se calculent ICI, sans attendre une facture : la remise à zéro ne
 *    dépend jamais d'un paiement (décision du 27.11.2026 : « il faut toujours que
 *    ce soit à l'avantage du client »).
 *
 * Le compteur `api_usage` (clé `month`, « AAAA-MM ») reste le compte civil de
 * tous les appels servis : beaucoup de graphiques et de rapports le lisent. Une
 * clé ancrée a EN PLUS un compteur par période (`api_usage_period`), contre
 * lequel son allocation est mesurée.
 *
 * Les seuils d'alerte, la page du compte, `GET /v1/keys/usage`, le 402 et le
 * mail lisent tous la période ici.
 */
import { getStatsDB } from './db.js';

/** La période en cours d'une clé. */
export interface QuotaPeriod {
  /** Le mois civil UTC « AAAA-MM » : la clé de `api_usage`, et ce que l'API sert partout comme `month`. */
  month: string;
  /** Le début de la période, en ISO 8601 UTC. */
  start: string;
  /** L'instant de la remise à zéro, en ISO 8601 UTC. */
  resetsAt: string;
  /**
   * Vrai pour une clé d'abonnement ancrée : la période est celle de la
   * facturation, et son compteur est `api_usage_period` (clé `start`).
   */
  anchored: boolean;
  /**
   * Vrai quand l'ancre de la clé n'a pas pu être lue (erreur de base) : la
   * période est inconnue, et le compte ne mesure PAS la clé sur le mois civil
   * (qui peut dépasser le plafond d'une clé basculée) : l'appel passe, sans
   * compter, et l'erreur est au journal.
   */
  degraded?: boolean;
  /**
   * Le quantième d'ancrage d'une période ancrée (1 à 31) : le jour de Zurich où
   * la facturation a commencé, celui que le client lit comme « le 31 de chaque
   * mois » (une période d'un mois court tombe, elle, au dernier jour du mois :
   * `resets_on` peut dire le 28 pour un 31). Null pour le mois civil.
   */
  renewalDay: number | null;
}

const ZURICH = 'Europe/Zurich';
let zurichFormat: Intl.DateTimeFormat | null = null;

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
}

/** La date et l'heure de Zurich d'un instant (côté serveur seulement : jamais d'Intl dans un composant client). */
function zurichParts(ms: number): LocalParts {
  zurichFormat ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: ZURICH,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const part of zurichFormat.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour, mi: out.minute };
}

/** L'instant (UTC, en ms) de 00:00 à Zurich le jour `y-m-d`. Minuit n'est jamais ambigu à Zurich (le changement d'heure se fait à 2 h). */
function zurichStartOfDay(y: number, m: number, d: number): number {
  for (const offset of [3_600_000, 7_200_000]) {
    const t = Date.UTC(y, m - 1, d) - offset;
    const p = zurichParts(t);
    if (p.y === y && p.m === m && p.d === d && p.h === 0 && p.mi === 0) return t;
  }
  return Date.UTC(y, m - 1, d) - 3_600_000;
}

/**
 * `k` mois après le jour `y-m-d`, le jour 29, 30 ou 31 ramené au dernier jour
 * d'un mois plus court, comme Stripe le fait. Calculé depuis le jour d'ANCRAGE à
 * chaque fois, jamais de proche en proche : un 31 janvier donne le 28 février
 * puis de nouveau le 31 mars.
 */
function addMonthsClamped(y: number, m: number, d: number, k: number): LocalParts {
  const total = y * 12 + (m - 1) + k;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return { y: ny, m: nm, d: Math.min(d, last), h: 0, mi: 0 };
}

/** Le mois civil UTC de l'instant : la période de toute clé qui n'est pas ancrée. */
export function civilPeriod(now: Date): QuotaPeriod {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    month: now.toISOString().slice(0, 7),
    start: new Date(Date.UTC(y, m, 1)).toISOString(),
    // Date.UTC rend le mois 12 comme janvier de l'année suivante.
    resetsAt: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
    anchored: false,
    renewalDay: null,
  };
}

/**
 * La période de facturation qui contient `now`, pour un abonnement dont une
 * période a commencé à `anchorStartIso` (l'instant exact que Stripe donne). Pure.
 * Null si `now` précède l'ancre arrondie (jamais pour une ancre posée à l'heure).
 *
 * Les débuts de période suivent Stripe en UTC (même heure, même quantième, le 29 à
 * 31 ramené au dernier jour d'un mois court), arrondis au début du jour de Zurich
 * qui contient cet instant. Chacun est AU PLUS TÔT l'instant de facturation
 * correspondant : l'arrondi ne raccourcit jamais une période.
 */
export function anchoredPeriodAt(anchorStartIso: string, now: Date): QuotaPeriod | null {
  const anchorMs = Date.parse(anchorStartIso);
  if (!Number.isFinite(anchorMs)) return null;
  const a = new Date(anchorMs);
  const boundary = (k: number): number => zurichDayStartOf(shiftedInstant(anchorMs, k));
  const nowMs = now.getTime();
  if (nowMs < boundary(0)) return null;
  let k = Math.max(
    0,
    now.getUTCFullYear() * 12 + now.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth()),
  );
  while (k > 0 && boundary(k) > nowMs) k--;
  while (boundary(k + 1) <= nowMs) k++;
  return {
    month: now.toISOString().slice(0, 7),
    start: new Date(boundary(k)).toISOString(),
    resetsAt: new Date(boundary(k + 1)).toISOString(),
    anchored: true,
    renewalDay: a.getUTCDate(),
  };
}

/**
 * L'instant de Stripe décalé de `k` mois EN UTC (Stripe avance en UTC : même
 * heure, même quantième, le 29 à 31 ramené au dernier jour d'un mois court).
 */
function shiftedInstant(anchorMs: number, k: number): number {
  const a = new Date(anchorMs);
  const b = addMonthsClamped(a.getUTCFullYear(), a.getUTCMonth() + 1, a.getUTCDate(), k);
  return Date.UTC(
    b.y,
    b.m - 1,
    b.d,
    a.getUTCHours(),
    a.getUTCMinutes(),
    a.getUTCSeconds(),
    a.getUTCMilliseconds(),
  );
}

/** Le début (00:00) du jour de Zurich qui contient l'instant : toujours au plus tard cet instant. */
function zurichDayStartOf(ms: number): number {
  const p = zurichParts(ms);
  return zurichStartOfDay(p.y, p.m, p.d);
}

/**
 * Vrai quand l'instant de Stripe `startMs` est, au jour UTC près, une limite que
 * l'ancre connue attendait (le 31 reste un 31 : Stripe ramène le 28 février, la
 * date attendue le dit aussi, l'ancre ne dérive pas).
 */
function matchesAnchor(anchorMs: number, startMs: number): boolean {
  const a = new Date(anchorMs);
  const s = new Date(startMs);
  const diff =
    s.getUTCFullYear() * 12 + s.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth());
  for (const k of [diff - 1, diff, diff + 1]) {
    if (k < 0) continue;
    const e = new Date(shiftedInstant(anchorMs, k));
    if (
      e.getUTCFullYear() === s.getUTCFullYear() &&
      e.getUTCMonth() === s.getUTCMonth() &&
      e.getUTCDate() === s.getUTCDate()
    ) {
      return true;
    }
  }
  return false;
}

/** Le jour (« AAAA-MM-JJ », à Zurich) du début d'une période ancrée : son étiquette. */
function zurichDayLabel(startIso: string): string {
  const p = zurichParts(Date.parse(startIso));
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/**
 * L'étiquette de la période pour les verrous d'alerte : « AAAA-MM » pour le
 * mois civil, « AAAA-MM-JJ » (le jour de Zurich où elle a commencé) pour une
 * période ancrée. Deux périodes d'un même mois civil (la bascule) ont ainsi
 * deux verrous.
 */
export function periodLabelOf(period: QuotaPeriod): string {
  return period.anchored ? zurichDayLabel(period.start) : period.month;
}

/**
 * La période, nommée pour une phrase : « 2026-12 » pour le mois civil, « the
 * period that began on 2026-12-10 » pour une période ancrée (jamais un mois
 * civil que la clé ne suit plus : en janvier, « 8 000 sur 10 000 pour 2027-01 »
 * serait faux pour une période ouverte le 10 décembre).
 */
export function periodNameOf(period: QuotaPeriod): string {
  return period.anchored ? `the period that began on ${periodLabelOf(period)}` : period.month;
}

/**
 * L'utilisation de la période en cours de chaque clé d'abonnement ancrée et
 * vivante, par empreinte de clé : ce que lisent les rapports de l'exploitant
 * (radar de cycle de vie, tableau des clients) à la place du mois civil.
 */
export function anchoredPeriodUsage(
  db: ReturnType<typeof getStatsDB>,
  now: Date = new Date(),
): Map<string, number> {
  const out = new Map<string, number>();
  const rows = db
    .prepare(
      `SELECT p.key_hash, p.anchor_start FROM subscription_periods p
         JOIN api_keys k ON k.key_hash = p.key_hash
        WHERE k.stripe_subscription_id = p.subscription_id AND k.subscription_ended_at IS NULL`,
    )
    .all() as Array<{ key_hash: string; anchor_start: string }>;
  const count = db.prepare(
    'SELECT count FROM api_usage_period WHERE key_hash = ? AND period_start = ?',
  );
  for (const r of rows) {
    const period = anchoredPeriodAt(r.anchor_start, now);
    if (!period) continue;
    const c = count.get(r.key_hash, period.start) as { count: number } | undefined;
    out.set(r.key_hash, c?.count ?? 0);
  }
  return out;
}

/** Vrai pour une étiquette de mois civil (« 2026-12 »), faux pour celle d'une période ancrée. */
export function isCivilPeriodLabel(label: string): boolean {
  return /^\d{4}-\d{2}$/.test(label);
}

/**
 * La période de la clé à l'instant `now`. Le mois civil, sauf pour une clé
 * d'abonnement VIVANTE dont la facturation a été ancrée : la ligne de
 * `subscription_periods` ne compte que tant qu'elle porte l'abonnement que la
 * clé porte encore, sans fin posée. Une résiliation (`subscription_ended_at`)
 * rend donc la clé au mois civil, avec l'allocation propre qu'elle retrouve.
 *
 * Une lecture indexée par appel. Sur une erreur de lecture, la période rendue
 * porte `degraded: true` : l'appelant laisse passer l'appel sans le compter
 * (fail-open), car le mois civil d'une clé basculée peut valoir jusqu'à deux fois
 * le plafond et refuserait à tort un client qui a payé.
 */
export function currentPeriodFor(keyHash: string, now: Date = new Date()): QuotaPeriod {
  const civil = civilPeriod(now);
  if (!keyHash) return civil;
  try {
    const row = getStatsDB()
      .prepare(
        `SELECT p.anchor_start FROM subscription_periods p
           JOIN api_keys k ON k.key_hash = p.key_hash
          WHERE p.key_hash = ? AND k.stripe_subscription_id = p.subscription_id
            AND k.subscription_ended_at IS NULL`,
      )
      .get(keyHash) as { anchor_start: string } | undefined;
    if (!row) return civil;
    return anchoredPeriodAt(row.anchor_start, now) ?? civil;
  } catch (err) {
    console.error('[quota-period] anchor read failed:', err instanceof Error ? err.message : err);
    return { ...civil, degraded: true };
  }
}

export type AnchorOutcome =
  | 'anchored'
  | 're_anchored'
  | 'unchanged'
  | 'no_key'
  | 'key_not_subscribed'
  | 'no_period'
  | 'out_of_range'
  | 'older_than_known'
  | 'before_effective';

/**
 * Le premier début de période de facturation qui peut faire basculer une clé :
 * le 28 décembre 2026 à 00:00 heure de Zurich (UTC+1 en hiver). Les conditions
 * (§9) demandent 30 jours de préavis à un client qui a accepté une version
 * d'avant : la version 1.12 est publiée le 28 novembre 2026, donc aucune clé ne
 * bascule sur une période qui commence avant ce jour. Une facture plus ancienne
 * laisse la clé au mois civil, comme avant, sans rien lui retirer.
 */
export const ANCHOR_EFFECTIVE_FROM_ISO = '2026-12-27T23:00:00.000Z';

/**
 * La date de mise en vigueur lue au moment de l'appel. Seuls les essais
 * (`VITEST`) peuvent la déplacer, par `IBF_ANCHOR_EFFECTIVE_FROM` : en
 * production elle ne se règle pas.
 */
export function anchorEffectiveFromMs(): number {
  const override = process.env.VITEST ? process.env.IBF_ANCHOR_EFFECTIVE_FROM : undefined;
  const ms = override ? Date.parse(override) : NaN;
  return Number.isFinite(ms) ? ms : Date.parse(ANCHOR_EFFECTIVE_FROM_ISO);
}

/**
 * Pose, ou met à jour, l'ancre de facturation d'une clé à partir de la période
 * d'une facture de RENOUVELLEMENT payée. À appeler dans la transaction du
 * webhook (`recordSubscriptionInvoice`), seulement pour une facture neuve.
 *
 * Règles (chacune tient un test, src/lib/quota-period.anchor.test.ts) :
 *  - c'est la période de FACTURATION de Stripe (début de période de la facture),
 *    jamais la date du paiement : une relance réussie tard ne décale rien ;
 *  - rien avant le premier renouvellement payé : sans appel de cette fonction,
 *    la clé reste au mois civil ;
 *  - une facture dont le jour est déjà une limite de période de l'ancre connue ne
 *    change pas l'ancre (le 31 reste un 31 : Stripe ramène le 28 février, l'ancre
 *    ne dérive pas vers le 28) ;
 *  - une facture plus ancienne que la dernière connue (évènement rejoué dans le
 *    désordre) est laissée ;
 *  - un début de période absurde (plus de 45 jours dans le passé, plus de 2 dans
 *    le futur) n'ancre rien ;
 *  - une clé pas encore ancrée ne bascule jamais sur une période qui commence
 *    avant la mise en vigueur (`ANCHOR_EFFECTIVE_FROM_ISO`, 30 jours de préavis).
 */
export function recordSubscriptionAnchorInTx(
  db: ReturnType<typeof getStatsDB>,
  p: {
    keyHash: string | null;
    subscriptionId: string;
    /** Le début de la période de la facture, en secondes Unix (Stripe). */
    periodStartUnix: number | null;
    /** L'instant du paiement, en ms : sert seulement à borner la vraisemblance. */
    nowMs: number;
    /** La mise en vigueur, en ms ; par défaut `anchorEffectiveFromMs()`. */
    effectiveFromMs?: number;
  },
): AnchorOutcome {
  if (!p.keyHash) return 'no_key';
  const key = db
    .prepare(
      'SELECT stripe_subscription_id, subscription_ended_at FROM api_keys WHERE key_hash = ?',
    )
    .get(p.keyHash) as
    { stripe_subscription_id: string | null; subscription_ended_at: string | null } | undefined;
  if (!key || key.stripe_subscription_id !== p.subscriptionId || key.subscription_ended_at) {
    return 'key_not_subscribed';
  }
  if (typeof p.periodStartUnix !== 'number' || !Number.isFinite(p.periodStartUnix)) {
    return 'no_period';
  }
  const startMs = p.periodStartUnix * 1000;
  const DAY = 86_400_000;
  if (startMs > p.nowMs + 2 * DAY || startMs < p.nowMs - 45 * DAY) return 'out_of_range';
  const startIso = new Date(startMs).toISOString();

  const existing = db
    .prepare(
      'SELECT subscription_id, anchor_start, last_period_start FROM subscription_periods WHERE key_hash = ?',
    )
    .get(p.keyHash) as
    { subscription_id: string; anchor_start: string; last_period_start: string } | undefined;

  if (existing && existing.subscription_id === p.subscriptionId) {
    if (startMs < Date.parse(existing.last_period_start)) return 'older_than_known';
    if (matchesAnchor(Date.parse(existing.anchor_start), startMs)) {
      db.prepare('UPDATE subscription_periods SET last_period_start = ? WHERE key_hash = ?').run(
        startIso,
        p.keyHash,
      );
      return 'unchanged';
    }
    db.prepare(
      `UPDATE subscription_periods
          SET anchor_start = ?, last_period_start = ?, anchored_at = datetime('now')
        WHERE key_hash = ?`,
    ).run(startIso, startIso, p.keyHash);
    return 're_anchored';
  }
  // Pas d'ancre, ou celle d'un abonnement d'avant : la clé est ancrée sur celui-ci,
  // mais jamais sur une période qui commence avant la mise en vigueur.
  if (startMs < (p.effectiveFromMs ?? anchorEffectiveFromMs())) return 'before_effective';
  db.prepare(
    `INSERT INTO subscription_periods (key_hash, subscription_id, anchor_start, last_period_start)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key_hash) DO UPDATE SET
       subscription_id = excluded.subscription_id, anchor_start = excluded.anchor_start,
       last_period_start = excluded.last_period_start, anchored_at = datetime('now')`,
  ).run(p.keyHash, p.subscriptionId, startIso, startIso);
  return 'anchored';
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

/**
 * Le JOUR de la remise à zéro, « AAAA-MM-JJ » : le jour de Zurich pour une
 * période ancrée sur une facturation (où la remise à zéro tombe à 00:00 heure de
 * Zurich, soit la veille à 22:00 ou 23:00 UTC), le jour UTC sinon. C'est ce que
 * la page du compte dit au client, qui ne doit pas lire « le 9 » pour un
 * abonnement du 10.
 */
export function resetsOnOf(period: QuotaPeriod): string {
  return period.anchored ? zurichDayLabel(period.resetsAt) : period.resetsAt.slice(0, 10);
}

/**
 * La remise à zéro, dite dans un mail ou un refus : « 2026-12-01 00:00 UTC »
 * pour le mois civil (texte d'avant), « 2027-01-10 00:00 Zurich time
 * (2027-01-09 23:00 UTC) » pour une période ancrée.
 */
export function formatResetOfPeriod(period: QuotaPeriod): string {
  return period.anchored
    ? `${resetsOnOf(period)} 00:00 Zurich time (${formatResetUtc(period.resetsAt)})`
    : formatResetUtc(period.resetsAt);
}
