/**
 * L'état payant : les tables que la sauvegarde exporte (`exportPaidState`,
 * src/lib/backup.ts), et rien d'autre. Une seule liste, lue par la sauvegarde nocturne et
 * par la copie d'avant migration (src/lib/pre-migration-copy.ts) : les deux ont ainsi
 * exactement le périmètre que les textes publiés décrivent pour les sauvegardes (politique
 * de confidentialité §2, DPA 4.8).
 *
 * Module feuille, sans aucun import : backup.ts dépend de db.ts, et db.ts de la copie.
 * Placée ici, la liste se lit des deux côtés sans cycle.
 *
 * 🚨 Une table neuve de l'état payant s'ajoute ICI, à sa place dans l'ordre de l'export, et
 * dans `BackupPayload` (backup.ts) : sinon une restauration la perd en silence.
 */
export const PAID_STATE_TABLES = [
  'api_keys',
  'api_usage',
  'key_claims',
  'key_settlements',
  'key_revocations',
  'lineage_facts',
  'breaker_transitions',
  'key_creations',
  'device_grant_daily',
  'mcp_remote_daily',
  'key_purchases',
  'key_topup_refs',
] as const;

export type PaidStateTable = (typeof PAID_STATE_TABLES)[number];

/**
 * Les colonnes de l'état payant qui n'en sortent jamais, par table : une clé API en clair,
 * gardée pour un seul retrait (DPA 4.2). L'export les retire après lecture, la copie les
 * remplace par NULL sans jamais les écrire. Voir SEC-03 dans backup.ts.
 */
export const PAID_STATE_EXCLUDED_COLUMNS: Readonly<
  Partial<Record<PaidStateTable, readonly string[]>>
> = {
  api_keys: ['raw_key_one_time_view'],
};
