/**
 * Les portes d'administration de l'API : qui a le droit d'entrer, et par où.
 *
 * Sorti de `src/routes/api-keys.ts` et de `src/routes/stats.ts` le 10.11.2026
 * (audit d'architecture, ARCH-02) : le limiteur de débit, le paywall et une
 * vingtaine de fichiers de routes importaient un fichier de ROUTES de trois mille
 * lignes pour une seule fonction, et entraient avec lui dans un cycle d'imports.
 * Ce module n'importe que `node:crypto` et deux petits modules de Hono (l'erreur
 * HTTP et la lecture de la route qui répond), jamais un autre fichier de l'API :
 * tout le monde peut l'importer sans tirer le reste de l'API.
 *
 * Les portes, et leur rayon d'explosion :
 *
 *  - `ADMIN_SECRET` (en-tête `X-Admin-Secret`) ouvre TOUTES les routes
 *    `/v1/admin/*` : créer des clés, créditer, lire le registre des clients ;
 *  - les CLÉS À PORTÉE (même en-tête), une par famille de consommateurs, n'ouvrent
 *    que les routes de leur liste dans `SCOPED_ADMIN_KEYS`. Si l'une fuit, on peut
 *    faire ce que fait son consommateur, et rien d'autre :
 *      - `BACKUP_TOKEN` (audit OPS-24, C07) : `GET /v1/admin/backup`, pour le
 *        script de sauvegarde nocturne du serveur ;
 *      - `SITE_ADMIN_TOKEN` (audit WEB-02#1, C08) : ce que le site appelle, et
 *        rien de ce qu'il n'appelle pas (création ou import de clés, révocation
 *        de compte, sauvegarde…) ;
 *  - `STATS_TOKEN` (en-tête `Authorization: Bearer`) ouvre `/stats/*`.
 *
 * UNE façon d'appliquer la table, dans chaque route d'administration :
 * `authorizeAdmin(c)`. Elle lit la route QUI RÉPOND (méthode et gabarit tels que
 * Hono les a enregistrés, `/v1/admin/forum-threads/:id`), jamais l'adresse
 * demandée : une route absente de la table refuse donc toute clé à portée, sans
 * que l'auteur d'une route ajoutée demain ait à y penser. Une clé reconnue hors
 * de sa liste reçoit 403 (elle n'a pas le droit) ; un secret inconnu, la réponse
 * 401 de la route, comme avant. `src/routes/admin-routes-auth.test.ts` présente
 * chaque clé à portée à CHAQUE route montée.
 *
 * 🚨 Ne jamais faire accepter une clé à portée par `isAdminAuthorized` : cette
 * seule ligne ouvrirait toutes les routes d'administration à cette clé.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { matchedRoutes } from 'hono/route';

/** La seule route que `BACKUP_TOKEN` ouvre. */
export const BACKUP_ROUTE = '/v1/admin/backup';

/** Une route d'administration, écrite comme Hono l'enregistre : la méthode, puis le gabarit. */
export type AdminRoute = `${'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'} /v1/admin/${string}`;

/**
 * La table : pour chaque clé à portée (le nom de sa variable d'environnement),
 * les routes qu'elle ouvre. Refus par défaut : ce qui n'est pas écrit ici est
 * fermé à la clé, y compris la route ajoutée demain.
 *
 * Une famille de plus (synchronisation du courrier, envois programmés, lecture
 * seule…) est une entrée de plus : son nom, sa liste, et rien d'autre à câbler.
 */
