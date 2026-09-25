/**
 * Exporting and restoring what a customer paid for.
 *
 * ## Why this exists
 *
 * `stats.sqlite` lives on a single Railway volume and has no backup of any
 * kind: no dump, no replication, no export. It holds the API keys, the monthly
 * quotas and the prepaid credit balances. Measured on 21/08/2026, tens of
 * thousands of purchased credits were sitting in it unconsumed — money already
 * taken, service still owed.
 *
 * If that volume is lost, every customer loses the access they paid for and
 * there is no way to give it back. Not a degraded feature: a broken contract,
 * silently, with no way to even know who was owed what.
 *
 * ## What is in scope, and what is deliberately not
 *
 * Only what is **irreplaceable and contractual**: the keys themselves, their
 * allowances and balances, and the usage counters that decide whether a caller
 * is inside their quota this month.
 *
 * The mail archive, the CRM, prospects and forum threads are NOT here. They are
 * valuable and their loss would hurt, but they are not owed to anyone, and an
 * export endpoint that carries a company's entire correspondence is a much
 * larger thing to leave lying around behind one secret.
 *
 * 🚨 A dump of this is customer data: addresses and key hashes. It must never
 * be committed, never be attached to a public artifact, and never be written
 * anywhere inside the repository. The endpoint that serves it is admin-only.
 *
 * ⚠️ Key hashes, never keys. The raw key is not stored by the product at all,
 * so a restore brings back a customer's balance and their existing key keeps
 * working — it cannot mint a key nobody holds.
 */
import { getStatsDB } from './db.js';
import { recordEvent } from './events.js';

/** Bumped when the shape changes, so a restore can refuse a dump it cannot read. */
export const BACKUP_FORMAT = 8;
/**
 * Ce qu'un restaurateur d'aujourd'hui sait lire. Le format 1 n'a pas les deux
 * journaux du palier de clé (key_claims, key_settlements), le format 2 n'a pas
 * le journal d'annulation du radar (key_revocations, lot 6), le format 3 n'a pas
 * les faits de mesure de l'essai (lineage_facts, lot M), le format 4 n'a pas le
 * journal des bascules du disjoncteur (breaker_transitions, lot 5), le format 5
 * n'a pas les naissances de clés (key_creations, revue du 15/09), le format 6
 * n'a pas les deux compteurs journaliers des portes d'agent
 * (device_grant_daily, mcp_remote_daily, chantier « mesure agents »), le
 * format 7 n'a pas le registre des achats ni les références de recharge
 * (key_purchases, key_topup_refs, chantier « clé unique », lot B1) : ils y
 * valent [] et le reste se restaure. Une PLAGE et non une égalité : sans elle, incrémenter
 * le format rend irrestaurable tout dump pris avant la livraison — sur une base
 * qui n'a pas d'autre sauvegarde. Et incrémenter plutôt que ne rien faire :
 * sans numéro, un dump tronqué et un dump légitimement ancien seraient
 * indiscernables, et le `?? []` masquerait l'un comme l'autre.
 */
