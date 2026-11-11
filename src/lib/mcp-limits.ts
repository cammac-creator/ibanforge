/**
 * Accès MCP sans clé, par source : une unité par appel d'outil, une par IBAN
 * dans un lot. Ces constantes restent indépendantes du serveur pour éviter un
 * cycle d'initialisation lorsque les textes de découverte les importent.
 *
 * 🚨 Depuis le 24/09/2026 (décision de Claude-Alain, DECISIONS.md, entrée de
 * 22 h 05, point 2), l'allocation se compte à la SEMAINE ISO en UTC, comme
 * l'essai REST sans clé : 25 unités par source et par semaine, remise à zéro le
 * lundi 00:00 UTC (`trialWeekStart`, src/lib/trial.ts). Elle était de 10 par
 * jour. Deux allocations SÉPARÉES de même taille : l'essai REST (POST
 * /v1/iban/validate) et l'accès MCP ne se partagent pas, leurs seaux sont
 * distincts dans `trial_weekly` (`rest:<h>` et `<h>`).
 *
 * Le nom a changé avec l'unité, exprès : `MCP_DAILY_LIMIT` aurait porté un
 * chiffre de la semaine sous un nom du jour, et chaque usage oublié aurait
 * continué de compiler.
 */
export const MCP_WEEKLY_LIMIT = 25;

/**
 * Une session réserve un serveur ; son plafond est distinct des appels et reste
 * QUOTIDIEN : il borne la mémoire du conteneur, pas une offre gratuite.
 *
 * Depuis le 08.10.2026, il ne vaut que pour les ouvertures SANS clé valide (ou
 * avec une clé inconnue ou révoquée) : voir `MCP_SESSIONS_PER_KEY_DAY`.
 */
export const MCP_SESSIONS_PER_IP_DAY = 30;

/**
 * Une session ouverte avec une clé VALIDE n'est plus comptée sur l'adresse, ni
 * refusée (08.10.2026) : comme sur l'API REST, qui n'a pas de plafond de
 * sessions, c'est le quota de la clé qui gouverne ses appels. Les connecteurs
 * Claude sortent tous des adresses d'Anthropic : comptées par adresse, les
 * ouvertures de tous leurs clients se partageaient le même plafond, et un
 * client muni d'une clé pouvait être refusé à cause des autres.
 *
 * Ce qui borne la mémoire à la place : au plus ce nombre de sessions VIVANTES
 * par clé dans le magasin. Une ouverture de plus ferme d'abord la session la
 * moins récemment servie de LA MÊME clé, jamais celle d'un autre client ; le
 * client qui y revient reçoit le 404 « send initialize again », que tout client
 * MCP sait traiter.
 *
 * 🚨 Ce n'est pas une offre, c'est une borne d'empreinte. Sans elle, une clé
 * sans e-mail (un seul POST, sans corps) rouvrait SEC-01 : des sessions sans
 * limite, et l'éviction LRU du magasin jetait celles de tous les autres
 * clients. Un nombre de sessions vivantes, pas d'ouvertures par jour : ce qui
 * coûte, c'est l'empreinte, et un client qui ouvre une session par conversation
 * ne doit jamais rencontrer de refus.
 */
export const MCP_LIVE_SESSIONS_PER_KEY = 30;

/**
 * Le nombre de sessions MCP vivantes que le magasin tient, par défaut
 * (SEC-04#1, audit du 10.11.2026) : 300, le plafond d'avant, INCHANGÉ.
 *
 * Deux mesures du poids d'une session, qui ne disent pas la même chose :
 *  - 01.09.2026, audit de sécurité SEC-01 / MCP-08 : 2,77 Mo de tas par
 *    session, mesurés après deux ramasse-miettes forcés ; 300 ouvertures sans
 *    clé d'une seule adresse avaient retenu 812 Mo. C'est ce chiffre qui faisait
 *    de 300 un plafond dangereux ;
 *  - 11.11.2026, remesure locale (Node 22, SDK MCP 1.32.2, celui du lockfile) :
 *    environ 0,19 Mio par session après `initialize`, 0,21 Mio après
 *    `initialize`, `notifications/initialized` et `tools/list` ; ramasse-miettes
 *    forcé deux fois (`--expose-gc` posé à l'exécution), sessions ouvertes par
 *    le vrai gestionnaire `POST /mcp`, écart de `heapUsed` divisé par le nombre
 *    de sessions. Une garde, et non une mesure reproductible :
 *    src/routes/mcp-http.session-weight.test.ts n'affirme qu'un plafond (le
 *    poids de septembre) et échoue si une session le dépasse.
 *    À ce poids, 300 sessions font environ 60 Mio. La production n'a pas été
 *    remesurée.
 * La seconde mesure retire sa raison à une baisse : la capacité ne change pas.
 * Elle reste réglable sans nouvelle livraison (`MCP_MAX_SESSIONS_ENV`), pour le
 * jour où une mesure en production dirait autre chose.
 */
export const MCP_MAX_SESSIONS_DEFAULT = 300;

/** La variable d'environnement facultative qui règle ce plafond. */
export const MCP_MAX_SESSIONS_ENV = 'MCP_MAX_SESSIONS';

/**
 * Les bornes d'une valeur acceptée : assez pour que chaque classe garde une
 * part (voir `mcpSessionShares`), et au plus le triple du défaut (environ
 * 200 Mio au poids de novembre, 2,7 Go à celui de septembre).
 */
export const MCP_MAX_SESSIONS_MIN = 30;
export const MCP_MAX_SESSIONS_MAX = 1000;

/**
 * Le plafond lu dans l'environnement. Absente, ou mal tapée (pas un entier
 * strictement positif écrit en chiffres, ou hors des bornes) : le défaut, et
 * jamais une erreur au démarrage.
 */
export function mcpMaxSessionsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[MCP_MAX_SESSIONS_ENV]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return MCP_MAX_SESSIONS_DEFAULT;
  const value = Number(raw);
  return value >= MCP_MAX_SESSIONS_MIN && value <= MCP_MAX_SESSIONS_MAX
    ? value
    : MCP_MAX_SESSIONS_DEFAULT;
}

/**
 * Les parts GARANTIES de chaque classe de sessions (SEC-04#1) : un tiers du
 * plafond aux sessions ouvertes avec une clé valide, un tiers aux sessions sans
 * clé ; le dernier tiers va aux plus récentes, quelle que soit leur classe.
 *
 * Magasin plein, la session fermée est la moins récente d'une classe qui
 * DÉPASSE sa part : aucune classe ne peut être réduite sous sa part par
 * l'autre. Avant, l'éviction était un LRU unique : un flot de sessions sans clé
 * chassait les sessions des clients munis d'une clé. Une session fermée répond
 * le 404 « send initialize again » que tout client MCP sait traiter.
 */
export function mcpSessionShares(maxSessions: number): { keyed: number; keyless: number } {
  const share = Math.floor(maxSessions / 3);
  return { keyed: share, keyless: share };
}
