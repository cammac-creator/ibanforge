/**
 * « Encaissé moins coûts » dans le bulletin du lundi (priorité 05 de la feuille de
 * route, « mesurer le bénéfice avant d'élargir les dépenses », 07.10.2026).
 *
 * ## Les trois règles
 *
 * 1. **Chaque devise reste la sienne.** Un paiement en dollars est compté en dollars,
 *    les frais de Stripe dans la devise de règlement du compte, une facture dans la
 *    sienne. Rien n'est converti, rien ne s'additionne d'une devise à l'autre : le
 *    résultat est donné devise par devise.
 * 2. **Une période non couverte est inconnue.** Un coût saisi porte sa période (du jour
 *    `period_from` inclus au jour `period_to` exclu). Pour une période du bulletin, un
 *    poste n'est connu que si ses saisies tombent toutes DANS la période et la couvrent
 *    entière, sans trou ni chevauchement. Une facture qui déborde (un cycle Vercel du 9
 *    au 8) ne se répartit pas au prorata : le poste est inconnu pour le mois.
 * 3. **Un inconnu ne devient jamais zéro.** Quand un poste attendu manque, le résultat
 *    est donné comme un plafond (« au plus ») : les coûts manquants ne peuvent que le
 *    faire baisser. Quand l'encaissé lui-même est incertain (Stripe injoignable, ou un
 *    classement des paiements manqué, qui peut en avoir sorti de l'argent d'IBANforge),
 *    le résultat est inconnu.
 *
 * ## D'où viennent les montants
 *
 *  - l'encaissé et les frais : la lecture Stripe partagée (`stripe-revenue.ts`, le
 *    cache de quinze minutes de la tuile « Encaissé »), jour suisse par jour suisse,
 *    périmètre IBANforge (packs, abonnements, audits ; jamais « autre ») ;
 *  - les autres coûts : saisis par la session principale (`POST /v1/admin/bulletin/costs`)
 *    depuis une facture, un relevé ou une estimation, la nature étant gardée. Ni le site,
 *    ni l'API, ni les modèles de langage ne se lisent d'ici : le compteur de dépense des
 *    modèles (PR 265) écrit dans le journal de Railway, que les assistants ne lisent pas
 *    (règle 11). Aucun montant n'est écrit dans ce dépôt public.
 *
 * L'argent reçu par x402 (USDC sur Base) n'est pas compté ici : sa lecture prend une
 * vingtaine de secondes et ne se fait pas pour une page. La définition le dit.
 */
import { getStatsDB } from './db.js';
import { cleanFeedLine } from './bulletin-feed.js';
import type {
  DayTotals,
  MinorByCurrency,
  StripeRevenueResult,
  StripeUnavailableReason,
} from './stripe-revenue.js';
import type { SwissWeek } from './swiss-week.js';

/**
 * Les postes de coût. `expected` : un poste payé chaque mois, dont l'absence fait du
 * résultat un plafond. Les autres ne comptent que s'ils sont saisis.
 */
export const COST_ITEMS = [
  { item: 'vercel', label: 'Site (Vercel)', expected: true },
  { item: 'railway', label: 'API (Railway)', expected: true },
  { item: 'modeles', label: 'Modèles de langage', expected: true },
  { item: 'domaines', label: 'Noms de domaine et courriel', expected: false },
  { item: 'autre', label: 'Autre coût', expected: false },
] as const;

export type CostItem = (typeof COST_ITEMS)[number]['item'];
export type CostNature = 'facture' | 'releve' | 'estime';
const NATURES: readonly CostNature[] = ['facture', 'releve', 'estime'];

export function isCostItem(value: unknown): value is CostItem {
  return typeof value === 'string' && COST_ITEMS.some((c) => c.item === value);
}

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
/** Une saisie couvre au plus un peu plus d'un an : au-delà, c'est une erreur de frappe. */
export const COST_PERIOD_MAX_DAYS = 400;
export const COST_NOTE_MAX = 200;
/** Un plafond de frappe, pas un budget : cent mille unités de la devise. */
export const COST_AMOUNT_MAX_MINOR = 10_000_000;

