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
 */
export const MCP_SESSIONS_PER_IP_DAY = 30;
