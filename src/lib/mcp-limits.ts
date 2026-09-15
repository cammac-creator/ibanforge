/**
 * Essai MCP par adresse IP : une unité par appel, ou par IBAN dans un lot.
 * Ces constantes restent indépendantes du serveur pour éviter un cycle
 * d'initialisation lorsque les textes de découverte les importent.
 */
export const MCP_DAILY_LIMIT = 10;

/** Une session réserve un serveur ; son plafond est distinct des appels. */
export const MCP_SESSIONS_PER_IP_DAY = 30;