export const SCOPED_ADMIN_KEYS = {
  BACKUP_TOKEN: [`GET ${BACKUP_ROUTE}`],
  /**
   * Exactement les routes que le site appelle, tirées de son code et tenues par
   * `src/lib/admin-auth.site.test.ts`, qui échoue si le site appelle une route
   * absente d'ici, ou si une route d'ici n'est plus appelée par le site. Le site
   * envoie cette clé par `frontend/lib/admin-key.ts`, seul lecteur.
   */
  SITE_ADMIN_TOKEN: [
    // Lectures du tableau de bord (vue d'ensemble, indicateurs, portes, bulletin).
    'GET /v1/admin/activation',
    'GET /v1/admin/audit-stats',
    'GET /v1/admin/bulletin',
    'GET /v1/admin/business-accounts',
    'GET /v1/admin/business-pulse',
    'GET /v1/admin/demand-gaps',
    'GET /v1/admin/digest',
    'GET /v1/admin/doors',
    'GET /v1/admin/failed-payments',
    'GET /v1/admin/feedback',
    'GET /v1/admin/funnel',
    'GET /v1/admin/orphan-mail',
    'GET /v1/admin/pack-sales',
    'GET /v1/admin/search-console',
    'GET /v1/admin/signup-sources',
    'GET /v1/admin/stripe-revenue',
    'GET /v1/admin/web-events',
    // Lectures du CRM (contacts, dossiers, rédaction d'un brouillon, recherche).
    'GET /v1/admin/bot-profiles',
    'GET /v1/admin/client-activity',
    'GET /v1/admin/client-hours',
    'GET /v1/admin/client-profiles',
    'GET /v1/admin/company-profiles',
    'GET /v1/admin/contact-notes',
    'GET /v1/admin/email-aliases',
    'GET /v1/admin/email-messages',
    'GET /v1/admin/forum-marketplaces',
    'GET /v1/admin/forum-threads',
    'GET /v1/admin/institutional-contacts',
    'GET /v1/admin/keys',
    'GET /v1/admin/no-reply-senders',
    'GET /v1/admin/prospects',
    'GET /v1/admin/thread-reads',
    'GET /v1/admin/thread-summary',
    // Écritures du CRM et du tableau de bord : notes, carnet, forums, file des
    // orphelins, statuts, réponses au bulletin.
    'DELETE /v1/admin/contact-notes',
    'PATCH /v1/admin/forum-marketplaces/:slug',
    'PATCH /v1/admin/forum-threads/:id',
    'POST /v1/admin/bulletin/answers',
    'POST /v1/admin/contact-notes',
    // L'alerte de connexion au tableau de bord (lot C11), envoyée par le bot de l'API.
    'POST /v1/admin/dashboard-login-alert',
    'POST /v1/admin/email-aliases',
    'POST /v1/admin/email-aliases/delete',
    'POST /v1/admin/email-messages/no-reply',
    'POST /v1/admin/feedback/status',
    'POST /v1/admin/forum-scan',
    'POST /v1/admin/forum-threads',
    'POST /v1/admin/institutional-contacts',
    'POST /v1/admin/institutional-contacts/delete',
    'POST /v1/admin/no-reply-senders',
    'POST /v1/admin/orphan-mail/gist',
    'POST /v1/admin/orphan-mail/reopen',
    'POST /v1/admin/orphan-mail/resolve',
    'POST /v1/admin/orphan-mail/translation',
    'POST /v1/admin/prospects/update',
    'POST /v1/admin/thread-read',
    'POST /v1/admin/thread-summary',
    // ⚠️ Deux écritures qui valent plus qu'une note, gardées parce que le site
    // s'en sert (décision attendue, voir la PR du lot C08) :
    //  - écrire des messages, brouillons compris (le CRM enregistre l'envoi et
    //    les brouillons) : un brouillon posé ici peut être envoyé par un envoi
    //    programmé du serveur ;
    //  - relever le plafond mensuel d'une clé client (bouton du CRM, borné par la
    //    route).
    'POST /v1/admin/email-messages',
    'POST /v1/admin/email-messages/delete',
    'POST /v1/admin/keys/raise-limit',
  ],
} as const satisfies Record<string, readonly AdminRoute[]>;

export type ScopedAdminKey = keyof typeof SCOPED_ADMIN_KEYS;
const SCOPED_KEY_NAMES = Object.keys(SCOPED_ADMIN_KEYS) as ScopedAdminKey[];

