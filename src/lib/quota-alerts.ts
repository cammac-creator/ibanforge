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
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { getStatsDB } from './db.js';
import { VERIFICATION_MAX_ATTEMPTS, VERIFICATION_TTL_MINUTES } from './key-creation-guard.js';
import {
  ALERT_THRESHOLDS,
  DEFAULT_ALERT_THRESHOLDS,
  isAlertThreshold,
  isCivilPeriodLabel,
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
  // Le verrou des 80 % ne reste sur `quota_notices` que pour un MOIS civil : ses
  // lecteurs prennent chaque valeur pour « AAAA-MM ». L'étiquette d'une période
  // ancrée sur une facturation (« AAAA-MM-JJ ») prend la table des seuils.
  if (threshold === 80 && isCivilPeriodLabel(period)) return recordQuotaNotice(keyHash, period);
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
  if (threshold === 80 && isCivilPeriodLabel(period)) {
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

/**
 * L'empreinte d'un code : un HMAC avec le secret du serveur déjà exigé en
 * production (`IP_HASH_SECRET`, ou `SESSION_SECRET`, comme `stats.ts`). Aucun
 * secret nouveau à configurer. Lu à chaque appel : une rotation du secret
 * invalide au pire les codes en cours (quinze minutes).
 */
function codeDigest(code: string): string {
  const secret =
    process.env.IP_HASH_SECRET ?? process.env.SESSION_SECRET ?? 'ibanforge-default-salt-change-me';
  return createHmac('sha256', secret).update(`alert-address-code:${code}`).digest('hex');
}

/**
 * Le code se saisit en majuscules, sans espace ni tiret : « a2b3-c4d5 » vaut
 * « A2B3C4D5 ».
 */
export function normalizeRecipientCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Huit caractères de l'alphabet du code : la forme que la route accepte. */
export function isRecipientCode(code: string): boolean {
  return new RegExp(`^[${RECIPIENT_CODE_ALPHABET}]{8}$`).test(code);
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

/**
 * Le code de confirmation d'une adresse d'alerte a un format DISTINCT du code de
 * connexion (six chiffres) : huit caractères, lettres et chiffres sans
 * ambiguïté (ni I, O, 0, 1). Sinon quelqu'un qui reçoit « un code » et le
 * transmet « au titulaire de la clé » pourrait, par ingénierie sociale, remettre
 * un code de CONNEXION. Le mail le dit aussi en toutes lettres.
 */
export const RECIPIENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function drawRecipientCode(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1)
    code += RECIPIENT_CODE_ALPHABET[randomInt(0, RECIPIENT_CODE_ALPHABET.length)];
  return code;
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
    ).run(
      keyHash,
      email,
      codeDigest(normalizeRecipientCode(code)),
      `+${VERIFICATION_TTL_MINUTES} minutes`,
    );
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
  const got = Buffer.from(codeDigest(normalizeRecipientCode(code)));
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

/**
 * Purge les adresses jamais confirmées dont le code a expiré (quinze minutes) :
 * avec la purge quotidienne, une adresse non confirmée vit au plus un jour et
 * quart, donc moins de deux jours (Politique de confidentialité 1.16).
 */
export function purgeUnconfirmedRecipients(): number {
  return getStatsDB()
    .prepare(
      "DELETE FROM quota_alert_recipients WHERE status = 'pending' AND code_expires_at < datetime('now')",
    )
    .run().changes;
}

// ─── Le budget d'envoi des codes d'adresse, SÉPARÉ de celui des connexions ───

/** Codes de confirmation d'adresse au plus par clé et par jour. */
export const ALERT_CODES_PER_KEY_DAY = 5;
/** Codes de confirmation d'adresse au plus par jour, toutes clés confondues. */
export const ALERT_CODES_PER_DAY = 60;

/**
 * Prend une place sur les deux budgets (par clé, global), à part de ceux des
 * codes de connexion : un abus des alertes n'empêche donc personne de se
 * connecter. Vrai si la place est prise ; la place est inscrite tout de suite.
 */
export function takeAlertCodeSlot(keyHash: string): boolean {
  const db = getStatsDB();
  const run = db.transaction((): boolean => {
    const perKey = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM quota_alert_code_sends WHERE key_hash = ? AND created_at >= datetime('now', '-1 day')",
        )
        .get(keyHash) as { n: number }
    ).n;
    if (perKey >= ALERT_CODES_PER_KEY_DAY) return false;
    const total = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM quota_alert_code_sends WHERE created_at >= datetime('now', '-1 day')",
        )
        .get() as { n: number }
    ).n;
    if (total >= ALERT_CODES_PER_DAY) return false;
    db.prepare('INSERT INTO quota_alert_code_sends (key_hash) VALUES (?)').run(keyHash);
    return true;
  });
  return run.immediate();
}

