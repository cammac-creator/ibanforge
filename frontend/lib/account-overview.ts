/**
 * La page du compte, lue comme une suite d'écrans : ce module transforme
 * chaque réponse de l'API en l'écran qui suit, et chaque clé en sa fiche.
 *
 * Fonction pure, sans DOM, sans traduction et sans horloge : le lanceur du site
 * ne monte pas de composants (`vitest.config.ts` : environnement `node`), et
 * tout ce qui peut se tromper ici est une règle de lecture. Le composant
 * (`components/account/account-app.tsx`) ne fait que les appels et le rendu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX MODES, UNE SEULE FICHE
 * ─────────────────────────────────────────────────────────────────────────────
 * Connecté, la page lit `GET /v1/account/overview` (cookie posé par l'API) ;
 * clé collée, elle lit `GET /v1/keys/report` (la clé en en-tête). Les deux
 * réponses passent par le MÊME constructeur, `buildSheet`, qui reprend les
 * règles de solde de `account-credits.ts` : un chiffre ne peut pas différer
 * entre la clé vue depuis le compte et la même clé collée.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * « SESSION TERMINÉE » NE SE VOIT QUE PAR TRANSITION
 * ─────────────────────────────────────────────────────────────────────────────
 * Le cookie est httpOnly : la page ne peut pas savoir s'il existe. L'API rend
 * le même 401 `signed_out` sans cookie et avec un cookie expiré. Au chargement,
 * un 401 veut donc dire « déconnecté », sans plus. « Votre session a pris fin »
 * ne s'affiche que quand un appel parti DE L'ÉTAT CONNECTÉ rend 401 (ouvrir un
 * rapport, changer de page). D'où des transitions qui prennent l'écran
 * précédent en plus de la réponse.
 *
 * Et au chargement, une panne (réseau, CORS, 5xx) rend le formulaire sans
 * message : un visiteur qui n'a encore rien demandé n'a pas à lire une erreur.
 * Les erreurs ne s'affichent qu'en réponse à un geste.
 */

import { isCreditKey, isMixedKey, readBalance, type AccountUsage } from './account-credits';

// ─── Réponses de l'API ───────────────────────────────────────────────────────

/**
 * Une réponse telle que la page la reçoit : le statut et le corps JSON lu
 * (`null` s'il n'y en a pas ou s'il est illisible). `status: 0` quand la
 * requête n'a pas abouti du tout : réseau coupé, CORS refusé, hors ligne.
 */
export interface ApiReply {
  status: number;
  body: unknown;
}

export const NETWORK_FAILURE: ApiReply = { status: 0, body: null };

/** Délai avant de proposer « Renvoyer un code » (plan §3.3). */
export const RESEND_AFTER_SECONDS = 60;

/** Le rapport détaillé d'une clé, même forme sur les deux routes. */
export interface KeyReport {
  window_days: number;
  total: number;
  ok: number;
  failed: number;
  avg_ms: number | null;
  days: Array<{ day: string; count: number; failed: number }>;
  endpoints: Array<{ path: string; count: number }>;
  errors: Array<{ path: string; status: number; count: number; meaning: string; fix: string }>;
  footprint: { distinct_networks: number; unusual: boolean | null };
}

/** Ce que rendent `/v1/keys/report` et `/v1/account/keys/report`. */
export interface KeyReportPayload {
  key_prefix: string;
  // Le bloc complet de `/v1/keys/usage`, `basis` et solde de crédits compris.
  usage: AccountUsage;
  report: KeyReport;
}

// ─── Les messages d'erreur ───────────────────────────────────────────────────

/**
 * Ce que la page dit, hors écran normal. Chaque valeur a son texte dans
 * l'espace `account` des messages (plan §6, sauf `load_failed`).
 */
export type Notice =
  | 'code_invalid'
  | 'rate_limited'
  | 'address'
  | 'service'
  | 'session_ended'
  | 'load_failed';

/**
 * Le champ `error` de l'API d'abord, le statut ensuite : le limiteur global
 * rend aussi des 429, avec `rate_limit_exceeded`, et « trop de codes pour
 * cette adresse » serait faux pour lui. Tout ce qui n'est pas ici, panne du
 * relais (503) et panne réseau comprises, est « connexion indisponible ».
 */