/** La valeur d'une variable, ou rien quand elle est absente, vide ou faite d'espaces. */
function configured(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

/**
 * Comparaison à temps constant. Faux si l'attendu ou le présenté est absent ou
 * vide : une variable non posée, ou posée vide, ne s'ouvre jamais par défaut.
 * À longueurs différentes, une comparaison factice garde le même coût, pour que
 * la durée de la réponse ne dise pas la longueur du secret.
 */
function secretMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Le secret d'administration complet, `ADMIN_SECRET`. Vrai seulement s'il est
 * posé (ni vide, ni fait d'espaces) ET que l'en-tête présenté lui est identique.
 */
export function isAdminAuthorized(provided: string | undefined): boolean {
  return secretMatches(configured('ADMIN_SECRET'), provided);
}

/**
 * Ce que vaut l'en-tête présenté devant une route :
 *  - `full` : le secret complet ;
 *  - `scoped` : une clé à portée dont la liste contient cette route ;
 *  - `out_of_scope` : une clé à portée reconnue, mais pas pour cette route (403) ;
 *  - `none` : rien de reconnu (401).
 *
 * Toutes les comparaisons sont faites à chaque appel, pour que la durée ne dise
 * pas laquelle a réussi. Une valeur posée pour deux clés ouvre l'union de leurs
 * listes ; une clé à portée posée à la valeur du secret complet ouvre tout, comme
 * le secret qu'elle recopie (d'où la consigne de ne jamais réutiliser sa valeur).
 */
export type AdminDecision = 'full' | 'scoped' | 'out_of_scope' | 'none';

export function adminDecision(
  provided: string | undefined,
  method: string,
  routePattern: string,
): AdminDecision {
  const full = isAdminAuthorized(provided);
  const keys = SCOPED_KEY_NAMES.filter((name) => secretMatches(configured(name), provided));
  if (full) return 'full';
  if (keys.length === 0) return 'none';
  const route = `${method} ${routePattern}`;
  const allowed = keys.some((name) =>
    (SCOPED_ADMIN_KEYS[name] as readonly string[]).includes(route),
  );
  return allowed ? 'scoped' : 'out_of_scope';
}

/** Vrai quand l'en-tête ouvre cette route : le secret complet, ou une clé dont la liste la contient. */
export function isAdminAuthorizedFor(
  provided: string | undefined,
  method: string,
  routePattern: string,
): boolean {
  const decision = adminDecision(provided, method, routePattern);
  return decision === 'full' || decision === 'scoped';
}

/** La porte de `GET /v1/admin/backup` : le secret complet, ou `BACKUP_TOKEN`. */
export function isBackupAuthorized(provided: string | undefined): boolean {
  return isAdminAuthorizedFor(provided, 'GET', BACKUP_ROUTE);
}

/** Une route telle que Hono l'a enregistrée. */
export interface RegisteredRoute {
  method: string;
  path: string;
}

/** La route dont le gestionnaire s'exécute en ce moment (lu DANS ce gestionnaire). */
function runningRoute(c: Context): RegisteredRoute | undefined {
  const route = matchedRoutes(c)[c.req.routeIndex];
  return route ? { method: route.method, path: route.path } : undefined;
}

/**
 * La route qui va répondre, lue depuis un intergiciel : la première route
 * correspondante qui n'en est pas un (méthode `ALL`). Le routeur a déjà tout
 * apparié avant le premier intergiciel. Une requête HEAD est servie par la route
 * GET, et c'est bien GET qu'on lit.
 */
export function respondingRoute(c: Context): RegisteredRoute | undefined {
  const route = matchedRoutes(c).find((r) => r.method !== 'ALL');
  return route ? { method: route.method, path: route.path } : undefined;
}

/**
 * LA porte des routes d'administration, première ligne de chacune :
 *
 * ```ts
 * if (!authorizeAdmin(c)) return c.json({ error: 'unauthorized' }, 401);
 * ```
 *
 * Vrai pour le secret complet, ou pour une clé à portée dont la liste contient
 * la route qui s'exécute. Faux quand rien n'est reconnu : la route répond son
 * 401 habituel. Une clé à portée reconnue HORS de sa liste lève un 403 (Hono
 * rend la réponse de l'exception) : le refus ne dépend pas de ce que la route
 * aurait répondu, et ne s'exécute rien d'autre de la route.
 */
export function authorizeAdmin(c: Context): boolean {
  const route = runningRoute(c);
  const decision = adminDecision(
    c.req.header('X-Admin-Secret'),
    route?.method ?? '',
    route?.path ?? '',
  );
  if (decision === 'out_of_scope') {
    throw new HTTPException(403, {
      res: Response.json(
        { error: 'forbidden', message: 'This admin key is not allowed on this route.' },
        { status: 403 },
      ),
    });
  }
  return decision === 'full' || decision === 'scoped';
}

/**
 * Le jeton des statistiques, `STATS_TOKEN`, présenté en `Authorization: Bearer`.
 * Non posé : les routes `/stats/*` refusent tout.
 *
 * À temps constant, comme les autres : un `===` s'arrête au premier octet
 * différent et dit la longueur du jeton, et `/stats` est exempté du limiteur.
 */
export function isStatsAuthorized(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  return secretMatches(`Bearer ${token}`, authHeader);
}
