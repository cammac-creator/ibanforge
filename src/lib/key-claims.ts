import { getStatsDB } from './db.js';

/**
 * Le journal des réclamations et des envois de code (spec 01 §3.4).
 *
 * Pourquoi une table plutôt que « la clé est vivante, donc elle a été
 * réclamée » : une clé vivante peut être tuée par son porteur, et la route de
 * révocation est publique. Un journal en ajout seul est le seul état que
 * l'appelant ne contrôle pas. Trois lecteurs en dépendent : la clause « cette
 * adresse porte déjà une clé » de la réclamation, le plafond de réclamation
 * par réseau, et le détecteur d'armement du disjoncteur (lot 5).
 *
 * 🚨 Ces lignes ne s'additionnent JAMAIS à `key_creations` dans la fenêtre du
 * disjoncteur : les compter contre le seuil de créations importerait un
 * armement permanent par une porte neuve et invaliderait la calibration.
 */
export type KeyClaimEvent = 'send' | 'claim';
export type KeyClaimMethod =
  'email_code' | 'x402' | 'credits' | 'stripe' | 'agent_signature' | 'admin';

export function recordKeyClaim(p: {
  event: KeyClaimEvent;
  emailNorm: string | null;
  keyPrefix: string;
  keyHash: string;
  method: KeyClaimMethod | null;
  ipHash: string | null;
}): void {
  getStatsDB()
    .prepare(
      'INSERT INTO key_claims (event, email_norm, key_prefix, key_hash, method, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(p.event, p.emailNorm, p.keyPrefix, p.keyHash, p.method, p.ipHash);
}

/** Réclamations réussies venues de ce réseau dans les `hours` dernières heures. */
export function countClaimsBySource(ipHash: string, hours: number): number {
  const row = getStatsDB()
    .prepare(
      "SELECT COUNT(*) AS n FROM key_claims WHERE event = 'claim' AND ip_hash = ? AND created_at >= datetime('now', ?)",
    )
    .get(ipHash, `-${hours} hours`) as { n: number };
  return row.n;
}

/**
 * Cette adresse a-t-elle réclamé une clé dans les `hours` dernières heures ?
 * Mesuré sur l'HISTORIQUE, jamais sur « porte-t-elle une clé active » : la
 * révocation est en libre-service et effacerait la condition dans l'instant.
 */
export function hasClaimedRecently(emailNorm: string, hours: number): boolean {
  const row = getStatsDB()
    .prepare(
      "SELECT 1 AS one FROM key_claims WHERE event = 'claim' AND email_norm = ? AND created_at >= datetime('now', ?) LIMIT 1",
    )
    .get(emailNorm, `-${hours} hours`) as { one: number } | undefined;
  return !!row;
}
