/**
 * Le compte client par e-mail : codes de connexion, sessions de lecture, vue
 * d'ensemble des clés d'une adresse (lot C1, 24.09.2026).
 *
 * Pourquoi il existe : jusqu'ici, un client ne voyait son solde et sa
 * consommation qu'en COLLANT sa clé dans la page du compte. Il se connecte
 * désormais avec son adresse et un code à six chiffres reçu par mail, et voit
 * toutes les clés actives de cette adresse. Le plan complet, avec sa relecture
 * de sécurité, est dans le dossier interne du chantier (SPEC-COMPTE).
 *
 * ── Les quatre règles qui portent la sûreté de ce module ───────────────────
 *
 *  1. ANTI-ÉNUMÉRATION PAR CONSTRUCTION. Ni l'émission ni la vérification d'un
 *     code ne lisent `api_keys` : le code part que l'adresse porte des clés ou
 *     non, et la session se crée de la même façon. Rien ne peut donc trahir
 *     l'existence d'un compte, ni par le statut, ni par le corps, ni par la
 *     durée. Seul le propriétaire de la boîte découvre la réponse, une fois
 *     connecté. `buildOverview` et `findOwnedKey` sont les SEULES fonctions
 *     d'ici qui lisent les clés, et elles exigent une session.
 *  2. UNE TABLE DE CODES À PART de `pending_verifications`, dont la clé
 *     primaire est l'adresse seule : un code de connexion ne peut ni créer ni
 *     réclamer une clé, et une demande de connexion n'écrase jamais un défi de
 *     création ou de réclamation. Le REGISTRE D'ENVOIS, lui, est partagé
 *     (`verification_sends`, côté route) : les plafonds anti-bombardement ne
 *     se doublent pas en passant par la connexion.
 *  3. LE JETON DE SESSION n'est stocké que haché. Il ne vit que dans un cookie
 *     `HttpOnly` posé par l'API ; il ne passe jamais dans un corps, une URL ou
 *     un journal. Il commence par `ifs_`, et aucun lecteur de clé ne l'accepte
 *     (`extractKey` et `presentedKey` n'acceptent que `ifk_`) : une session ne
 *     peut que LIRE.
 *  4. LECTURE SEULE. Rien ici n'écrit sur une clé. Rotation et révocation
 *     restent authentifiées par la clé collée : elles détruisent une clé en
 *     service, et une adresse ne prouve pas qui l'utilise.
 *
 * Cas limite accepté et écrit (relecture de sécurité, point 11) :
 * `normalizeEmail` retire l'étiquette « + » sur tous les domaines. Deux
 * personnes distinctes dont les adresses ne diffèrent que par une étiquette
 * verraient les clés l'une de l'autre : c'est le même arbitrage que la règle
 * « une personne, une clé gratuite » (`src/lib/email-norm.ts`).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { getStatsDB } from './db.js';
import {
  API_KEY_VALIDATION_COLUMNS,
  OEM_MONTHLY_LIMIT,
  validationFromRow,
  type ApiKeyValidation,
  type ApiKeyValidationRow,
} from './api-keys.js';
import { normalizeEmail } from './email-norm.js';
import { VERIFICATION_MAX_ATTEMPTS, VERIFICATION_TTL_MINUTES } from './key-creation-guard.js';
import { opsFail, opsOk } from './ops-alert.js';
import { PRO_PORTAL_URL } from './payment-links.js';
import { CREDITS_NOTICE_LOCK_PREFIX } from './quota-notice.js';
import { FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

/** Le nom du cookie. Distinct de `ibanforge_session`, celui de l'administration du site. */
export const ACCOUNT_COOKIE = 'ibanforge_account';
/** Le préfixe du jeton : ce qui le distingue d'une clé (`ifk_`) au premier coup d'œil. */
export const ACCOUNT_TOKEN_PREFIX = 'ifs_';
/**
 * Durée ABSOLUE d'une session, en jours. Sept, comme la session d'administration
 * du site, et parce que Safari peut plafonner à sept jours un cookie posé par un
 * sous-domaine servi par une autre infrastructure.
 */