/** Purge le journal des envois (deux jours) : il ne sert qu'à compter une journée. */
export function purgeAlertCodeSends(): number {
  return getStatsDB()
    .prepare("DELETE FROM quota_alert_code_sends WHERE created_at < datetime('now', '-2 days')")
    .run().changes;
}

/**
 * Les réglages et les adresses ajoutées d'une clé révoquée ou supprimée ne sont
 * gardés que 30 jours (Politique de confidentialité 1.16). Rend le nombre de
 * lignes d'adresses retirées.
 */
export function purgeSettingsOfDeadKeys(): number {
  const db = getStatsDB();
  // Trois cas : clé désactivée depuis plus de 30 jours, clé supprimée, et clé
  // ENCORE ACTIVE qui n'a plus d'allocation mensuelle (abonnement terminé, 0
  // écrit en base) : une alerte de quota n'y part jamais, ses adresses ajoutées
  // n'ont plus d'objet et le titulaire ne peut plus que les retirer.
  const dead = `key_hash IN (SELECT key_hash FROM api_keys WHERE active = 0 AND deactivated_at < datetime('now', '-30 days'))
                OR key_hash NOT IN (SELECT key_hash FROM api_keys)
                OR key_hash IN (SELECT key_hash FROM api_keys WHERE active = 1 AND monthly_limit IS NOT NULL AND monthly_limit <= 0)`;
  db.prepare(`DELETE FROM quota_alert_settings WHERE ${dead}`).run();
  // Lot 2 (27.11.2026) : l'ancre de facturation et le compteur par période d'une clé morte.
  // Pas la clause « plafond à 0 » : une clé encore abonnée dont l'administration a
  // mis le plafond à 0 à la main garde son ancre ; seule la fin de l'abonnement la retire.
  const anchorDead = `key_hash IN (SELECT key_hash FROM api_keys WHERE active = 0 AND deactivated_at < datetime('now', '-30 days'))
                OR key_hash NOT IN (SELECT key_hash FROM api_keys)
                OR key_hash IN (SELECT key_hash FROM api_keys WHERE subscription_ended_at IS NOT NULL)`;
  db.prepare(`DELETE FROM subscription_periods WHERE ${anchorDead}`).run();
  db.prepare(`DELETE FROM api_usage_period WHERE ${anchorDead}`).run();
  // Un compteur de période vieux de plus de 400 jours ne sert plus à rien (api_usage garde l'historique).
  db.prepare(
    "DELETE FROM api_usage_period WHERE period_start < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-400 days')",
  ).run();
  db.prepare(`DELETE FROM quota_threshold_notices WHERE ${dead}`).run();
  db.prepare(`DELETE FROM quota_alert_code_sends WHERE ${dead}`).run();
  return db.prepare(`DELETE FROM quota_alert_recipients WHERE ${dead}`).run().changes;
}

/** Retire toutes les adresses ajoutées d'une clé (l'administration change son adresse). */
export function removeAllRecipientsOfPrefix(keyPrefix: string): number {
  return getStatsDB()
    .prepare(
      'DELETE FROM quota_alert_recipients WHERE key_hash IN (SELECT key_hash FROM api_keys WHERE key_prefix = ?)',
    )
    .run(keyPrefix).changes;
}

/** Rend le verrou de l'alerte d'exploitation, quand le message n'a pas pu partir. */
export function releaseOpsNotice(keyHash: string, period: string, threshold: AlertThreshold): void {
  getStatsDB()
    .prepare(
      'DELETE FROM quota_threshold_notices WHERE key_hash = ? AND period = ? AND threshold = ?',
    )
    .run(keyHash, `ops-${period}`, threshold);
}
