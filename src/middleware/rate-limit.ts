import type { MiddlewareHandler } from 'hono';
import {
  isAdminAuthorizedFor,
  isStatsAuthorized,
  respondingRoute,
  secretMatches,
} from '../lib/admin-auth.js';
import { extractClientIp } from '../lib/stats.js';

// Guarded like facilitatorTimeoutMs() in x402.ts, and for the same reason: a
// Railway variable set to a non-number (or to an EMPTY string, which `??`
// does not catch) must not silently turn the only per-IP flood control into
// `count > NaN` — always false, limiter inert, headers reading "NaN".
// Exported for /.well-known/rate-limits.yml (src/routes/artifacts.ts): the
// published contract must interpolate the SAME guarded value the middleware
// enforces, not re-parse the env var and risk publishing "NaN".
export const RATE_LIMIT = ((): number => {
  const raw = process.env.RATE_LIMIT_PER_MIN;
  if (raw === undefined || raw === '') return 100;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[rate-limit] RATE_LIMIT_PER_MIN=${raw} is not a positive number. Using 100.`);
    return 100;
  }
  return Math.floor(parsed);
})();
const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

interface Window {
  count: number;
  resetAt: number; // unix ms
}

const store = new Map<string, Window>();

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, window] of store) {
    if (now >= window.resetAt) {
      store.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

// Use the shared, spoof-resistant extractor (trusted-proxy last hop / x-real-ip)
// so an attacker can't rotate the rate-limit key via a forged X-Forwarded-For.
function getClientIp(req: Request): string {
  return (
    extractClientIp({
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
      'x-real-ip': req.headers.get('x-real-ip'),
    }) ?? 'unknown'
  );
}

/**
 * 11.11.2026 — les clés serveur du site ne sont plus comptées par adresse
 * (audit du 10.11.2026, WEB-05).
 *
 * Le playground du site et ses pages de registre (AT, BE, SM) appellent l'API
 * depuis le serveur du site, avec une clé qui ne quitte jamais ce serveur. Vus
 * d'ici, tous ces appels viennent de la même adresse : celle du serveur. Un seul
 * robot qui parcourait les pages de registre remplissait donc le seau de cette
 * adresse, et l'API répondait 429 au playground et aux pages de tous les
 * visiteurs à la fois.
 *
 * Un appel qui porte l'une de ces clés passe ce limiteur. Ce qui borne alors
 * le débit du site vers l'API, et rien d'autre :
 *
 *  - le playground du site : 30 appels par dix minutes et par adresse de
 *    visiteur, compteur en mémoire du serveur du site
 *    (`frontend/app/api/playground/route.ts`), derrière un contrôle d'origine
 *    qu'un client hors navigateur écrit à sa guise ; beaucoup d'adresses, c'est
 *    beaucoup d'appels ;
 *  - les pages de registre : le cache de données de Next, qui garde la réponse
 *    d'un code un jour, donc au plus un appel par code et par jour ; leur
 *    plafond par visiteur était une règle du pare-feu de Vercel, sans
 *    équivalent depuis le départ du site de Vercel ;
 *  - le relais `/internal/playground` de l'API : 30 appels par heure et par
 *    visiteur ;
 *  - côté API, la limite mensuelle ou les crédits inscrits sur la clé elle-même,
 *    comptés plus loin par le middleware des clés : ce n'est un plafond que si
 *    la clé en porte un.
 *
 * Aucun plafond global ne s'ajoute (plafond journalier du playground, WEB-05#2 :
 * décision du propriétaire). La clé est reconnue à sa valeur, posée dans
 * l'environnement de l'API sous le même nom que sur le site :
 * `PLAYGROUND_API_KEY` (déjà lue par le relais `/internal/playground`, dont le
 * second passage devient exempté lui aussi ; l'appel du visiteur reste compté
 * et son plafond horaire tient) et `REGISTER_PAGES_API_KEY` quand le site en
 * pose une distincte. Sans ces variables, rien ne change.
 *
 * Seuls les deux en-têtes comptent, dans l'ordre où `extractKey` choisit la clé
 * facturée (`Authorization: Bearer ifk_…`, puis `X-API-Key`) : l'exemption
 * porte toujours sur la clé qui paiera l'appel. Une clé passée dans l'adresse
 * (`?api_key=`) reste comptée par adresse. La comparaison se fait en temps
 * constant sur les valeurs elles-mêmes (`secretMatches`, `src/lib/admin-auth.ts`).
 */
const SITE_SERVER_KEY_VARS = ['PLAYGROUND_API_KEY', 'REGISTER_PAGES_API_KEY'] as const;

/**
 * Les seules routes où la clé du site passe le limiteur : celles, facturées,
 * que le site appelle réellement avec elle, écrites comme Hono les enregistre
 * (méthode, puis gabarit de la route qui répond). Relevées dans `frontend/` :
 *
 *  - `app/api/playground/route.ts` (playground et démo de l'accueil) : les
 *    quatre ;
 *  - `lib/register-live.ts` (pages des codes AT, BE et SM) : la validation ;
 *  - le relais `/internal/playground` de l'API (`src/routes/playground.ts`) :
 *    validation, conformité et BIC.
 *
 * Partout ailleurs, la même clé est un appel ordinaire, compté par adresse.
 * Jamais sous `/v1/admin/` ni `/stats/` : un mauvais secret ou un mauvais jeton
 * y reste compté même accompagné de la clé du site, sans quoi l'essai en force
 * contre ces portes ne serait plus limité. Une route ajoutée au site avec cette
 * clé s'ajoute ici, à la main.
 */
const SITE_SERVER_KEY_ROUTES: readonly string[] = [
  'POST /v1/iban/validate',
  'POST /v1/iban/compliance',
  'GET /v1/bic/:code',
  'GET /v1/ch/clearing/:iid',
];

function siteServerKeyExempt(c: Parameters<MiddlewareHandler>[0], path: string): boolean {
  if (path === '/v1/admin' || path.startsWith('/v1/admin/')) return false;
  if (path === '/stats' || path.startsWith('/stats/')) return false;
  const route = respondingRoute(c);
  if (!route || !SITE_SERVER_KEY_ROUTES.includes(`${route.method} ${route.path}`)) return false;
  return isSiteServerKey(c);
}

function presentedKey(c: Parameters<MiddlewareHandler>[0]): string | null {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ifk_')) return auth.slice(7);
  const xKey = c.req.header('X-API-Key');
  if (xKey?.startsWith('ifk_')) return xKey;
  return null;
}

function isSiteServerKey(c: Parameters<MiddlewareHandler>[0]): boolean {
  const configured = SITE_SERVER_KEY_VARS.map((name) => process.env[name]).filter(
    (value): value is string => !!value,
  );
  if (configured.length === 0) return false;
  const key = presentedKey(c);
  if (!key) return false;
  // Chaque clé posée est comparée, même après une égalité. La comparaison est
  // celle des secrets d'administration (`secretMatches`) : tampons UTF-8 bruts,
  // sans hachage, au même coût quelle que soit la longueur présentée.
  return configured.map((value) => secretMatches(value, key)).some(Boolean);
}

/**
 * In-memory rate limiter middleware.
 *
 * - Default: 100 req/min per IP (configurable via RATE_LIMIT_PER_MIN)
 * - Adds both header spellings: the legacy X-RateLimit-Limit/-Remaining/-Reset
 *   (Reset = unix timestamp) and the IETF RateLimit-Limit/-Remaining/-Reset
 *   (Reset = delta-seconds), so standard-aware scorers and existing clients
 *   both find what they look for
 * - Returns 429 when limit exceeded
 * - Exempt paths: /health, /openapi.json, /ping, /stats, /v1/demo
 * - Exempt callers: a valid admin or stats secret; the site's server keys
 *   (`PLAYGROUND_API_KEY`, `REGISTER_PAGES_API_KEY`) on the routes of
 *   `SITE_SERVER_KEY_ROUTES` only, never under /v1/admin/ or /stats/
 */
export function rateLimitMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;

    // Exempt free/monitoring routes from rate limiting
    if (
      path === '/health' ||
      path === '/openapi.json' ||
      path === '/ping' ||
      path === '/stats' ||
      path === '/v1/demo'
    ) {
      await next();
      return;
    }

    // Stripe webhooks come from Stripe's IP pool and can burst on retries.
    // The webhook handler itself verifies the signature, so rate-limiting by
    // IP gives us no security and risks dropping legitimate events.
    if (path === '/v1/stripe/webhook') {
      await next();
      return;
    }

    /*
     * 🚨 11.09.2026 — les lectures privées du tableau de bord portent déjà leur
     * secret, et les limiter par IP ne protégeait rien tout en cassant l'écran
     * de son propriétaire.
     *
     * Un seul affichage du tableau de bord tire une quinzaine d'appels privés.
     * Trois affichages dans la même minute dépassaient donc le plafond de 100,
     * et les appels suivants repartaient en 429. Côté navigateur, tous les blocs
     * privés disparaissaient d'un coup, remplacés par « indisponible » — et
     * l'API n'en gardait AUCUNE trace, parce que ce 429 part d'ici, avant que la
     * route ait pu journaliser quoi que ce soit. On a cherché la panne pendant
     * une demi-journée du mauvais côté.
     *
     * L'exemption est conditionnée au secret VALIDE, jamais au chemin seul : un
     * appelant sans secret, ou avec un mauvais, reste limité comme avant, donc
     * la protection contre l'essai en force est intacte.
     *
     * 10.11.2026 — chaque clé à portée (`BACKUP_TOKEN`, `SITE_ADMIN_TOKEN`, la
     * table de `src/lib/admin-auth.ts`) garde la même exemption, mais sur les
     * routes de SA liste seulement : sur n'importe quelle autre route
     * d'administration, son porteur est un appelant sans secret, limité comme
     * les autres. La route est celle qui va répondre (méthode et gabarit
     * enregistrés), la même que lit la porte de la route ; le secret complet
     * reste exempté sur tout `/v1/admin/`, même sans route qui réponde.
     */
    if (path.startsWith('/v1/admin/')) {
      const route = respondingRoute(c);
      if (
        isAdminAuthorizedFor(c.req.header('X-Admin-Secret'), route?.method ?? '', route?.path ?? '')
      ) {
        await next();
        return;
      }
    }
    if (path.startsWith('/stats/') && isStatsAuthorized(c.req.header('Authorization'))) {
      await next();
      return;
    }
    if (siteServerKeyExempt(c, path)) {
      await next();
      return;
    }

    const ip = getClientIp(c.req.raw);
    const now = Date.now();

    let win = store.get(ip);
    if (!win || now >= win.resetAt) {
      win = { count: 0, resetAt: now + WINDOW_MS };
      store.set(ip, win);
    }

    win.count += 1;
    const remaining = Math.max(0, RATE_LIMIT - win.count);
    const resetSec = Math.ceil(win.resetAt / 1000);
    const resetDelta = Math.max(1, Math.ceil((win.resetAt - now) / 1000));

    // Legacy triple, kept because existing clients read it. X-RateLimit-Reset
    // is a unix timestamp here, which is why the IETF header below is NOT an
    // alias: the standard spells Reset as delta-seconds.
    c.header('X-RateLimit-Limit', String(RATE_LIMIT));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSec));

    // IETF draft-ietf-httpapi-ratelimit-headers spelling. Emitted alongside the
    // legacy names because automated agent-readiness scorers look for the
    // standard field names: the 2026-07-28 channel audit found api-evangelist
    // reporting `rate_limit_signal: false` while the server was already sending
    // the X-prefixed triple on every limited route.
    c.header('RateLimit-Limit', String(RATE_LIMIT));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetDelta));

    if (win.count > RATE_LIMIT) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: 'rate_limit_exceeded',
          message: `Too many requests. Please retry after ${retryAfter} seconds.`,
          retry_after: retryAfter,
        },
        429,
      );
    }

    await next();
  };
}