export const ACCOUNT_SESSION_DAYS = 7;
export const ACCOUNT_SESSION_SECONDS = ACCOUNT_SESSION_DAYS * 24 * 60 * 60;
/** Clés par page de la vue d'ensemble. */
export const OVERVIEW_PAGE_SIZE = 50;
/**
 * Jours au plus pour le rapport d'une clé demandé depuis le compte, contre 365
 * sur `/v1/keys/report`. Le rapport lit `request_log` de façon synchrone : sur
 * une clé très appelée, une fenêtre d'un an bloque le service le temps de la
 * lecture, et le compte ouvre ce rapport à qui tient l'adresse. Une demande
 * plus longue est PLAFONNÉE, pas refusée : c'est déjà ce que fait
 * `/v1/keys/report` hors de ses bornes, et `report.window_days` dit la fenêtre
 * réellement servie. La page du compte demande 30 jours.
 */
export const ACCOUNT_REPORT_MAX_DAYS = 90;

/**
 * Les clés de ferme regroupées par le radar de cohortes ont leur `email` réécrit
 * en `…@cohorte.invalid`, mais gardent leur `email_norm` d'origine : sans ce
 * filtre, l'adresse inventée par la ferme verrait les clés regroupées.
 */
const NOT_A_COHORT = "email NOT LIKE '%@cohorte.invalid'";

/**
 * Une clé n'appartient à l'adresse de la session que si son `email` COURANT se
 * normalise encore en `email_norm`. Deux chemins réécrivent `email` sans toucher
 * `email_norm` : le regroupement de cohortes, et le réétiquetage manuel
 * (`/v1/admin/keys/relabel`), qui accepte n'importe quelle adresse. Sans ce
 * filtre, une clé réétiquetée vers une autre adresse resterait visible pour
 * l'adresse d'origine. Il couvre aussi les cohortes ; `NOT_A_COHORT` reste, en
 * garde explicite et gratuite.
 *
 * La normalisation (points de Gmail) ne s'écrit pas en SQLite : c'est la MÊME
 * fonction JS que celle du rattrapage de `email_norm` et de tous les chemins de
 * frappe, exposée à SQL par connexion (idiome de `registerInternalEmailFn`).
 *
 * `email = email_norm OR …` : la plupart des clés portent déjà leur adresse
 * sous forme normalisée, et la fonction n'est alors pas appelée. L'équivalence
 * est exacte : chaque requête exige aussi `email_norm = ?`, une adresse déjà
 * normalisée, et `normalizeEmail` est idempotente.
 */
const STILL_THIS_ADDRESS = '(email = email_norm OR account_email_norm(email) = email_norm)';

const SQL_FNS_REGISTERED = new WeakSet<object>();

