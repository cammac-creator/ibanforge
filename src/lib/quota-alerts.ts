/**
 * Les réglages des alertes de quota d'une clé : les seuils que le titulaire a
 * choisis, les adresses ajoutées à l'alerte, et les verrous « un mail par
 * seuil et par période » (chantier « compte client et alertes », lot 1,
 * 27.11.2026).
 *
 * Tout vit dans trois tables NEUVES (`quota_alert_settings`,
 * `quota_alert_recipients`, `quota_threshold_notices`). `quota_notices` ne
 * bouge pas : elle garde l'alerte des 80 %, son historique et tous ses
 * lecteurs, et le seuil de 80 % continue de s'y verrouiller.
 *
 * 🚨 Ce module ne lit RIEN sur le chemin chaud d'un appel de client : le
 * middleware ne fait que de l'arithmétique (`crossedThresholds`). Les lectures
 * d'ici ne se font qu'au franchissement d'un seuil, hors de la requête, ou
 * depuis la page du compte.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getStatsDB } from './db.js';
import { VERIFICATION_MAX_ATTEMPTS, VERIFICATION_TTL_MINUTES } from './key-creation-guard.js';
import {
  ALERT_THRESHOLDS,
  DEFAULT_ALERT_THRESHOLDS,
  isAlertThreshold,
  type AlertThreshold,
} from './quota-period.js';
import { clearQuotaNotice, recordQuotaNotice } from './api-keys.js';

/** Adresses au plus, EN PLUS de celle de la clé (confirmées ou en attente de code). */
export const MAX_ALERT_RECIPIENTS = 3;

// ─── Les seuils choisis ──────────────────────────────────────────────────────

/**
 * Les seuils d'une clé : ceux qu'elle a choisis, sinon l'alerte des 80 % seule
 * (le comportement d'avant ce lot pour qui ne touche à rien). Une ligne
 * illisible vaut le défaut : jamais une clé sans alerte par accident.
 */
export function readThresholds(keyHash: string): AlertThreshold[] {
  try {
    const row = getStatsDB()
      .prepare('SELECT thresholds FROM quota_alert_settings WHERE key_hash = ?')
      .get(keyHash) as { thresholds: string } | undefined;
    if (!row) return [...DEFAULT_ALERT_THRESHOLDS];
    const list = parseThresholds(row.thresholds);
    return list.length > 0 ? list : [...DEFAULT_ALERT_THRESHOLDS];
  } catch {
    return [...DEFAULT_ALERT_THRESHOLDS];
  }
}

function parseThresholds(raw: string): AlertThreshold[] {
  const wanted = new Set(
    raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter(isAlertThreshold),
  );
  return ALERT_THRESHOLDS.filter((t) => wanted.has(t));
}

/**
 * Valide un choix venu d'une page : un tableau de nombres tous pris dans la
 * liste fermée, au moins un, sans texte ni doublon superflu. Rend la liste
 * triée, ou null si le choix est refusé.
 */
export function validateThresholdChoice(raw: unknown): AlertThreshold[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ALERT_THRESHOLDS.length) return null;
  if (!raw.every(isAlertThreshold)) return null;
  const wanted = new Set<number>(raw);
  return ALERT_THRESHOLDS.filter((t) => wanted.has(t));
}

export function writeThresholds(keyHash: string, thresholds: readonly AlertThreshold[]): void {
  getStatsDB()
    .prepare(
      `INSERT INTO quota_alert_settings (key_hash, thresholds, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key_hash) DO UPDATE SET
           thresholds = excluded.thresholds, updated_at = excluded.updated_at`,
    )
    .run(keyHash, thresholds.join(','));
}

// ─── Les verrous : un mail par (clé, période, seuil) ─────────────────────────

/**
 * Prend le droit d'avertir cette clé de ce seuil pour cette période. Vrai pour
 * un seul appelant par (clé, période, seuil).
 *
 * Le seuil de 80 % reste sur `quota_notices` : c'est sa ligne que lisent la
 * page du compte, la liste des profils de l'administration et les essais
 * d'avant ce lot, et une clé déjà avertie ce mois-ci avant la mise en ligne ne
 * doit pas l'être une seconde fois.
 */
export function claimThresholdNotice(
  keyHash: string,
  period: string,
  threshold: AlertThreshold,
): boolean {
  if (threshold === 80) return recordQuotaNotice(keyHash, period);
  return (
    getStatsDB()
      .prepare(
        'INSERT OR IGNORE INTO quota_threshold_notices (key_hash, period, threshold) VALUES (?, ?, ?)',
      )
      .run(keyHash, period, threshold).changes > 0
  );
}

/** Rend le verrou quand aucun mail n'est parti : un hoquet du relais ne brûle pas l'alerte du mois. */
export function releaseThresholdNotice(
  keyHash: string,
  period: string,
  threshold: AlertThreshold,
): void {
  if (threshold === 80) {
    clearQuotaNotice(keyHash, period);
    return;
  }
  getStatsDB()
    .prepare(
      'DELETE FROM quota_threshold_notices WHERE key_hash = ? AND period = ? AND threshold = ?',
    )
    .run(keyHash, period, threshold);
}

/**
 * Le verrou de l'alerte d'EXPLOITATION (Telegram) : même table, période
 * préfixée `ops-`, qu'aucun lecteur de la page du compte ne prend pour un mois.
 */
export function claimOpsNotice(
  keyHash: string,
  period: string,
  threshold: AlertThreshold,
): boolean {
  return (
    getStatsDB()
      .prepare(
        'INSERT OR IGNORE INTO quota_threshold_notices (key_hash, period, threshold) VALUES (?, ?, ?)',
      )
      .run(keyHash, `ops-${period}`, threshold).changes > 0
  );
}