export const READABLE_FORMATS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export interface BackupPayload {
  format: number;
  /** Stamped by the caller, not by this module: the clock is not our business. */
  taken_at: string;
  counts: {
    api_keys: number;
    api_usage: number;
    key_claims?: number;
    key_settlements?: number;
    key_revocations?: number;
    lineage_facts?: number;
    breaker_transitions?: number;
    key_creations?: number;
    device_grant_daily?: number;
    mcp_remote_daily?: number;
    key_purchases?: number;
    key_topup_refs?: number;
  };
  api_keys: Array<Record<string, unknown>>;
  api_usage: Array<Record<string, unknown>>;
  /**
   * 🚨 Les colonnes voyagent seules (SELECT *), les TABLES non : chaque table
   * neuve doit être nommée ici, sinon une restauration la perd en silence.
   * Facultatives pour lire un dump au format 1.
   */
  key_claims?: Array<Record<string, unknown>>;
  key_settlements?: Array<Record<string, unknown>>;
  /**
   * Format 3. Les anciens soldes des clés coupées pour rafale : sans eux, une
   * clé désactivée par le radar ne peut plus être rendue telle qu'elle était.
   */
  key_revocations?: Array<Record<string, unknown>>;
  /**
   * Format 4. Les faits de mesure de l'essai : une ligne par lignée de clé.
   *
   * Pas de l'argent, mais une mesure qui ne se reconstitue plus. Le premier
   * résultat d'une lignée est écrit une seule fois : un volume perdu et
   * restauré sans cette table rendrait des lignées vivantes avec un entonnoir
   * vide, et le rattrapage depuis request_log ne rendrait que ce que la purge
   * des douze mois a laissé.
   */
  lineage_facts?: Array<Record<string, unknown>>;
  /**
   * Format 5. Le journal des bascules du disjoncteur : deux lignes par épisode,
   * la seule trace qui explique après coup pourquoi des clés sont nées dégradées.
   */
  breaker_transitions?: Array<Record<string, unknown>>;
  /**
   * Format 6. Les naissances de clés : la matière que lisent le disjoncteur et
   * les deux passes du radar. Sans elle, une base restaurée rendrait toute clé
   * restaurée invisible aux protections et « définitivement irrévocable »
   * (arbitrage A8 annulé en silence par la restauration — revue du 15/09,
   * constat R3). Une ligne par création libre, aucune donnée client.
   */
  key_creations?: Array<Record<string, unknown>>;
  /**
   * Format 7. Les deux compteurs journaliers des portes par lesquelles une
   * identité d'AGENT arrive : le rail device grant, et le haut de l'entonnoir
   * MCP distant.
   *
   * 🚨 Le discriminant qui les fait entrer ici alors que `trial_daily`, juste à
   * côté, en est délibérément absente, est la RECOMPUTABILITÉ.
   * `trial_daily` se reconstruit depuis `trial_ledger`. Ces deux tables non :
   * `device_codes` est purgée à 24 h et `mcp_remote_daily` n'a AUCUNE autre
   * source — le nom de l'outil MCP n'est journalisé nulle part. Restaurer un
   * volume sans elles rendrait des lignées vivantes avec un rail à zéro, le
   * même argument que `lineage_facts` fait valoir trois blocs plus haut.
   *
   * 🚨 `device_codes` N'ENTRE PAS dans la sauvegarde et n'y entrera pas : elle
   * porte `raw_key_once`, c'est-à-dire une clé API EN CLAIR, et l'export est
   * précisément le fichier fait pour être copié hors du serveur (voir
   * `EXPORT_EXCLUDED_COLUMNS` et SEC-03). Ces deux tables-ci ne portent que des
   * comptes : pas d'adresse, pas d'UA, pas de code, pas de clé.
   */
  device_grant_daily?: Array<Record<string, unknown>>;
  mcp_remote_daily?: Array<Record<string, unknown>>;
  /**
   * Format 8. Le registre des achats (une ligne par paiement) et la référence
   * de recharge de chaque lignée (lot B1, 25.09.2026).
   *
   * Le registre est la source de vérité de l'argent depuis ce lot : sans lui,
   * une base restaurée perdrait l'idempotence de chaque paiement (une session
   * Stripe rejouée recréditerait une clé) et toutes les ventes par recharge.
   * Les références, elles, sont ce que portent les liens déjà envoyés dans les
   * mails et les 402 : une référence perdue ferait frapper une clé neuve à qui
   * voulait recharger la sienne. `payer_email` voyage avec sa ligne : c'est
   * une donnée client, comme les adresses d'`api_keys` du même fichier.
   */
  key_purchases?: Array<Record<string, unknown>>;
  key_topup_refs?: Array<Record<string, unknown>>;
}

/**
 * Columns dropped from the export after they are read.
 *
 * `raw_key_one_time_view` is the API key IN CLEAR, kept for the few days
 * between a purchase and the buyer collecting it. Its whole reason to exist is
 * to bound how long a key lives in plaintext — and the export walked straight
 * past that bound: one admin call returned every uncollected key, in clear,
 * next to every customer address, in a file whose entire purpose is to be
 * copied off the server (SEC-03, audit 2026-09-01).
 *
 * Nothing is lost. A restore rebuilds access from `key_hash`, which is what
 * authenticates a caller; the buyer's existing key keeps working. Only the
 * convenience of re-serving a key nobody collected goes, and that is a
 * plaintext credential we should not be shipping in a backup anyway.
 */
const EXPORT_EXCLUDED_COLUMNS = ['raw_key_one_time_view'] as const;

/**
 * Everything needed to give a paying customer their access back.
 *
 * Columns are read with `SELECT *` on purpose. A hand-written column list
 * silently stops exporting anything added later, and the failure only shows up
 * on the day someone tries to restore — which is the worst possible day to
 * discover that the backup was incomplete. The one column removed is removed
 * AFTER the read, by name, so the doctrine survives: a new column is exported
 * without anyone having to remember it, and only a deliberate line here can
 * ever leave one out.
 */