function civilMs(civil: string): number | null {
  const m = CIVIL.exec(civil);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Le jour doit exister (pas de 31 septembre).
  return new Date(ms).toISOString().slice(0, 10) === civil ? ms : null;
}

function civilOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Les saisies ─────────────────────────────────────────────────────────────

export interface CostEntry {
  id: number;
  item: CostItem;
  period_from: string;
  period_to: string;
  amount_minor: number;
  currency: string;
  nature: CostNature;
  note: string | null;
  recorded_at: string;
}

export type SaveCostResult =
  | { ok: true; id: number; replaced: boolean }
  | {
      ok: false;
      error:
        | 'invalid_body'
        | 'invalid_item'
        | 'invalid_period'
        | 'invalid_amount'
        | 'invalid_currency'
        | 'invalid_nature'
        | 'invalid_note'
        | 'overlap';
    };

/**
 * Une saisie de coût : `{ item, from, to, amount_minor, currency, nature, note? }`.
 * La même période d'un même poste remplace la saisie précédente ; une période qui en
 * chevauche une autre du même poste est refusée (elle la compterait deux fois).
 */
export function saveCost(raw: unknown): SaveCostResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_body' };
  }
  const b = raw as Record<string, unknown>;
  const allowed = ['item', 'from', 'to', 'amount_minor', 'currency', 'nature', 'note'];
  if (Object.keys(b).some((k) => !allowed.includes(k))) return { ok: false, error: 'invalid_body' };
  if (!isCostItem(b.item)) return { ok: false, error: 'invalid_item' };
  const from = typeof b.from === 'string' ? civilMs(b.from) : null;
  const to = typeof b.to === 'string' ? civilMs(b.to) : null;
  if (from === null || to === null || to <= from || to - from > COST_PERIOD_MAX_DAYS * DAY_MS) {
    return { ok: false, error: 'invalid_period' };
  }
  if (
    typeof b.amount_minor !== 'number' ||
    !Number.isInteger(b.amount_minor) ||
    b.amount_minor < 0 ||
    b.amount_minor > COST_AMOUNT_MAX_MINOR
  ) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (typeof b.currency !== 'string' || !/^[a-z]{3}$/.test(b.currency)) {
    return { ok: false, error: 'invalid_currency' };
  }
  if (typeof b.nature !== 'string' || !(NATURES as readonly string[]).includes(b.nature)) {
    return { ok: false, error: 'invalid_nature' };
  }
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string') return { ok: false, error: 'invalid_note' };
    note = cleanFeedLine(b.note) || null;
    if (note !== null && [...note].length > COST_NOTE_MAX)
      return { ok: false, error: 'invalid_note' };
  }
  const periodFrom = civilOf(from);
  const periodTo = civilOf(to);
  const db = getStatsDB();
  const overlapping = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bulletin_costs
        WHERE item = ? AND period_from < ? AND period_to > ?
          AND NOT (period_from = ? AND period_to = ?)`,
    )
    .get(b.item, periodTo, periodFrom, periodFrom, periodTo) as { n: number };
  if (overlapping.n > 0) return { ok: false, error: 'overlap' };
  const existing = db
    .prepare(`SELECT id FROM bulletin_costs WHERE item = ? AND period_from = ? AND period_to = ?`)
    .get(b.item, periodFrom, periodTo) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE bulletin_costs SET amount_minor = ?, currency = ?, nature = ?, note = ?,
              recorded_at = datetime('now') WHERE id = ?`,
    ).run(b.amount_minor, b.currency, b.nature, note, existing.id);
    return { ok: true, id: existing.id, replaced: true };
  }
  const info = db
    .prepare(
      `INSERT INTO bulletin_costs (item, period_from, period_to, amount_minor, currency, nature, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(b.item, periodFrom, periodTo, b.amount_minor, b.currency, b.nature, note);
  return { ok: true, id: Number(info.lastInsertRowid), replaced: false };
}

export function listCosts(): CostEntry[] {
  return getStatsDB()
    .prepare(
      `SELECT id, item, period_from, period_to, amount_minor, currency, nature, note, recorded_at
         FROM bulletin_costs ORDER BY period_from, item, id`,
    )
    .all() as CostEntry[];
}

/** Retire une saisie faite par erreur. Rend false quand elle n'existe pas. */
export function deleteCost(id: number): boolean {
  return getStatsDB().prepare(`DELETE FROM bulletin_costs WHERE id = ?`).run(id).changes > 0;
}

// ─── Les périodes du bulletin ───────────────────────────────────────────────

export interface MoneyPeriodBounds {
  /** `AAAA-MM`. */
  month: string;
  /** Premier jour inclus, `AAAA-MM-JJ`. */
  from: string;
  /** Jour exclu, `AAAA-MM-JJ`. */
  to: string;
  /** false : le mois n'est lu que jusqu'à la fin de la semaine du bulletin. */
  complete: boolean;
}

/**
 * Les deux périodes d'un bulletin : le mois précédent, entier, et le mois du dimanche
 * de la semaine, du 1er à la fin de la semaine (entier si la semaine le finit).
 */
export function moneyPeriods(week: SwissWeek): MoneyPeriodBounds[] {
  const sunday = civilMs(week.sunday) as number;
  const d = new Date(sunday);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const monthStart = Date.UTC(y, m, 1);
  const nextMonth = Date.UTC(y, m + 1, 1);
  const prevStart = Date.UTC(y, m - 1, 1);
  const weekEnd = sunday + DAY_MS;
  const label = (ms: number) => civilOf(ms).slice(0, 7);
  return [
    { month: label(prevStart), from: civilOf(prevStart), to: civilOf(monthStart), complete: true },
    {
      month: label(monthStart),
      from: civilOf(monthStart),
      to: civilOf(Math.min(weekEnd, nextMonth)),
      complete: weekEnd >= nextMonth,
    },
  ];
}

// ─── Le calcul ─────────────────────────────────────────────────────────────

export type CostUnknownReason =
  'non_saisi' | 'partiel' | 'deborde' | 'stripe_indisponible' | 'frais_incomplets';

export type CostLine =
  | {
      item: string;
      label: string;
      source: 'stripe' | 'saisie';
      expected: boolean;
      state: 'connu';
      amounts: MinorByCurrency;
      /** `mesure` pour Stripe ; la nature la plus faible des saisies sinon. */
      nature: 'mesure' | CostNature;
    }
  | {
      item: string;
      label: string;
      source: 'stripe' | 'saisie';
      expected: boolean;
      state: 'inconnu';
      reason: CostUnknownReason;
      /** Ce poste fait-il du résultat un plafond ? Un poste ponctuel non saisi, non. */
      blocking: boolean;
    };

export type Received =
  | {
      state: 'read';
      count: number;
      gross: MinorByCurrency;
      refunded: MinorByCurrency;
      /** Une clé de test : des montants fictifs. */
      test_mode: boolean;
    }
  | { state: 'inconnu'; reason: StripeUnavailableReason | 'classement_incomplet' };

export type ResultStatus = 'exact' | 'estime' | 'au_plus' | 'inconnu';

export interface MoneyPeriod extends MoneyPeriodBounds {
  received: Received;
  costs: CostLine[];
  result: {
    status: ResultStatus;
    /** Par devise, encaissé moins remboursé moins coûts connus ; null quand inconnu. */
    by_currency: MinorByCurrency | null;
    /** Les postes dont le résultat attend la saisie, par leur libellé. */
    missing: string[];
  };
}

export interface BulletinMoney {
  state: 'read';
  /** Quand Stripe a été lu (le cache a quinze minutes au plus), ou null. */
  stripe_read_at: string | null;
  periods: MoneyPeriod[];
}

function addInto(target: MinorByCurrency, source: MinorByCurrency, sign = 1): void {
  for (const [c, v] of Object.entries(source)) target[c] = (target[c] ?? 0) + sign * v;
}

function sumDays(days: Record<string, DayTotals>, from: string, to: string): DayTotals {
  const out: DayTotals = { count: 0, gross: {}, refunded: {}, fees: {}, net_unknown: 0 };
  for (const [day, t] of Object.entries(days)) {
    if (day < from || day >= to) continue;
    out.count += t.count;
    addInto(out.gross, t.gross);
    addInto(out.refunded, t.refunded);
    addInto(out.fees, t.fees);
    out.net_unknown += t.net_unknown;
  }
  return out;
}

const NATURE_RANK: Record<CostNature, number> = { facture: 0, releve: 1, estime: 2 };

/** Un poste saisi sur une période : connu seulement si ses saisies la pavent exactement. */
function itemLine(
  c: (typeof COST_ITEMS)[number],
  entries: CostEntry[],
  bounds: MoneyPeriodBounds,
): CostLine {
  const base = { item: c.item, label: c.label, source: 'saisie' as const, expected: c.expected };
  const touching = entries
    .filter((e) => e.item === c.item && e.period_from < bounds.to && e.period_to > bounds.from)
    .sort((a, b) => a.period_from.localeCompare(b.period_from));
  if (touching.length === 0) {
    return { ...base, state: 'inconnu', reason: 'non_saisi', blocking: c.expected };
  }
  if (touching.some((e) => e.period_from < bounds.from || e.period_to > bounds.to)) {
    return { ...base, state: 'inconnu', reason: 'deborde', blocking: true };
  }
  let cursor = bounds.from;
  for (const e of touching) {
    if (e.period_from !== cursor) {
      return { ...base, state: 'inconnu', reason: 'partiel', blocking: true };
    }
    cursor = e.period_to;
  }
  if (cursor !== bounds.to) {
    return { ...base, state: 'inconnu', reason: 'partiel', blocking: true };
  }
  const amounts: MinorByCurrency = {};
  let nature: CostNature = 'facture';
  for (const e of touching) {
    amounts[e.currency] = (amounts[e.currency] ?? 0) + e.amount_minor;
    if (NATURE_RANK[e.nature] > NATURE_RANK[nature]) nature = e.nature;
  }
  return { ...base, state: 'connu', amounts, nature };
}

function period(
  bounds: MoneyPeriodBounds,
  stripe: StripeRevenueResult,
  entries: CostEntry[],
): MoneyPeriod {
  const costs: CostLine[] = [];
  let received: Received;
  const feesBase = {
    item: 'frais_stripe',
    label: 'Frais Stripe',
    source: 'stripe' as const,
    expected: true,
  };
  if (!stripe.ok) {
    received = { state: 'inconnu', reason: stripe.reason };
    costs.push({ ...feesBase, state: 'inconnu', reason: 'stripe_indisponible', blocking: true });
  } else {
    const snap = stripe.snapshot;
    const t = sumDays(snap.ibanforge_days ?? {}, bounds.from, bounds.to);
    received =
      snap.classification.invoices && snap.classification.sessions
        ? {
            state: 'read',
            count: t.count,
            gross: t.gross,
            refunded: t.refunded,
            test_mode: snap.livemode === false,
          }
        : { state: 'inconnu', reason: 'classement_incomplet' };
    costs.push(
      t.net_unknown > 0
        ? { ...feesBase, state: 'inconnu', reason: 'frais_incomplets', blocking: true }
        : { ...feesBase, state: 'connu', amounts: t.fees, nature: 'mesure' },
    );
  }
  for (const c of COST_ITEMS) costs.push(itemLine(c, entries, bounds));

  const missing = costs.filter((l) => l.state === 'inconnu' && l.blocking).map((l) => l.label);
  if (received.state !== 'read') {
    return {
      ...bounds,
      received,
      costs,
      result: { status: 'inconnu', by_currency: null, missing },
    };
  }
  const net: MinorByCurrency = {};
  addInto(net, received.gross);
  addInto(net, received.refunded, -1);
  for (const l of costs) if (l.state === 'connu') addInto(net, l.amounts, -1);
  const estimated = costs.some((l) => l.state === 'connu' && l.nature === 'estime');
  const status: ResultStatus = missing.length > 0 ? 'au_plus' : estimated ? 'estime' : 'exact';
  return { ...bounds, received, costs, result: { status, by_currency: net, missing } };
}

/** Le bloc « Encaissé moins coûts » d'une semaine du bulletin. */
export function readMoney(week: SwissWeek, stripe: StripeRevenueResult): BulletinMoney {
  const entries = listCosts();
  return {
    state: 'read',
    stripe_read_at: stripe.ok ? stripe.snapshot.read_at : null,
    periods: moneyPeriods(week).map((b) => period(b, stripe, entries)),
  };
}