// ─── Les adresses ajoutées ───────────────────────────────────────────────────

export interface AlertRecipient {
  email: string;
  status: 'pending' | 'confirmed';
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Les adresses ajoutées à une clé, confirmées ou en attente, dans l'ordre d'ajout. */
export function listRecipients(keyHash: string): AlertRecipient[] {
  return getStatsDB()
    .prepare('SELECT email, status FROM quota_alert_recipients WHERE key_hash = ? ORDER BY id')
    .all(keyHash) as AlertRecipient[];
}

/** Les SEULES adresses qui reçoivent une alerte en plus de celle de la clé : les confirmées. */
export function confirmedRecipients(keyHash: string): string[] {
  return (
    getStatsDB()
      .prepare(
        "SELECT email FROM quota_alert_recipients WHERE key_hash = ? AND status = 'confirmed' ORDER BY id",
      )
      .all(keyHash) as Array<{ email: string }>
  ).map((r) => r.email);
}

export type StartRecipient = { ok: true } | { ok: false; reason: 'full' | 'already_confirmed' };

/** Tire un code à six chiffres pour une adresse à confirmer. */
export function drawRecipientCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Réserve la place d'une adresse et enregistre son code (haché). Appelée
 * APRÈS un envoi réussi du code, comme `issueLoginCode`. Une adresse déjà en
 * attente reçoit un code neuf et ses essais repartent de zéro ; une adresse
 * déjà confirmée est refusée ; au-delà de trois adresses, 'full'.
 */
export function startRecipient(keyHash: string, email: string, code: string): StartRecipient {
  const db = getStatsDB();
  const run = db.transaction((): StartRecipient => {
    const existing = db
      .prepare('SELECT status FROM quota_alert_recipients WHERE key_hash = ? AND email = ?')
      .get(keyHash, email) as { status: string } | undefined;
    if (existing?.status === 'confirmed') return { ok: false, reason: 'already_confirmed' };
    if (!existing) {
      const n = (
        db
          .prepare('SELECT COUNT(*) AS n FROM quota_alert_recipients WHERE key_hash = ?')
          .get(keyHash) as { n: number }
      ).n;
      if (n >= MAX_ALERT_RECIPIENTS) return { ok: false, reason: 'full' };
    }
    db.prepare(
      `INSERT INTO quota_alert_recipients (key_hash, email, status, code_hash, code_expires_at, attempts)
         VALUES (?, ?, 'pending', ?, datetime('now', ?), 0)
         ON CONFLICT(key_hash, email) DO UPDATE SET
           code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at, attempts = 0`,
    ).run(keyHash, email, sha256(code), `+${VERIFICATION_TTL_MINUTES} minutes`);
    return { ok: true };
  });
  return run.immediate();
}

/** Peut-on seulement ENVOYER un code à cette adresse (place libre ou adresse déjà en attente) ? */
export function recipientSlotAvailable(
  keyHash: string,
  email: string,
): 'ok' | 'full' | 'already_confirmed' {
  const rows = listRecipients(keyHash);
  const mine = rows.find((r) => r.email === email);
  if (mine?.status === 'confirmed') return 'already_confirmed';
  if (!mine && rows.length >= MAX_ALERT_RECIPIENTS) return 'full';
  return 'ok';
}

export type ConfirmRecipient = { ok: true } | { ok: false };

/**
 * Confirme une adresse par son code. Le plafond d'essais se lit AVANT la
 * comparaison, comme pour le code de connexion ; une ligne expirée est
 * supprimée. Un seul échec, sans dire pourquoi.
 */
export function confirmRecipient(keyHash: string, email: string, code: string): ConfirmRecipient {
  const db = getStatsDB();
  const row = db
    .prepare(
      `SELECT code_hash, attempts, (code_expires_at <= datetime('now')) AS gone
         FROM quota_alert_recipients WHERE key_hash = ? AND email = ? AND status = 'pending'`,
    )
    .get(keyHash, email) as
    { code_hash: string | null; attempts: number; gone: number } | undefined;
  if (!row || !row.code_hash) return { ok: false };
  if (row.gone) {
    db.prepare(
      "DELETE FROM quota_alert_recipients WHERE key_hash = ? AND email = ? AND status = 'pending'",
    ).run(keyHash, email);
    return { ok: false };
  }
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return { ok: false };
  const got = Buffer.from(sha256(code.trim()));
  const want = Buffer.from(row.code_hash);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    db.prepare(
      'UPDATE quota_alert_recipients SET attempts = attempts + 1 WHERE key_hash = ? AND email = ?',
    ).run(keyHash, email);
    return { ok: false };
  }
  const done = db
    .prepare(
      `UPDATE quota_alert_recipients
          SET status = 'confirmed', code_hash = NULL, code_expires_at = NULL, attempts = 0,
              confirmed_at = datetime('now')
        WHERE key_hash = ? AND email = ? AND status = 'pending' AND code_hash = ?`,
    )
    .run(keyHash, email, row.code_hash).changes;
  return done === 1 ? { ok: true } : { ok: false };
}

/** Retire une adresse, à tout moment, confirmée ou non. Vrai si une ligne est partie. */
export function removeRecipient(keyHash: string, email: string): boolean {
  return (
    getStatsDB()
      .prepare('DELETE FROM quota_alert_recipients WHERE key_hash = ? AND email = ?')
      .run(keyHash, email).changes > 0
  );
}

/** Purge les adresses jamais confirmées après la durée de leur code, plus un jour. */
export function purgeUnconfirmedRecipients(): number {
  return getStatsDB()
    .prepare(
      "DELETE FROM quota_alert_recipients WHERE status = 'pending' AND code_expires_at < datetime('now', '-1 day')",
    )
    .run().changes;
}
