import { Hono } from 'hono';
import { isAdminAuthorized } from '../lib/admin-auth.js';
import { notifyOps } from '../lib/ops-alert.js';
import { zurichDayTime } from '../lib/swiss-week.js';

/**
 * `POST /v1/admin/dashboard-login-alert` : le site prévient le propriétaire d'une
 * connexion à son tableau de bord (audit du 10.11.2026, WEB-01, lot C11).
 *
 * ## Pourquoi une route de l'API
 *
 * Le site n'a aucun canal d'alerte à lui : le seul qui joint le propriétaire est le
 * bot Telegram de l'API (`notifyOps`, `src/lib/ops-alert.ts`). Le site l'atteint ici
 * avec ce qu'il possède déjà (`API_URL` et son secret d'administration) : aucune
 * variable nouvelle, et le jeton du bot reste hors du processus du site.
 *
 * ## Ce que la route accepte
 *
 * Deux événements décrits, jamais un texte libre : le message est composé ICI, et
 * chaque champ est vérifié avant l'envoi.
 *
 *  - `login_ok` : une connexion réussie, avec l'heure et un indice MASQUÉ du réseau
 *    (`198.51.x.x`, `2001:db8::/32` ou `inconnu`). Une adresse complète est refusée
 *    (400) et rien ne part : Telegram n'est pas un sous-traitant déclaré (règle 3 de
 *    `ops-alert.ts`), et c'est la seconde barrière, après le masque posé par le site.
 *  - `global_cap` : le plafond global des mots de passe faux est atteint ; une seule
 *    alerte par épisode, le site s'en charge.
 *
 * Pas de garde anti-tempête : chaque connexion réussie doit prévenir. Le
 * coupe-circuit `OPS_ALERTS_DISABLED` de `notifyOps` s'applique comme ailleurs.
 */
export const adminLoginAlert = new Hono();

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const HEXTET = '[0-9a-f]{1,4}';

/** Les seules formes de réseau admises : jamais une adresse entière. */
const MASKED_NETWORK = new RegExp(
  `^(?:${OCTET}\\.${OCTET}\\.x\\.x|${HEXTET}:${HEXTET}::/32|inconnu)$`,
);

/** Bornes larges d'un compteur envoyé par le site : un entier positif, rien d'autre. */
const MAX_COUNT = 1_000_000;

/**
 * Écart admis entre `at` et l'horloge de l'API. Le site envoie l'alerte à
 * l'instant de la connexion, sans l'attendre, avec un délai de dix secondes au
 * plus : un quart d'heure couvre une dérive entre les horloges des deux serveurs,
 * et refuse une alerte datée d'un autre jour, qui ne dirait rien de vrai.
 */
export const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

/**
 * Durée de fermeture admise entre `at` et `until`. Le site ferme une heure au plus
 * (`GLOBAL_WINDOW_MS` de sa route de connexion) ; deux heures laissent une marge à
 * un prochain réglage sans accepter une réouverture absurde.
 */
export const MAX_CLOSURE_MS = 2 * 60 * 60 * 1000;

export type LoginAlert =
  | { event: 'login_ok'; network: string; atMs: number }
  | {
      event: 'global_cap';
      atMs: number;
      untilMs: number;
      failures: number;
      addresses: number;
    };

function instant(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function count(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_COUNT
    ? raw
    : null;
}

/**
 * Lit le corps envoyé par le site ; un champ douteux refuse tout l'envoi. `at` doit
 * tomber à `MAX_CLOCK_SKEW_MS` de `nowMs` au plus ; `until`, entre `at` et
 * `at + MAX_CLOSURE_MS`.
 */
export function parseLoginAlert(
  body: unknown,
  nowMs: number = Date.now(),
): { ok: true; alert: LoginAlert } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  const atMs = instant(b.at);
  if (atMs === null || Math.abs(atMs - nowMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: 'invalid_at' };
  }
  if (b.event === 'login_ok') {
    if (typeof b.network !== 'string' || !MASKED_NETWORK.test(b.network)) {
      return { ok: false, error: 'network_not_masked' };
    }
    return { ok: true, alert: { event: 'login_ok', network: b.network, atMs } };
  }
  if (b.event === 'global_cap') {
    const untilMs = instant(b.until);
    const failures = count(b.failures);
    const addresses = count(b.addresses);
    if (
      untilMs === null ||
      untilMs < atMs ||
      untilMs - atMs > MAX_CLOSURE_MS ||
      failures === null ||
      addresses === null
    ) {
      return { ok: false, error: 'invalid_global_cap' };
    }
    return { ok: true, alert: { event: 'global_cap', atMs, untilMs, failures, addresses } };
  }
  return { ok: false, error: 'unknown_event' };
}

/** Le texte envoyé au propriétaire, à l'heure suisse (`zurichDayTime`). */
export function loginAlertText(alert: LoginAlert): string {
  if (alert.event === 'login_ok') {
    return (
      `🔐 IBANforge — connexion au tableau de bord\n` +
      `Le ${zurichDayTime(alert.atMs)} (heure suisse), réseau ${alert.network}.\n` +
      `Si ce n'est pas vous : mot de passe à changer et sessions à couper, à demander tout de suite.`
    );
  }
  const from = alert.addresses === 1 ? 'depuis 1 adresse' : `depuis ${alert.addresses} adresses`;
  return (
    `🚨 IBANforge — plafond des connexions atteint\n` +
    `${alert.failures} mots de passe faux en moins d'une heure, ${from} ` +
    `(le ${zurichDayTime(alert.atMs)}, heure suisse).\n` +
    `Toute connexion au tableau de bord est refusée jusqu'au ${zurichDayTime(alert.untilMs)}, ` +
    `puis rouverte d'elle-même.`
  );
}

adminLoginAlert.post('/v1/admin/dashboard-login-alert', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = parseLoginAlert(body);
  // Le refus nomme le champ, jamais sa valeur : elle pourrait être une adresse.
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sent = await notifyOps(loginAlertText(parsed.alert));
  return c.json({ sent });
});