const ERROR_NOTICES: Readonly<Record<string, Notice>> = {
  // Un seul code pour « faux, expiré ou trop d'essais » depuis la relecture de
  // sécurité (M1) : l'API ne dit plus lequel, pour ne rien révéler de l'adresse.
  invalid_code: 'code_invalid',
  code_rate_limited: 'rate_limited',
  invalid_email: 'address',
  disposable_email: 'address',
  undeliverable_email: 'address',
};

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function noticeFor(reply: ApiReply): Notice {
  const error = record(reply.body)?.error;
  return (typeof error === 'string' && ERROR_NOTICES[error]) || 'service';
}

// ─── La fiche d'une clé ──────────────────────────────────────────────────────

export type PlanPart = 'free' | 'custom' | 'pack' | 'pro' | 'editor';

const PLAN_PARTS: readonly PlanPart[] = ['free', 'custom', 'pack', 'pro', 'editor'];

export type AlertKind = 'quota_80' | 'credits_low';

/**
 * La fiche, telle que le composant la rend. Un champ `null` n'est pas servi par
 * la source (la clé collée ne dit ni sa formule, ni ses alertes, ni son
 * dernier appel) : sa ligne ne s'affiche pas. Rien n'est deviné.
 */
export interface KeySheet {
  prefix: string;
  /** `parts` vide : formule inconnue du site, `raw` sert alors de libellé de repli. */
  plan: { parts: PlanPart[]; raw: string } | null;
  /** L'allocation propre de la clé. `lifetime` : mesurée sur toute sa vie, pas sur le mois. */
  allowance: { lifetime: boolean; remaining: number; limit: number | null } | null;
  /** Le solde de crédits ; `total` null quand le lot n'est pas connu. */
  credits: { remaining: number | null; total: number | null } | null;
  callsThisMonth: number | null;
  month: string | null;
  /** `{ at: null }` : servi, aucun appel conservé. */
  lastCall: { at: string | null } | null;
  alerts: Array<{ kind: AlertKind; sentAt: string | null }> | null;
  /** Le portail Stripe d'un abonné, seulement en https. */
  manageUrl: string | null;
  /**
   * Recharger CETTE clé (lot B1) : les trois liens de paiement, porteurs de sa
   * référence, seulement en https. `proven` dit si l'adresse de la clé a été
   * prouvée par un code (vue du compte) ; `null` en mode clé collée, où tenir
   * la clé prouve déjà qu'elle est la sienne. La page n'offre la recharge d'une
   * clé à l'adresse non prouvée qu'avec un avertissement (relecture de sécurité
   * du lot C1, point I1).
   */
  topup: { links: Record<TopupSlug, string>; proven: boolean | null } | null;
}

export type TopupSlug = '1k' | '5k' | '25k';

/**
 * Les packs d'une recharge, dans l'ordre et aux prix de la page des tarifs
 * (`app/[locale]/pricing/page.tsx`). Le prix n'est qu'un libellé : le montant
 * payé est celui du lien Stripe, que l'API sert.
 */
export const TOPUP_PACKS: ReadonlyArray<{ slug: TopupSlug; credits: number; price: string }> = [
  { slug: '1k', credits: 1000, price: '$4' },
  { slug: '5k', credits: 5000, price: '$20' },
  { slug: '25k', credits: 25000, price: '$80' },
];