export function exportPaidState(takenAt: string): BackupPayload {
  const db = getStatsDB();
  const keys = (db.prepare('SELECT * FROM api_keys').all() as Array<Record<string, unknown>>).map(
    (row) => {
      const copy = { ...row };
      for (const column of EXPORT_EXCLUDED_COLUMNS) delete copy[column];
      return copy;
    },
  );
  const usage = db.prepare('SELECT * FROM api_usage').all() as Array<Record<string, unknown>>;
  const claims = db.prepare('SELECT * FROM key_claims').all() as Array<Record<string, unknown>>;
  const settlements = db.prepare('SELECT * FROM key_settlements').all() as Array<
    Record<string, unknown>
  >;
  const revocations = db.prepare('SELECT * FROM key_revocations').all() as Array<
    Record<string, unknown>
  >;
  const lineages = db.prepare('SELECT * FROM lineage_facts').all() as Array<
    Record<string, unknown>
  >;
  const transitions = db.prepare('SELECT * FROM breaker_transitions').all() as Array<
    Record<string, unknown>
  >;
  const creations = db.prepare('SELECT * FROM key_creations').all() as Array<
    Record<string, unknown>
  >;
  const grantDays = db.prepare('SELECT * FROM device_grant_daily').all() as Array<
    Record<string, unknown>
  >;
  const mcpDays = db.prepare('SELECT * FROM mcp_remote_daily').all() as Array<
    Record<string, unknown>
  >;
  const purchases = db.prepare('SELECT * FROM key_purchases').all() as Array<
    Record<string, unknown>
  >;
  const topupRefs = db.prepare('SELECT * FROM key_topup_refs').all() as Array<
    Record<string, unknown>
  >;
  // An export is the one read that takes the whole customer base off the
  // server, and it left no trace of its own: a single `request_log` line,
  // indistinguishable from any other call. This annotation puts it on the
  // dashboard timeline with its volume, so "when was the last dump taken, and
  // how big was it" has an answer that does not require log archaeology.
  try {
    recordEvent('manual', `backup export: ${keys.length} keys, ${usage.length} usage rows`);
  } catch (err) {
    // A disaster-recovery export must not fail over its own annotation: the
    // stats DB has writers outside this process and a BUSY here would turn the
    // one call that saves the billing state into a 500.
    console.error('[backup] export annotation failed:', err instanceof Error ? err.message : err);
  }
  return {
    format: BACKUP_FORMAT,
    taken_at: takenAt,
    counts: {
      api_keys: keys.length,
      api_usage: usage.length,
      key_claims: claims.length,
      key_settlements: settlements.length,
      key_revocations: revocations.length,
      lineage_facts: lineages.length,
      breaker_transitions: transitions.length,
      key_creations: creations.length,
      device_grant_daily: grantDays.length,
      mcp_remote_daily: mcpDays.length,
      key_purchases: purchases.length,
      key_topup_refs: topupRefs.length,
    },
    api_keys: keys,
    api_usage: usage,
    key_claims: claims,
    key_settlements: settlements,
    key_revocations: revocations,
    lineage_facts: lineages,
    breaker_transitions: transitions,
    key_creations: creations,
    device_grant_daily: grantDays,
    mcp_remote_daily: mcpDays,
    key_purchases: purchases,
    key_topup_refs: topupRefs,
  };
}

export interface RestoreReport {
  keys_inserted: number;
  keys_skipped: number;
  usage_inserted: number;
  usage_skipped: number;
  claims_inserted: number;
  claims_skipped: number;
  settlements_inserted: number;
  settlements_skipped: number;
  revocations_inserted: number;
  revocations_skipped: number;
  lineages_inserted: number;
  lineages_skipped: number;
  transitions_inserted: number;
  transitions_skipped: number;
  creations_inserted: number;
  creations_skipped: number;
  grant_days_inserted: number;
  grant_days_skipped: number;
  mcp_days_inserted: number;
  mcp_days_skipped: number;
  purchases_inserted: number;
  purchases_skipped: number;
  topup_refs_inserted: number;
  topup_refs_skipped: number;
}

/**
 * Put a dump back, without destroying anything already present.
 *
 * Additive by design: rows whose key already exists are SKIPPED, never
 * overwritten. A restore is run in a panic, often against a database that is
 * partly alive, and the mode that cannot make things worse is the only one
 * worth having. Recovering a wiped volume and merging an old dump into a live
 * one are then the same operation.
 *
 * Refuses a dump whose format it does not know rather than importing half of
 * it: a partial restore of billing state is worse than a refused one, because
 * it looks like it worked.
 */
