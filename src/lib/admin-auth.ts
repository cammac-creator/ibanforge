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
 *      - les familles des scripts du serveur (audit SEC-01#2, C08 partie 2), une
 *        par métier : synchronisation du courrier, brouillons et envois
 *        programmés, prospection, relevés et bulletin, lecture seule ;
 *  - `STATS_TOKEN` (en-tête `Authorization: Bearer`) ouvre `/stats/*`.
 *
 * Une clé à portée posée à la même valeur que `ADMIN_SECRET` ou qu'une autre clé
 * à portée est IGNORÉE, comme si sa variable était absente (`scopedKeyConflicts`),
 * et le démarrage le dit par une alerte d'exploitation (`admin-auth-ops.ts`).
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

/** Une route de lecture : la seule forme admise dans la famille en lecture seule. */
export type AdminReadRoute = `GET /v1/admin/${string}`;

/**
 * La table : pour chaque clé à portée (le nom de sa variable d'environnement),
 * les routes qu'elle ouvre. Refus par défaut : ce qui n'est pas écrit ici est
 * fermé à la clé, y compris la route ajoutée demain.
 *
 * Une famille de plus est une entrée de plus : son nom, sa liste, et rien
 * d'autre à câbler. `src/routes/admin-routes-auth.test.ts` présente chaque clé
 * de cette table à chaque route montée, sans liste de noms à tenir à jour.
 *
 * Les familles des scripts du serveur (C08 partie 2, 11.11.2026) sont nommées
 * par leur métier, jamais par un script : un script prend la famille de ce qu'il
 * fait, et chaque liste est exactement l'union des routes que ses scripts
 * appellent, relevée dans leur code (méthode et gabarit, chaîne de requête
 * ignorée). Un script qui n'écrit jamais prend la lecture seule.
 */
export const SCOPED_ADMIN_KEYS = {
  BACKUP_TOKEN: [`GET ${BACKUP_ROUTE}`],
  /**
   * Synchronisation du courrier : les boîtes du serveur recopiées dans le CRM
   * (messages reçus et envoyés, résumés par correspondant, courrier sans
   * destinataire connu et son rattachement, alias et correspondants
   * institutionnels découverts en route), et les traductions des messages.
   */
  MAIL_SYNC_TOKEN: [
    'GET /v1/admin/email-aliases',
    'GET /v1/admin/email-messages',
    'GET /v1/admin/institutional-contacts',
    'GET /v1/admin/keys',
    'GET /v1/admin/orphan-mail',
    'GET /v1/admin/prospects',
    'POST /v1/admin/email-aliases',
    'POST /v1/admin/email-messages',
    'POST /v1/admin/email-summary',
    'POST /v1/admin/institutional-contacts',
    'POST /v1/admin/orphan-mail',
    'POST /v1/admin/orphan-mail/resolve',
  ],
  /**
   * Brouillons et envois programmés : ce qui prépare un message et ce qui
   * l'envoie à sa minute. Ils lisent les clés, les profils et le fil des
   * messages, écrivent un brouillon ou la trace d'un envoi, retirent le brouillon
   * parti, et notent le geste au carnet. L'envoi lui-même passe par le relais du
   * CRM, pas par l'API.
   *
   * La mesure d'une offre écrite (`outreach-test`, des nombres, jamais une
   * adresse) y entre le 11.11.2026 : sa lecture passait par le secret complet,
   * qui n'a plus à vivre à côté des programmes planifiés.
   */
  MAIL_OUTREACH_TOKEN: [
    'GET /v1/admin/activation-nudges',
    'GET /v1/admin/client-profiles',
    'GET /v1/admin/contact-notes',
    'GET /v1/admin/email-messages',
    'GET /v1/admin/institutional-contacts',
    'GET /v1/admin/keys',
    'GET /v1/admin/outreach-test',
    'POST /v1/admin/contact-notes',
    'POST /v1/admin/email-messages',
    'POST /v1/admin/email-messages/delete',
  ],
  /**
   * Prospection et enrichissement : la recherche de prospects, leur enrichissement
   * et leur réveil, avec une note au carnet quand un signal est trouvé.
   */
  PROSPECTING_TOKEN: [
    'GET /v1/admin/activation',
    'GET /v1/admin/prospects',
    'POST /v1/admin/contact-notes',
    'POST /v1/admin/prospects',
    'POST /v1/admin/prospects/update',
  ],
  /**
   * Relevés et bulletin : le relevé quotidien de la visibilité et le bulletin de
   * la semaine. Ils lisent leurs chiffres et écrivent LEUR table (le relevé, le
   * bulletin), d'où une famille à part plutôt que la lecture seule.
   */
  INDICATORS_TOKEN: [
    'GET /v1/admin/digest',
    'GET /v1/admin/visibility',
    'GET /v1/admin/weekly-facts',
    'POST /v1/admin/digest',
    'POST /v1/admin/visibility',
  ],
  /**
   * Lecture seule, pour les rapports et les sondes qui n'écrivent jamais rien :
   * des `GET` et rien d'autre, tenu par le type et par un balayage de toutes les
   * écritures d'administration (`admin-routes-auth.test.ts`).
   */
  ADMIN_READ_TOKEN: [
    'GET /v1/admin/failed-payments',
    'GET /v1/admin/keys',
    'GET /v1/admin/prospects',
  ] as const satisfies readonly AdminReadRoute[],
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

/** Une clé à portée ignorée, et pourquoi : jamais sa valeur, seulement des noms. */
export interface ScopedKeyConflict {
  /** La variable ignorée. */
  name: ScopedAdminKey;
  /** Les variables qui portent la même valeur (`ADMIN_SECRET` en tête s'il en est). */
  sameValueAs: string[];
}

/**
 * Les clés à portée posées à la même valeur que `ADMIN_SECRET` ou qu'une autre
 * clé à portée (réserve de la relecture de la partie 1). Une erreur de
 * copier-coller pendant la bascule ne doit pas passer en silence :
 *
 *  - recopiée du secret complet, la clé donnerait tout à un script qui se croit
 *    limité ;
 *  - recopiée d'une autre clé, elle ouvrirait l'union des deux listes.
 *
 * Chaque clé en cause est IGNORÉE (les deux, quand deux clés à portée se
 * recopient : on ne sait pas laquelle est la bonne), comme si sa variable était
 * absente, et `reportScopedKeyConflicts` (`admin-auth-ops.ts`) lève une alerte au
 * démarrage. Les valeurs sont comparées sans les espaces de bord : un retour à la
 * ligne collé avec la valeur est l'erreur de copier-coller typique.
 *
 * ⚠️ Ignorer une clé recopiée du secret complet ne retire rien à son porteur :
 * sa valeur EST le secret complet, qui ouvre tout par sa propre porte. Ce cas,
 * c'est l'alerte qui le rend visible.
 */
export function scopedKeyConflicts(): ScopedKeyConflict[] {
  const values = new Map<string, string>();
  const admin = configured('ADMIN_SECRET');
  if (admin) values.set('ADMIN_SECRET', admin.trim());
  for (const name of SCOPED_KEY_NAMES) {
    const value = configured(name);
    if (value) values.set(name, value.trim());
  }
  const conflicts: ScopedKeyConflict[] = [];
  for (const name of SCOPED_KEY_NAMES) {
    const mine = values.get(name);
    if (mine === undefined) continue;
    const sameValueAs = [...values].filter(([other, v]) => other !== name && v === mine);
    if (sameValueAs.length > 0) conflicts.push({ name, sameValueAs: sameValueAs.map(([n]) => n) });
  }
  return conflicts;
}

/** La valeur d'une clé à portée, ou rien quand elle est absente, vide ou en conflit. */
function configuredScoped(name: ScopedAdminKey, ignored: ReadonlySet<string>): string | undefined {
  return ignored.has(name) ? undefined : configured(name);
}

/**
 * Comparaison à temps constant. Faux si l'attendu ou le présenté est absent ou
 * vide : une variable non posée, ou posée vide, ne s'ouvre jamais par défaut.
 * À longueurs différentes, une comparaison factice garde le même coût, pour que
 * la durée de la réponse ne dise pas la longueur du secret.
 *
 * Exportée pour le limiteur de débit (`src/middleware/rate-limit.ts`), qui
 * compare les clés serveur du site de la même façon : une seule comparaison de
 * secrets dans l'API, pas deux copies qui pourraient diverger.
 */
export function secretMatches(expected: string | undefined, provided: string | undefined): boolean {
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
 * pas laquelle a réussi. Une clé à portée qui recopie la valeur du secret
 * complet ou d'une autre clé est ignorée (`scopedKeyConflicts`) : une valeur
 * posée pour deux clés à portée n'ouvre donc rien par elles (401), au lieu de
 * l'union de leurs listes. Lue à chaque appel, comme le reste de la porte : la
 * variable change au redémarrage, et la décision avec elle.
 */
export type AdminDecision = 'full' | 'scoped' | 'out_of_scope' | 'none';

/**
 * Le nom de ce qui a été reconnu dans l'en-tête : `full` pour le secret complet,
 * le nom de la variable d'une clé à portée, jamais une valeur ni son empreinte.
 */
export type AdminKeyName = 'full' | ScopedAdminKey;

/** La décision, et le nom de la clé reconnue (`null` quand rien ne l'est). */
export interface AdminVerdict {
  decision: AdminDecision;
  key: AdminKeyName | null;
}

/**
 * `adminDecision`, avec le nom de la clé reconnue : ce que le journal des entrées
 * d'administration écrit (C10, SEC-01#3). Mêmes comparaisons, faites toutes à
 * chaque appel. Deux clés à portée ne portent jamais la même valeur (une valeur
 * recopiée est ignorée, `scopedKeyConflicts`) : au plus une est reconnue.
 */
export function adminVerdict(
  provided: string | undefined,
  method: string,
  routePattern: string,
): AdminVerdict {
  const full = isAdminAuthorized(provided);
  const ignored = new Set<string>(scopedKeyConflicts().map((c) => c.name));
  const keys = SCOPED_KEY_NAMES.filter((name) =>
    secretMatches(configuredScoped(name, ignored), provided),
  );
  if (full) return { decision: 'full', key: 'full' };
  if (keys.length === 0) return { decision: 'none', key: null };
  const route = `${method} ${routePattern}`;
  const opener = keys.find((name) =>
    (SCOPED_ADMIN_KEYS[name] as readonly string[]).includes(route),
  );
  return opener
    ? { decision: 'scoped', key: opener }
    : { decision: 'out_of_scope', key: keys[0] ?? null };
}

export function adminDecision(
  provided: string | undefined,
  method: string,
  routePattern: string,
): AdminDecision {
  return adminVerdict(provided, method, routePattern).decision;
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
 * Un passage à la porte, tel que le journal le reçoit : la route sous sa forme
 * de gabarit (jamais l'adresse demandée, qui peut porter un identifiant ou une
 * adresse dans sa chaîne de requête), la décision, le nom de la clé reconnue, et
 * si un en-tête a été présenté. Jamais la valeur présentée.
 */
export interface AdminGateCall {
  method: string;
  route: string;
  decision: AdminDecision;
  key: AdminKeyName | null;
  presented: boolean;
}

/** Ce qui reçoit chaque passage : le journal (`src/lib/admin-journal.ts`). */
export type AdminCallSink = (c: Context, call: AdminGateCall) => void;

let callSink: AdminCallSink | null = null;

/**
 * Branche le journal des entrées d'administration (C10, SEC-01#3) sur la porte.
 * Par un crochet plutôt que par un import : ce module n'importe aucun fichier de
 * l'API (son en-tête, ARCH-02), alors que le journal écrit dans la base. Le
 * journal s'y branche lui-même, au chargement des routes (`src/routes/api-keys.ts`).
 * `null` le débranche (tests).
 */
export function setAdminCallSink(sink: AdminCallSink | null): void {
  callSink = sink;
}

/** La clé qui a ouvert la requête en cours, posée par `authorizeAdmin`. */
const openedBy = new WeakMap<Context, AdminKeyName>();

/**
 * Le nom de la clé qui a ouvert cette requête (`full` ou une clé à portée), lu
 * par une route qui borne ce qu'une clé à portée peut y faire (C10, section 5 :
 * la clé du site). `undefined` avant `authorizeAdmin`, ou quand elle a refusé.
 */
export function adminKeyOf(c: Context): AdminKeyName | undefined {
  return openedBy.get(c);
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
 *
 * Chaque passage, accepté ou refusé, est remis au journal (`setAdminCallSink`).
 * Le journal ne fait jamais échouer la porte : une erreur du journal est écrite
 * en console, et la décision reste celle de la table.
 */
export function authorizeAdmin(c: Context): boolean {
  const route = runningRoute(c);
  const provided = c.req.header('X-Admin-Secret');
  const { decision, key } = adminVerdict(provided, route?.method ?? '', route?.path ?? '');
  if ((decision === 'full' || decision === 'scoped') && key) openedBy.set(c, key);
  if (callSink) {
    try {
      callSink(c, {
        method: route?.method ?? c.req.method,
        route: route?.path ?? '',
        decision,
        key,
        presented: provided !== undefined && provided !== '',
      });
    } catch (err) {
      console.error(
        '[admin-auth] journal des entrées en échec :',
        err instanceof Error ? err.message : err,
      );
    }
  }
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