/** La base des statistiques, avec la fonction `account_email_norm` enregistrée. */
function accountDB(): ReturnType<typeof getStatsDB> {
  const db = getStatsDB();
  if (!SQL_FNS_REGISTERED.has(db)) {
    db.function('account_email_norm', { deterministic: true }, (email: unknown) =>
      typeof email === 'string' ? normalizeEmail(email) : null,
    );
    SQL_FNS_REGISTERED.add(db);
  }
  return db;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** '2026-09-01 08:00:00' (UTC, forme de SQLite) → '2026-09-01T08:00:00Z'. */
function toIso(sqliteUtc: string | null): string | null {
  if (!sqliteUtc) return null;
  const t = sqliteUtc.replace(' ', 'T');
  return t.endsWith('Z') ? t : `${t}Z`;
}

// ─── Les codes de connexion ──────────────────────────────────────────────────

/** Tire un code à six chiffres, sans rien écrire (voir `issueLoginCode`). */
export function drawLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Enregistre (ou remplace) le code de connexion d'une adresse normalisée et le
 * rend en clair ; sans code fourni, en tire un. Seule son empreinte est gardée.
 *
 * Le remplacement remet `attempts` à zéro et invalide l'ancien code. C'est la
 * seule remise à zéro qui existe, et elle ne s'obtient qu'en passant les
 * plafonds d'envoi : la route inscrit l'envoi au registre AVANT de poster le
 * code, et n'appelle cette fonction qu'APRÈS un envoi réussi. Un envoi raté ne
 * remplace donc pas le code que la personne vient peut-être de recevoir, et ne
 * remet pas le compteur à zéro. Le tirage et la durée sont ceux du code de
 * vérification (`src/lib/key-creation-guard.ts`), constantes importées.
 */
export function issueLoginCode(emailNorm: string, code: string = drawLoginCode()): string {
  getStatsDB()
    .prepare(
      `INSERT INTO account_login_codes (email_norm, code_hash, attempts, created_at, expires_at)
         VALUES (?, ?, 0, datetime('now'), datetime('now', ?))
         ON CONFLICT(email_norm) DO UPDATE SET
           code_hash = excluded.code_hash, attempts = 0,
           created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .run(emailNorm, sha256(code), `+${VERIFICATION_TTL_MINUTES} minutes`);
  return code;
}

export type LoginCodeCheck =
  { ok: true } | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'wrong_code' };

/**
 * Vérifie un code. Le consomme en cas de succès (usage unique) ; compte l'essai
 * en cas d'échec, pour que six chiffres ne se devinent pas dans les quinze
 * minutes.
 *
 * 🚨 Le plafond d'essais se lit AVANT la comparaison : le sixième essai échoue
 * même avec le bon code, et il faut en demander un nouveau.
 *
 * La comparaison est à temps constant (`timingSafeEqual` sur deux empreintes de
 * même longueur), comme `checkVerificationCode`. La consommation est un DELETE
 * qui redit ses conditions : si un second écrivain (un script d'administration)
 * a touché la ligne entre la lecture et l'écriture, un seul consommateur gagne.
 */
export function checkLoginCode(emailNorm: string, code: string): LoginCodeCheck {
  const db = getStatsDB();
  const row = db
    .prepare(
      `SELECT code_hash, attempts, (expires_at <= datetime('now')) AS gone
         FROM account_login_codes WHERE email_norm = ?`,
    )
    .get(emailNorm) as { code_hash: string; attempts: number; gone: number } | undefined;
  if (!row) return { ok: false, reason: 'no_code' };
  if (row.gone) {
    db.prepare('DELETE FROM account_login_codes WHERE email_norm = ?').run(emailNorm);
    return { ok: false, reason: 'expired' };
  }
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const got = Buffer.from(sha256(code.trim()));
  const want = Buffer.from(row.code_hash);
  const match = got.length === want.length && timingSafeEqual(got, want);
  if (!match) {
    db.prepare('UPDATE account_login_codes SET attempts = attempts + 1 WHERE email_norm = ?').run(
      emailNorm,
    );
    return { ok: false, reason: 'wrong_code' };
  }
  const consumed = db
    .prepare(
      `DELETE FROM account_login_codes
        WHERE email_norm = ? AND code_hash = ? AND attempts < ? AND expires_at > datetime('now')`,
    )
    .run(emailNorm, row.code_hash, VERIFICATION_MAX_ATTEMPTS).changes;
  return consumed === 1 ? { ok: true } : { ok: false, reason: 'no_code' };
}

/** Oublie le code en cours d'une adresse (révocation par l'administration). */
export function forgetLoginCode(emailNorm: string): void {
  getStatsDB().prepare('DELETE FROM account_login_codes WHERE email_norm = ?').run(emailNorm);
}

// ─── Le plafond global des codes de connexion ────────────────────────────────

/**
 * Codes de vérification au plus sur l'heure glissante, toutes portes
 * confondues, au-delà desquels la connexion au compte n'envoie plus de code.
 *
 * Pourquoi : `POST /v1/account/code` n'exige aucune clé, et tous les mails
 * transactionnels partent de la MÊME boîte d'envoi, celle qui livre aussi les
 * clés payées. Les plafonds par adresse, par domaine et par réseau ne bornent
 * pas un envoi réparti sur beaucoup d'adresses et de réseaux. Le quota du
 * fournisseur est déjà un plafond global, partagé avec l'argent : mieux vaut
 * choisir que ce soit la connexion qui cède. Au-delà, la route répond 503, et
 * le repli « coller une clé » reste.
 *
 * 🚨 Compté sur le registre d'envois PARTAGÉ (`verification_sends`), qui ne
 * dit pas quelle porte a posté le code : les codes de création, de réclamation
 * et d'approbation par appareil entrent donc dans ce compte. C'est voulu (la
 * boîte est une), et seule la connexion est refusée ici : les autres portes
 * gardent leurs propres plafonds.
 */
export const ACCOUNT_CODES_GLOBAL_PER_HOUR = 30;

/** La clé de l'alerte d'exploitation du plafond, distincte de celle du relais. */
export const ACCOUNT_CODE_CEILING_ALERT = 'mail:account-code-ceiling';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Vrai si le registre d'envois a encore de la place dans l'heure glissante.
 * Le registre est purgé au-delà de deux jours à chaque envoi : le parcours
 * reste court.
 */
export function accountCodeBudgetLeft(): boolean {
  const row = getStatsDB()
    .prepare(
      "SELECT COUNT(*) AS n FROM verification_sends WHERE created_at >= datetime('now', '-1 hour')",
    )
    .get() as { n: number };
  return row.n < ACCOUNT_CODES_GLOBAL_PER_HOUR;
}

/**
 * L'état de l'alerte du plafond, tenu en mémoire : un `opsFail` au PREMIER refus
 * d'une heure, jamais un par requête ; un `opsOk` au premier code parti après
 * une heure sans refus.
 *
 * `open` vaut vrai au démarrage : l'état persisté par `ops-alert` survit à un
 * redéploiement, pas cette mémoire, et une alerte laissée ouverte sans `opsOk`
 * resterait muette au dépassement suivant (le piège que décrit
 * `reportKeyDelivered`, `src/lib/email.ts`). Le premier code parti après le
 * démarrage la referme donc, ce qui ne coûte qu'une lecture quand rien n'est
 * ouvert.
 */
const ceilingAlert = { failedAt: 0, lastRefusalAt: 0, open: true };

/** Un code refusé au plafond global. */
export function noteAccountCodeRefused(now = Date.now()): void {
  ceilingAlert.lastRefusalAt = now;
  if (now - ceilingAlert.failedAt < HOUR_MS) return;
  ceilingAlert.failedAt = now;
  ceilingAlert.open = true;
  void opsFail(
    ACCOUNT_CODE_CEILING_ALERT,
    `Account sign-in codes are paused: the shared verification mailbox reached ${ACCOUNT_CODES_GLOBAL_PER_HOUR} codes within the last hour, so the account sign-in answers 503 until the hour clears. Key deliveries are not held by this ceiling.`,
    1,
  );
}

/** Un code de connexion parti : l'alerte se ferme après une heure sans refus. */
export function noteAccountCodeSent(now = Date.now()): void {
  if (!ceilingAlert.open || now - ceilingAlert.lastRefusalAt < HOUR_MS) return;
  ceilingAlert.open = false;
  void opsOk(ACCOUNT_CODE_CEILING_ALERT, 'Account sign-in codes are leaving again.');
}

/** Pour les tests : l'état d'un processus qui vient de démarrer. */
export function resetAccountCodeCeilingAlert(): void {
  ceilingAlert.failedAt = 0;
  ceilingAlert.lastRefusalAt = 0;
  ceilingAlert.open = true;
}

// ─── Les sessions ────────────────────────────────────────────────────────────

export interface AccountSession {
  tokenHash: string;
  emailNorm: string;
  /** L'adresse saisie à la connexion, en minuscules : ce que l'écran affiche. */
  emailDisplay: string;
  /** ISO 8601, UTC. */
  expiresAt: string;
}

/**
 * Crée une session et rend le jeton en clair, UNE fois : la route le pose dans
 * le cookie et ne le garde nulle part.
 *
 * 256 bits d'aléa, tirés à chaque connexion : un jeton ne vient jamais de la
 * requête, donc aucune fixation de session n'est possible. La durée est
 * ABSOLUE (sept jours après la création), jamais prolongée par l'usage.
 */
export function createSession(
  emailNorm: string,
  emailDisplay: string,
): { token: string; expiresAt: string } {
  const token = ACCOUNT_TOKEN_PREFIX + randomBytes(32).toString('hex');
  const row = getStatsDB()
    .prepare(
      `INSERT INTO account_sessions (token_hash, email_norm, email_display, created_at, expires_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now', ?))
       RETURNING expires_at`,
    )
    .get(sha256(token), emailNorm, emailDisplay, `+${ACCOUNT_SESSION_DAYS} days`) as {
    expires_at: string;
  };
  return { token, expiresAt: toIso(row.expires_at) as string };
}

/**
 * La session que porte ce jeton, ou null : absent, mal formé, inconnu, révoqué
 * ou expiré rendent tous null, sans distinction.
 *
 * `last_seen_at` est mis à jour au plus une fois par heure, et la décision se
 * prend dans la lecture elle-même : pas d'écriture à chaque ouverture de page.
 */
export function readSession(token: string | null | undefined): AccountSession | null {
  // Un jeton fait `ifs_` + 64 caractères hexadécimaux. La borne de longueur
  // évite de hacher un cookie de plusieurs kilo-octets pour rien.
  if (!token || !token.startsWith(ACCOUNT_TOKEN_PREFIX) || token.length > 128) return null;
  const tokenHash = sha256(token);
  const db = getStatsDB();
  const row = db
    .prepare(
      `SELECT email_norm, email_display, expires_at,
              (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 hour')) AS stale
         FROM account_sessions
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')`,
    )
    .get(tokenHash) as
    { email_norm: string; email_display: string; expires_at: string; stale: number } | undefined;
  if (!row) return null;
  if (row.stale) {
    db.prepare(
      "UPDATE account_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?",
    ).run(tokenHash);
  }
  return {
    tokenHash,
    emailNorm: row.email_norm,
    emailDisplay: row.email_display,
    expiresAt: toIso(row.expires_at) as string,
  };
}

/** Révoque la session de ce jeton. Vrai si une session vivante a été révoquée. */
export function revokeSession(token: string | null | undefined): boolean {
  if (!token || !token.startsWith(ACCOUNT_TOKEN_PREFIX) || token.length > 128) return false;
  return (
    getStatsDB()
      .prepare(
        "UPDATE account_sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL",
      )
      .run(sha256(token)).changes > 0
  );
}

/**
 * Révoque toutes les sessions VIVANTES d'une adresse normalisée (« se
 * déconnecter partout », et la révocation par l'administration). Rend leur
 * nombre : une session déjà expirée n'est pas comptée, elle ne donnait plus
 * rien.
 */
export function revokeAllSessions(emailNorm: string): number {
  return getStatsDB()
    .prepare(
      `UPDATE account_sessions SET revoked_at = datetime('now')
        WHERE email_norm = ? AND revoked_at IS NULL AND expires_at > datetime('now')`,
    )
    .run(emailNorm).changes;
}

/**
 * La rétention des deux tables : codes expirés, sessions expirées ou révoquées
 * depuis plus d'un jour. Appelée au démarrage puis chaque jour
 * (`src/index.ts`). Rend le nombre de lignes retirées.
 */
export function purgeAccountTables(): number {
  const db = getStatsDB();
  const codes = db
    .prepare("DELETE FROM account_login_codes WHERE expires_at <= datetime('now')")
    .run().changes;
  const sessions = db
    .prepare(
      `DELETE FROM account_sessions
        WHERE expires_at < datetime('now', '-1 day')
           OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-1 day'))`,
    )
    .run().changes;
  return codes + sessions;
}

// ─── La vue d'ensemble ───────────────────────────────────────────────────────

export type AccountPlan = 'free' | 'custom' | 'pack' | 'pro' | 'editor';

export interface OverviewKey {
  key_prefix: string;
  created_at: string | null;
  plan: AccountPlan;
  allowance: { basis: unknown; limit: unknown; used: unknown; remaining: unknown } | null;
  credits: { remaining: number; purchased_total: number } | null;
  subscription: { plan: 'pro' | 'editor'; status: 'active'; manage_url: string } | null;
  calls_this_month: number;
  last_call_at: string | null;
  alerts: Array<{ kind: 'quota_80' | 'credits_low'; sent_at: string | null }>;
  actions: {
    topup: string | null;
    subscribe_pro: string | null;
    manage_subscription: string | null;
  };
}

export interface AccountOverview {
  email: string;
  session_expires_at: string;
  month: string;
  page: number;
  pages: number;
  keys: OverviewKey[];
  inactive_keys: number;
}

/** Le bloc d'usage d'une clé, tel que `/v1/keys/usage` le sert (`usageBlock`). */
export type UsageBuilder = (v: ApiKeyValidation) => Record<string, unknown>;

type KeyRow = ApiKeyValidationRow & {
  key_hash: string;
  key_prefix: string;
  created_at: string | null;
  stripe_subscription_id: string | null;
};

type OverviewRow = KeyRow & { last_call_at: string | null };

/**
 * La formule d'une clé, lue sur ses colonnes. Une clé à crédits est un pack ;
 * un abonnement est Pro, ou éditeur à partir du plafond OEM ; sinon, une
 * allocation propre au plus égale au palier gratuit est gratuite, et une
 * allocation relevée sans abonnement est « sur mesure ».
 */
function planOf(row: KeyRow): AccountPlan {
  if (row.credits_remaining !== null) return 'pack';
  if (row.stripe_subscription_id) {
    return (row.monthly_limit ?? 0) >= OEM_MONTHLY_LIMIT ? 'editor' : 'pro';
  }
  return (row.monthly_limit ?? FREE_TIER_MONTHLY_LIMIT) <= FREE_TIER_MONTHLY_LIMIT
    ? 'free'
    : 'custom';
}

/**
 * Tout ce que la page du compte montre pour une session : les clés ACTIVES de
 * l'adresse normalisée, hors clés regroupées en cohorte ou réétiquetées vers
 * une autre adresse (`STILL_THIS_ADDRESS`), cinquante par page, le dernier
 * appel d'abord. Les deux comptes (pages, clés désactivées) suivent le même
 * filtre.
 *
 * `usageOf` est le constructeur du bloc d'usage de `/v1/keys/usage`, passé par
 * la route plutôt qu'importé : il vit dans `src/routes/api-keys.ts`, et un
 * module de `lib/` n'importe pas une route. `allowance` en reprend quatre champs
 * sur une validation construite par `validationFromRow` : un chiffre ne peut
 * donc pas différer entre la clé collée et la clé vue depuis le compte.
 *
 * 🚨 `request_log` n'est lu qu'UNE fois par page, dans la requête des clés
 * elle-même : le dernier appel de chaque clé est une sous-requête qui descend
 * l'index `idx_request_log_key_prefix` par la fin (`ORDER BY id DESC LIMIT 1`,
 * l'identifiant croît avec l'heure d'écriture). Une adresse d'éditeur qui porte
 * des dizaines de clés coûte ainsi une recherche d'index par clé, jamais un
 * parcours de ses millions de lignes. Le rapport détaillé d'une clé, lui, se
 * charge à la demande (`findOwnedKey` puis `getKeyReport`).
 *
 * Le `+` de `+active = 1` est voulu : il interdit à SQLite de prendre l'index
 * `idx_api_keys_active` pour ce terme. Mesuré sur une base sans statistiques
 * ANALYZE (le service n'en lance jamais) : sans lui, le planificateur choisissait
 * cet index, presque toutes les clés étant actives, et parcourait donc toute la
 * table à chaque ouverture de la page ; avec lui, il descend
 * `idx_api_keys_email_norm`, quelques lignes par adresse.
 *
 * Jamais servis : la clé brute, `key_hash`, `lineage_hash`, les empreintes
 * d'adresse IP, `no_recredit`, `shield_episode`, `issued_by_us`, et aucune clé
 * d'une autre adresse normalisée. La requête ne sélectionne que ce qu'elle
 * rend, plus `key_hash`, qui ne sert qu'aux jointures et ne sort pas d'ici.
 */
export function buildOverview(
  session: AccountSession,
  page: number,
  usageOf: UsageBuilder,
): AccountOverview {
  const db = accountDB();
  const counts = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS live,
              COALESCE(SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END), 0) AS dead
         FROM api_keys WHERE email_norm = ? AND ${NOT_A_COHORT} AND ${STILL_THIS_ADDRESS}`,
    )
    .get(session.emailNorm) as { live: number; dead: number };
  const pages = Math.max(1, Math.ceil(counts.live / OVERVIEW_PAGE_SIZE));
  const month = new Date().toISOString().slice(0, 7);

  const rows = db
    .prepare(
      `SELECT key_hash, key_prefix, created_at, stripe_subscription_id, ${API_KEY_VALIDATION_COLUMNS},
              (SELECT r.created_at FROM request_log r
                WHERE r.key_prefix = api_keys.key_prefix
                ORDER BY r.id DESC LIMIT 1) AS last_call_at
         FROM api_keys
        WHERE email_norm = ? AND +active = 1 AND ${NOT_A_COHORT} AND ${STILL_THIS_ADDRESS}
        ORDER BY last_call_at IS NULL, last_call_at DESC, created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(session.emailNorm, OVERVIEW_PAGE_SIZE, (page - 1) * OVERVIEW_PAGE_SIZE) as OverviewRow[];

  const hashes = rows.map((r) => r.key_hash);
  const monthCalls = new Map<string, number>();
  const alerts = new Map<string, OverviewKey['alerts']>();
  if (hashes.length > 0) {
    const marks = hashes.map(() => '?').join(',');
    for (const u of db
      .prepare(`SELECT key_hash, count FROM api_usage WHERE month = ? AND key_hash IN (${marks})`)
      .all(month, ...hashes) as Array<{ key_hash: string; count: number }>) {
      monthCalls.set(u.key_hash, u.count);
    }
    // Deux familles de lignes dans `quota_notices` : un mois « AAAA-MM » est
    // l'alerte des 80 % d'une allocation mensuelle ; `credits-<total>` est
    // celle des 10 % restants d'un pack. Toute autre forme n'est pas montrée.
    for (const n of db
      .prepare(
        `SELECT key_hash, month, sent_at FROM quota_notices
          WHERE key_hash IN (${marks}) ORDER BY sent_at DESC`,
      )
      .all(...hashes) as Array<{ key_hash: string; month: string; sent_at: string | null }>) {
      const kind = /^\d{4}-\d{2}$/.test(n.month)
        ? 'quota_80'
        : n.month.startsWith(CREDITS_NOTICE_LOCK_PREFIX)
          ? 'credits_low'
          : null;
      if (!kind) continue;
      const list = alerts.get(n.key_hash) ?? [];
      list.push({ kind, sent_at: toIso(n.sent_at) });
      alerts.set(n.key_hash, list);
    }
  }

  const keys = rows.map((row): OverviewKey => {
    const plan = planOf(row);
    const block = usageOf(validationFromRow(row.key_hash, row));
    const isCreditKey = row.credits_remaining !== null;
    const subscription =
      plan === 'pro' || plan === 'editor'
        ? { plan, status: 'active' as const, manage_url: PRO_PORTAL_URL }
        : null;
    return {
      key_prefix: row.key_prefix,
      created_at: toIso(row.created_at),
      plan,
      // Une clé à crédits n'a pas d'allocation propre : son `limit` n'est
      // opposé à rien (basis « credits »), et le montrer ferait lire un plafond
      // qui n'existe pas. Son solde est dans `credits`.
      allowance: isCreditKey
        ? null
        : {
            basis: block.basis,
            limit: block.limit,
            used: block.used,
            remaining: block.remaining,
          },
      credits: isCreditKey
        ? { remaining: row.credits_remaining as number, purchased_total: row.credits_total ?? 0 }
        : null,
      subscription,
      calls_this_month: monthCalls.get(row.key_hash) ?? 0,
      last_call_at: toIso(row.last_call_at),
      alerts: alerts.get(row.key_hash) ?? [],
      // `topup` attend le lot B1 et `subscribe_pro` le lot B2 : null jusque-là.
      // Le portail Stripe, lui, existe déjà : c'est une page de connexion par
      // e-mail, sans secret.
      actions: {
        topup: null,
        subscribe_pro: null,
        manage_subscription: subscription ? PRO_PORTAL_URL : null,
      },
    };
  });

  return {
    email: session.emailDisplay,
    session_expires_at: session.expiresAt,
    month,
    page,
    pages,
    keys,
    inactive_keys: counts.dead,
  };
}

/**
 * La clé ACTIVE de ce préfixe, si elle appartient à l'adresse de la session ;
 * null sinon, que le préfixe soit inconnu, désactivé, regroupé en cohorte,
 * réétiqueté ou à une autre adresse. Une seule requête dans tous les cas : la
 * route rend le
 * même 404, dans le même temps, pour un préfixe inconnu et pour celui d'un
 * autre.
 */
export function findOwnedKey(
  emailNorm: string,
  keyPrefix: string,
): { keyPrefix: string; validation: ApiKeyValidation } | null {
  const row = accountDB()
    .prepare(
      `SELECT key_hash, key_prefix, ${API_KEY_VALIDATION_COLUMNS}
         FROM api_keys
        WHERE key_prefix = ? AND email_norm = ? AND active = 1 AND ${NOT_A_COHORT}
          AND ${STILL_THIS_ADDRESS}
        LIMIT 1`,
    )
    .get(keyPrefix, emailNorm) as
    (ApiKeyValidationRow & { key_hash: string; key_prefix: string }) | undefined;
  if (!row) return null;
  return { keyPrefix: row.key_prefix, validation: validationFromRow(row.key_hash, row) };
}