/** Les trois liens, tous en https, ou rien : une recharge à moitié servie ne s'affiche pas. */
function readTopupLinks(raw: unknown): Record<TopupSlug, string> | null {
  const links = record(raw);
  if (!links) return null;
  const out: Partial<Record<TopupSlug, string>> = {};
  for (const { slug } of TOPUP_PACKS) {
    const url = safeHttpsUrl(links[slug]);
    if (!url) return null;
    out[slug] = url;
  }
  return out as Record<TopupSlug, string>;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Une formule composée (`free+pack` après le lot B1) se lit partie par partie.
 * Une partie inconnue ne casse rien : la formule entière garde sa forme brute,
 * que la page affiche telle quelle.
 */
export function parsePlan(raw: unknown): KeySheet['plan'] {
  const value = text(raw);
  if (!value) return null;
  const pieces = value.split('+').map((p) => p.trim());
  const known = pieces.every((p): p is PlanPart => (PLAN_PARTS as readonly string[]).includes(p));
  return { parts: known ? (pieces as PlanPart[]) : [], raw: value };
}

/**
 * Seul un lien `https:` devient un lien. La page ne rend jamais une adresse
 * servie en `javascript:` ou en `http:`, même si l'API en servait une (relecture
 * de sécurité, point 14).
 */
export function safeHttpsUrl(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function readAlerts(raw: unknown): KeySheet['alerts'] {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ kind: AlertKind; sentAt: string | null }> = [];
  for (const item of raw) {
    const a = record(item);
    if (!a || (a.kind !== 'quota_80' && a.kind !== 'credits_low')) continue;
    out.push({ kind: a.kind, sentAt: text(a.sent_at) });
  }
  return out;
}

/** Ce que les deux adaptateurs remettent au constructeur, encore non vérifié. */
interface SheetInput {
  prefix: unknown;
  plan: unknown;
  allowance: { basis: unknown; limit: unknown; used: unknown; remaining: unknown } | null;
  credits: { remaining: unknown; total: unknown } | null;
  callsThisMonth: unknown;
  month: unknown;
  lastCall: { at: unknown } | null;
  alerts: unknown;
  manageUrl: unknown;
  topup: unknown;
  proven: unknown;
}

/**
 * LE constructeur de la fiche, pour les deux modes. Les soldes passent par
 * `readBalance` (`account-credits.ts`), avec ses règles et aucune autre : reste
 * d'allocation jamais négatif, lot de total nul lu comme inconnu, solde
 * illisible lu comme absent plutôt qu'inventé.
 */
function buildSheet(input: SheetInput): KeySheet | null {
  const prefix = text(input.prefix);
  if (!prefix) return null;
  const month = text(input.month) ?? '';

  let allowance: KeySheet['allowance'] = null;
  if (input.allowance && input.allowance.basis !== 'credits') {
    const quota = readBalance({
      used: finite(input.allowance.used) ?? 0,
      limit: finite(input.allowance.limit) ?? 0,
      remaining: finite(input.allowance.remaining) ?? 0,
      month,
      basis: input.allowance.basis === 'lifetime' ? 'lifetime' : 'monthly',
    });
    const limit = finite(input.allowance.limit);
    if (quota.kind === 'quota' && finite(input.allowance.remaining) !== null) {
      allowance = {
        lifetime: input.allowance.basis === 'lifetime',
        remaining: quota.remaining,
        limit: limit !== null && limit > 0 ? limit : null,
      };
    }
  }

  let credits: KeySheet['credits'] = null;
  if (input.credits) {
    const balance = readBalance({
      used: 0,
      limit: 0,
      remaining: 0,
      month,
      basis: 'credits',
      ...(finite(input.credits.remaining) !== null ? { credits_remaining: finite(input.credits.remaining) as number } : {}),
      ...(finite(input.credits.total) !== null ? { credits_total: finite(input.credits.total) as number } : {}),
    });
    if (balance.kind === 'credits') {
      credits = { remaining: balance.creditsRemaining, total: balance.creditsTotal };
    }
  }

  const links = readTopupLinks(input.topup);
  return {
    prefix,
    plan: parsePlan(input.plan),
    allowance,
    credits,
    callsThisMonth: finite(input.callsThisMonth),
    month: month || null,
    lastCall: input.lastCall ? { at: text(input.lastCall.at) } : null,
    alerts: readAlerts(input.alerts),
    manageUrl: safeHttpsUrl(input.manageUrl),
    topup: links ? { links, proven: typeof input.proven === 'boolean' ? input.proven : null } : null,
  };
}

/**
 * Une clé de la vue d'ensemble (plan §5). `allowance` est `null` pour une clé à
 * crédits aujourd'hui ; une clé mixte (après B1) porte les deux blocs, et la
 * fiche montre alors les deux soldes.
 */
export function sheetFromOverviewKey(raw: unknown, month: unknown): KeySheet | null {
  const key = record(raw);
  if (!key) return null;
  const allowance = record(key.allowance);
  const credits = record(key.credits);
  const actions = record(key.actions);
  const subscription = record(key.subscription);
  return buildSheet({
    prefix: key.key_prefix,
    plan: key.plan,
    allowance: allowance
      ? { basis: allowance.basis, limit: allowance.limit, used: allowance.used, remaining: allowance.remaining }
      : null,
    credits: credits ? { remaining: credits.remaining, total: credits.purchased_total } : null,
    callsThisMonth: key.calls_this_month,
    month,
    lastCall: { at: key.last_call_at },
    alerts: key.alerts,
    manageUrl: actions?.manage_subscription ?? subscription?.manage_url ?? null,
    topup: actions?.topup ?? null,
    // Absent d'une API d'avant le lot B1 : lu comme « non prouvée », pour que
    // la page avertisse plutôt que de taire le doute.
    proven: key.address_proven === true,
  });
}

/**
 * Une clé collée : le bloc `usage` de `/v1/keys/report`. Il ne dit ni la
 * formule, ni les alertes, ni le dernier appel : ces lignes restent vides
 * plutôt que devinées. Pour une clé mesurée sur sa vie (`lifetime`), `used`
 * compte tous les mois : ce n'est pas « ce mois-ci », la ligne reste vide.
 */
export function sheetFromReport(payload: KeyReportPayload): KeySheet | null {
  const usage = payload.usage;
  const credit = isCreditKey(usage);
  // Une clé mixte (lot B1) montre ses deux soldes : l'allocation, puis les crédits.
  const mixed = isMixedKey(usage);
  return buildSheet({
    prefix: payload.key_prefix,
    plan: null,
    allowance: credit
      ? null
      : { basis: usage.basis, limit: usage.limit, used: usage.used, remaining: usage.remaining },
    credits:
      credit || mixed ? { remaining: usage.credits_remaining, total: usage.credits_total } : null,
    callsThisMonth: usage.basis === 'lifetime' ? null : usage.used,
    month: usage.month,
    lastCall: null,
    alerts: null,
    manageUrl: null,
    topup: usage.topup?.by_card ?? null,
    // Le porteur a collé la clé : il la tient, aucun doute à lever.
    proven: null,
  });
}

// ─── Les écrans ──────────────────────────────────────────────────────────────

export type AccountScreen =
  /** Au chargement, le temps de demander la vue : le même rendu au serveur et au navigateur. */
  | { kind: 'checking' }
  | { kind: 'signed_out'; notice: Notice | null }
  | { kind: 'code_sent'; email: string; sentAt: number; notice: Notice | null }
  /** Le code est accepté, la vue est en route. */
  | { kind: 'opening'; email: string }
  | {
      kind: 'signed_in';
      email: string;
      month: string;
      page: number;
      pages: number;
      keys: KeySheet[];
      notice: Notice | null;
    }
  | { kind: 'no_keys'; email: string; notice: Notice | null };

export const CHECKING: AccountScreen = { kind: 'checking' };

function isConnected(s: AccountScreen): s is Extract<AccountScreen, { kind: 'signed_in' | 'no_keys' }> {
  return s.kind === 'signed_in' || s.kind === 'no_keys';
}

/**
 * Réponse à « Recevoir un code » (ou « Renvoyer un code »). 202 : le code est
 * parti, l'écran du code s'ouvre et l'horloge du renvoi repart de `now`. Un
 * refus garde l'écran où l'on était, avec son message.
 */
export function afterCodeRequest(
  reply: ApiReply,
  email: string,
  now: number,
  previous: AccountScreen,
): AccountScreen {
  if (reply.status === 202) return { kind: 'code_sent', email, sentAt: now, notice: null };
  const notice = noticeFor(reply);
  if (previous.kind === 'code_sent') return { ...previous, notice };
  return { kind: 'signed_out', notice };
}

/**
 * Réponse à « Se connecter ». 200 : la session est posée par l'API, la vue suit.
 * Un code faux ou épuisé garde l'écran du code ; une adresse refusée ramène à
 * l'écran de l'adresse.
 */
export function afterSignIn(
  reply: ApiReply,
  previous: Extract<AccountScreen, { kind: 'code_sent' }>,
): AccountScreen {
  if (reply.status === 200 && record(reply.body)?.signed_in === true) {
    return { kind: 'opening', email: previous.email };
  }
  const notice = noticeFor(reply);
  if (notice === 'address') return { kind: 'signed_out', notice };
  return { ...previous, notice };
}

/** La vue d'ensemble lue, ou null si elle n'a pas la forme attendue. */
function readOverview(body: unknown) {
  const view = record(body);
  const email = text(view?.email);
  if (!view || !email || !Array.isArray(view.keys)) return null;
  const month = text(view.month) ?? '';
  const keys = view.keys
    .map((k) => sheetFromOverviewKey(k, month))
    .filter((k): k is KeySheet => k !== null);
  const page = Math.max(1, Math.trunc(finite(view.page) ?? 1));
  const pages = Math.max(page, Math.trunc(finite(view.pages) ?? 1));
  return { email, month, page, pages, keys };
}

/**
 * Réponse de `GET /v1/account/overview`, selon d'où l'on vient.
 *
 * - Au chargement (`checking`) : 401 = déconnecté ; toute panne = déconnecté
 *   aussi, sans message.
 * - Juste après un code accepté (`opening`) : un 401 veut dire que le
 *   navigateur n'a pas gardé le cookie (Safari qui le refuserait, par exemple).
 *   Ce n'est pas une « session terminée » : c'est la connexion qui n'a pas
 *   marché, et la page le dit.
 * - Depuis l'écran connecté : 401 = session terminée ; une panne garde l'écran
 *   et dit que le chargement a échoué.
 */
export function afterOverview(reply: ApiReply, previous: AccountScreen): AccountScreen {
  const view = reply.status === 200 ? readOverview(reply.body) : null;
  if (view) {
    if (view.keys.length === 0 && view.page === 1) {
      return { kind: 'no_keys', email: view.email, notice: null };
    }
    return { kind: 'signed_in', ...view, notice: null };
  }
  if (reply.status === 401) {
    if (isConnected(previous)) return { kind: 'signed_out', notice: 'session_ended' };
    if (previous.kind === 'opening') return { kind: 'signed_out', notice: 'service' };
    return { kind: 'signed_out', notice: null };
  }
  if (isConnected(previous)) return { ...previous, notice: 'load_failed' };
  if (previous.kind === 'opening') return { kind: 'signed_out', notice: 'service' };
  return { kind: 'signed_out', notice: null };
}

/**
 * Réponse de « Se déconnecter » (partout ou non). L'API rend 204 même sans
 * session vivante : tout 2xx vaut déconnexion. Une panne garde l'écran.
 */
export function afterLogout(reply: ApiReply, previous: AccountScreen): AccountScreen {
  if (reply.status >= 200 && reply.status < 300) return { kind: 'signed_out', notice: null };
  // 401 : la session n'existe déjà plus (cookie en double effacé par l'API,
  // session révoquée ailleurs). Le but de la déconnexion est atteint.
  if (reply.status === 401) return { kind: 'signed_out', notice: null };
  if (isConnected(previous)) return { ...previous, notice: 'service' };
  return previous;
}

/** Le rapport d'une clé ouverte depuis le compte. */
export type ReportOutcome =
  | { kind: 'ready'; payload: KeyReportPayload }
  | { kind: 'session_ended' }
  | { kind: 'failed' };

export function readReport(reply: ApiReply): ReportOutcome {
  if (reply.status === 401) return { kind: 'session_ended' };
  const body = record(reply.body);
  if (reply.status === 200 && body && record(body.usage) && record(body.report) && text(body.key_prefix)) {
    return { kind: 'ready', payload: body as unknown as KeyReportPayload };
  }
  return { kind: 'failed' };
}

// ─── Petites règles d'affichage ──────────────────────────────────────────────

/** Secondes avant de pouvoir renvoyer un code ; 0 quand c'est possible. */
export function resendWaitSeconds(sentAt: number, now: number): number {
  return Math.max(0, Math.ceil((sentAt + RESEND_AFTER_SECONDS * 1000 - now) / 1000));
}

/** Le code tel qu'on l'envoie : sans espaces ni tirets (« 123 456 », « 123-456 »). */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function isCompleteCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

const STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/**
 * Un horodatage UTC de l'API, écrit « 2026-09-18 08:15 UTC ». Sans `Intl`
 * (règle 8 d'AGENTS.md) et sans conversion : les clients sont partout, et
 * l'axe des jours de la page est déjà en UTC. Une valeur illisible rend null.
 */
export function formatUtcStamp(raw: string | null): string | null {
  const m = raw ? STAMP.exec(raw) : null;
  return m ? `${m[1]} ${m[2]} UTC` : null;
}