export function restorePaidState(payload: BackupPayload): RestoreReport {
  if (!READABLE_FORMATS.includes(payload?.format as (typeof READABLE_FORMATS)[number])) {
    throw new Error(
      `unsupported backup format: ${payload?.format ?? 'missing'} ` +
        `(readable: ${READABLE_FORMATS.join(', ')})`,
    );
  }
  const db = getStatsDB();
  const report: RestoreReport = {
    keys_inserted: 0,
    keys_skipped: 0,
    usage_inserted: 0,
    usage_skipped: 0,
    claims_inserted: 0,
    claims_skipped: 0,
    settlements_inserted: 0,
    settlements_skipped: 0,
    revocations_inserted: 0,
    revocations_skipped: 0,
    lineages_inserted: 0,
    lineages_skipped: 0,
    transitions_inserted: 0,
    transitions_skipped: 0,
    creations_inserted: 0,
    creations_skipped: 0,
    grant_days_inserted: 0,
    grant_days_skipped: 0,
    mcp_days_inserted: 0,
    mcp_days_skipped: 0,
    purchases_inserted: 0,
    purchases_skipped: 0,
    topup_refs_inserted: 0,
    topup_refs_skipped: 0,
  };

  const insertRow = (table: string, row: Record<string, unknown>): boolean => {
    const cols = Object.keys(row);
    if (cols.length === 0) return false;
    const sql = `INSERT OR IGNORE INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
      .map(() => '?')
      .join(', ')})`;
    const info = db.prepare(sql).run(...cols.map((c) => row[c] as never));
    return info.changes > 0;
  };

  // One transaction: a restore that stops halfway leaves a billing table in a
  // state nobody can reason about.
  const run = db.transaction(() => {
    for (const row of payload.api_keys ?? []) {
      if (insertRow('api_keys', row)) report.keys_inserted++;
      else report.keys_skipped++;
    }
    for (const row of payload.api_usage ?? []) {
      if (insertRow('api_usage', row)) report.usage_inserted++;
      else report.usage_skipped++;
    }
    // Absents d'un dump au format 1 : rien à remettre, et ce n'est pas une
    // erreur. Un dump au format 2 les porte toujours, même vides.
    for (const row of payload.key_claims ?? []) {
      if (insertRow('key_claims', row)) report.claims_inserted++;
      else report.claims_skipped++;
    }
    for (const row of payload.key_settlements ?? []) {
      if (insertRow('key_settlements', row)) report.settlements_inserted++;
      else report.settlements_skipped++;
    }
    // Absent d'un dump aux formats 1 et 2 ; un dump au format 3 le porte
    // toujours, même vide.
    for (const row of payload.key_revocations ?? []) {
      if (insertRow('key_revocations', row)) report.revocations_inserted++;
      else report.revocations_skipped++;
    }
    // Absent d'un dump aux formats 1 à 3 ; un dump au format 4 le porte
    // toujours, même vide.
    for (const row of payload.lineage_facts ?? []) {
      if (insertRow('lineage_facts', row)) report.lineages_inserted++;
      else report.lineages_skipped++;
    }
    // Absent d'un dump aux formats 1 à 4 ; un dump au format 5 le porte
    // toujours, même vide.
    for (const row of payload.breaker_transitions ?? []) {
      if (insertRow('breaker_transitions', row)) report.transitions_inserted++;
      else report.transitions_skipped++;
    }
    // Absent d'un dump aux formats 1 à 5 ; un dump au format 6 le porte toujours.
    for (const row of payload.key_creations ?? []) {
      if (insertRow('key_creations', row)) report.creations_inserted++;
      else report.creations_skipped++;
    }
    // Absents d'un dump aux formats 1 à 6 ; un dump au format 7 les porte
    // toujours, même vides. `INSERT OR IGNORE` sur (day, source) et sur (day) :
    // fusionner un vieux dump dans une base vivante ne peut donc pas écraser la
    // journée en cours par celle du dump — un compteur cumulatif remis à une
    // valeur ancienne serait pire qu'une journée manquante.
    for (const row of payload.device_grant_daily ?? []) {
      if (insertRow('device_grant_daily', row)) report.grant_days_inserted++;
      else report.grant_days_skipped++;
    }
    for (const row of payload.mcp_remote_daily ?? []) {
      if (insertRow('mcp_remote_daily', row)) report.mcp_days_inserted++;
      else report.mcp_days_skipped++;
    }
    // Absents d'un dump aux formats 1 à 7 ; un dump au format 8 les porte
    // toujours, même vides. `INSERT OR IGNORE` sur `payment_ref` et sur la
    // lignée : une ligne déjà présente (rattrapage au démarrage, paiement reçu
    // depuis) n'est jamais écrasée par celle du dump.
    for (const row of payload.key_purchases ?? []) {
      // Sans son `id` : l'identité d'un paiement est `payment_ref`. Fusionné
      // dans une base vivante, un `id` du dump pourrait tomber sur celui d'un
      // AUTRE paiement reçu depuis, et `INSERT OR IGNORE` écarterait alors un
      // paiement réel en silence.
      const { id: _id, ...purchase } = row;
      void _id;
      if (insertRow('key_purchases', purchase)) report.purchases_inserted++;
      else report.purchases_skipped++;
    }
    for (const row of payload.key_topup_refs ?? []) {
      if (insertRow('key_topup_refs', row)) report.topup_refs_inserted++;
      else report.topup_refs_skipped++;
    }
  });
  run();

  return report;
}
