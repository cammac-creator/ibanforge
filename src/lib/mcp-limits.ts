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
