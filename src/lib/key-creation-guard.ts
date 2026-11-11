import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getStatsDB } from './db.js';
import { normalizeEmail } from './email-norm.js';
import { opsFail, opsOk } from './ops-alert.js';
import { hashIp } from './stats.js';

/**
 * Free-key creation guard.
 *
 * 2026-08-17: one script created a burst of free keys within seconds from a
 * single IP (invented gmail addresses) and consumed more than half of all the
 * free usage ever served. The per-EMAIL limit (one key per address per day) was
 * useless against invented addresses; this guard counts per NETWORK instead.
 *
 * Two thresholds, one table:
 *  - hard cap: at most DAILY_KEY_CREATION_LIMIT keys per source per 24h;
 *  - identity step: from the SECOND key within VERIFY_WINDOW_DAYS, the caller
 *    must prove it can read the mailbox (6-digit code sent by mail). The
 *    FIRST key stays one-step — instant activation is the product bet, we
 *    only tax the multiplication.
 *
 * The "source" is the salted IP hash the stats pipeline already uses —
 * IPv6 collapsed to its /64 first (one subscriber = one /64; counting full
 * addresses would hand every IPv6 caller millions of free identities).
 * No raw IP ever touches disk here either.
 *
 * ── Ce que le chantier « clé sans e-mail » ajoute (lot 3, 15/09/2026) ────────
 *
 * Le palier ANONYME n'est PAS gardé par ce mécanisme : il n'y a pas de boîte à
 * prouver, donc le pas d'identité n'a aucun objet sur cette branche. Ce qui le
 * tient est le disjoncteur global de créations, ailleurs. Seul le plafond par
 * réseau (DAILY_KEY_CREATION_LIMIT) vaut pour les deux branches.
 *
 * Le même code à 6 chiffres sert désormais DEUX chemins : créer une clé
 * (/v1/keys/generate) et en réclamer une (/v1/keys/claim). D'où la cible
 * `keyPrefix` portée par le défi : sans elle, un code émis pour créer était
 * consommable pour réclamer, et l'inverse.
 *
 * 🚨 Et l'ORDRE des quatre gestes d'un envoi est une contrainte du contrat, pas
 * un détail : plafond d'envoi, enregistrement de l'envoi, création du défi,
 * puis envoi réel. `createVerificationChallenge` remet `attempts` à zéro par
 * son ON CONFLICT — réémettre un défi EST la remise à zéro du compteur
 * d'essais, seul rempart contre la force brute des six chiffres. Créer le défi
 * avant de mesurer l'envoi offrirait des remises à zéro gratuites.
 */

export const DAILY_KEY_CREATION_LIMIT = 3;
export const VERIFY_WINDOW_DAYS = 7;
export const VERIFICATION_TTL_MINUTES = 15;
export const VERIFICATION_MAX_ATTEMPTS = 5;

/**
 * Verification codes are mailed to an address the CALLER supplies, so the send
 * path is a mail-bombing vector: the daily key-creation cap only counts
 * SUCCESSFUL creations (recordKeyCreation), while a code is mailed on the
 * challenge branch that returns 403 before ever creating a key. So the send is
 * bounded here instead, on its own append-only ledger:
 *   - per RECIPIENT: nobody needs a 4th code in a day — this kills targeting
 *     one victim's inbox;
 *   - per SOURCE: generous enough for a shared NAT (an office/university sits
 *     behind one public IP) yet a hard ceiling on a distributed spray.
 */
/**
 * Codes envoyés à UNE adresse depuis UN réseau, par 24 h.
 *
 * 🚨 Compté par (adresse, réseau) et non par adresse seule depuis le 15/09/2026
 * (revue adversariale, lentille empoisonnement, constat P4) : compté par
 * adresse seule, ce plafond était l'ARME — un tiers muni de n'importe quelle
 * clé anonyme postait trois codes vers l'adresse d'une victime, et celle-ci ne
 * pouvait plus recevoir de code pendant 24 h, ni pour créer ni pour réclamer.
 * Par (adresse, réseau), le tiers ne brûle que son propre créneau.
 */
export const VERIFICATION_SENDS_PER_EMAIL_DAY = 3;
/**
 * Codes envoyés à UNE adresse, tous réseaux confondus, par 24 h : la garde
 * anti-bombardement qui reste quand la précédente est partagée par réseau.
 */
export const VERIFICATION_SENDS_PER_EMAIL_DAY_TOTAL = 6;
export const VERIFICATION_SENDS_PER_SOURCE_DAY = 15;
/**
 * Codes envoyés vers UN domaine de destinataire, tous réseaux et toutes
 * adresses confondus, par 24 h — sauf les fournisseurs de boîtes publics.
 *
 * Deux motifs (revue du 15/09, lentille contournement, constats R1/R2 et R9) :
 * un domaine « attrape-tout » rend le code à six chiffres gratuit et illimité,
 * donc la preuve de boîte ne coûte plus rien à une ferme qui dépense un nom de
 * domaine ; et chaque code est un message sortant de notre relais, celui qui a
 * été bloqué pour spam le 02/09 après des envois en série vers un même domaine.
 * Vingt par jour couvre une entreprise entière ; un domaine qui en demande plus
 * en un jour n'est pas une entreprise.
 */
export const VERIFICATION_SENDS_PER_DOMAIN_DAY = 20;

/**
 * Les domaines où des inconnus sans rapport partagent un même nom : jamais
 * comptés par domaine, sinon le vingt-et-unième utilisateur de gmail.com de la
 * journée serait refusé pour ce que vingt autres ont fait.
 */
export const PUBLIC_MAILBOX_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.ch',
  'live.com',
  'live.fr',
  'msn.com',
  'yahoo.com',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'gmx.de',
  'gmx.net',
  'gmx.ch',
  'gmx.at',
  'gmx.com',
  'web.de',
  't-online.de',
  'bluewin.ch',
  'sunrise.ch',
  'hispeed.ch',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'sfr.fr',
  'laposte.net',
  'aol.com',
  'zoho.com',
  'fastmail.com',
  'tutanota.com',
  'tuta.io',
  'posteo.de',
  'mail.com',
  'qq.com',
  '163.com',
]);

/**
 * Plafond de RÉCLAMATIONS RÉUSSIES par réseau et par 24 h.
 *
 * Volontairement égal à DAILY_KEY_CREATION_LIMIT, et non un chiffre à part :
 * le critère d'acceptation de POST /v1/keys/claim est la parité avec
 * /v1/keys/generate, pas un réglage indépendant qui dériverait le jour où l'un
 * des deux bouge. Sans lui, le seul plafond de réseau applicable à la
 * réclamation était celui des ENVOIS de code (VERIFICATION_SENDS_PER_SOURCE_DAY),
 * cinq fois plus généreux — et sur l'axe exact que les deux fermes d'août ont
 * payé, la diversité d'adresses. VERIFICATION_SENDS_PER_EMAIL_DAY ne rattrape
 * rien : il compte par destinataire, donc il est inopérant devant un domaine
 * qui accepte tout.
 *
 * 🚨 Il compte des SUCCÈS, pas des tentatives : un code faux ne consomme pas le
 * budget, sinon un tiers derrière le même NAT épuiserait celui d'un bureau
 * entier.
 */
export const CLAIM_SUCCESS_PER_SOURCE_DAY = DAILY_KEY_CREATION_LIMIT;

/**
 * Fenêtre pendant laquelle un défi en cours n'est pas écrasé par un défi qui
 * vise une AUTRE clé : le temps que son destinataire recopie ses six chiffres.
 *
 * Deux minutes et non quinze (la durée de vie du défi) parce que refuser tout
 * écrasement créerait un verrou : n'importe quel porteur d'une clé anonyme
 * tiendrait une adresse bloquée pendant toute la durée de vie du code. Le
 * verrou plafonne donc à deux minutes, et au-delà l'écrasement reprend le
 * comportement actuel, octet pour octet.
 */
export const CHALLENGE_GRACE_MINUTES = 2;

/**
 * Collapse an IPv6 address to its /64 prefix; IPv4 passes through.
 *
 * The point of the /64 is that a residential IPv6 customer is handed a whole
 * prefix and can pick a new address inside it for free — so the cap has to
 * count the prefix, not the address. Until 2026-09-01 the compressed groups
 * were merely DROPPED before taking the first four, which broke that in both
 * directions: `2001:db8::1` and `2001:db8::2` are the same /64 and landed in
 * two different buckets, and the same machine changed bucket depending on
 * whether it wrote its address compressed or in full (SEC-05, audit
 * 2026-09-01). Expanding "::" back to the zero groups it stands for, then
 * writing each hextet one canonical way, gives one bucket per /64 and one form
 * per machine.
 *
 * The counters restart once after this ships: the bucket keys change shape.
 */
export function normalizeIpForGuard(ip: string): string {
  if (!ip.includes(':')) return ip;
  // Zone index (fe80::1%eth0) identifies a local interface, never the peer.
  const bare = ip.split('%')[0].trim().toLowerCase();
  // ::ffff:192.0.2.1 is an IPv4 client wearing an IPv6 hat — the form Node
  // itself hands out on a dual-stack socket. Its first four hextets are zeros
  // for EVERY such address, so expanding it would drop every IPv4 caller into
  // one shared bucket and turn a per-source cap into a global one. Bucket it on
  // the address that actually identifies the machine.
  const lastGroup = bare.slice(bare.lastIndexOf(':') + 1);
  if (lastGroup.includes('.')) return lastGroup;
  const at = bare.indexOf('::');
  let groups: string[];
  if (at === -1) {
    groups = bare.split(':');
  } else {
    const head = bare.slice(0, at) ? bare.slice(0, at).split(':') : [];
    const tail = bare.slice(at + 2) ? bare.slice(at + 2).split(':') : [];
    const missing = Math.max(0, 8 - head.length - tail.length);
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  }
  // Leading zeros stripped rather than padded (RFC 5952's canonical text), so
  // `2001:0db8:…` and `2001:db8:…` are one bucket and the keys already in the
  // table keep the shape they have.
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}

/** Salted hash of the guard-normalized source. null when the IP is unknown. */
export function keyCreationSource(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return hashIp(normalizeIpForGuard(ip));
}

/** How many keys this source created in the last `hours` hours. */
export function countKeyCreations(source: string, hours: number): number {
  const row = getStatsDB()
    .prepare(
      "SELECT COUNT(*) AS n FROM key_creations WHERE ip_hash = ? AND created_at >= datetime('now', ?)",
    )
    .get(source, `-${hours} hours`) as { n: number };
  return row.n;
}

/**
 * Record a successful creation; opportunistically prune rows older than 30 days.
 * `userAgent` (the client library string) and `keyPrefix` (the minted key) are
 * captured so the same automated client rotating its network address can still
 * be linked into one cohort by its stable library string, and a matched cohort
 * traced back to its keys. Both default to null (older call sites, tests).
 */
export function recordKeyCreation(
  source: string,
  userAgent: string | null = null,
  keyPrefix: string | null = null,
): void {
  const db = getStatsDB();
  db.prepare('INSERT INTO key_creations (ip_hash, user_agent, key_prefix) VALUES (?, ?, ?)').run(
    source,
    userAgent ? userAgent.slice(0, 256) : null,
    keyPrefix ?? null,
  );
  db.prepare("DELETE FROM key_creations WHERE created_at < datetime('now', '-30 days')").run();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * La forme sur laquelle le budget d'envoi se compte.
 *
 * Hachée NORMALISÉE (étiquette après « + » retirée, points retirés chez les
 * deux domaines qui les ignorent) : sans cela `you+1@`, `you+2@` et `y.o.u@`
 * sont trois destinataires pour le compteur et une seule boîte pour leur
 * porteur, donc le plafond par destinataire se multiplie à volonté. Pour une
 * adresse sans étiquette et hors de ces domaines, la valeur hachée est
 * identique à celle d'avant : non-régression stricte.
 *
 * Repli sur la chaîne brute mise en minuscules quand la normalisation rend null
 * (pas d'arobase) : ce n'est pas une adresse, mais le compteur doit quand même
 * compter quelque chose de stable plutôt que de jeter.
 */
function sendBudgetKey(email: string): string {
  return sha256(normalizeEmail(email) ?? email.trim().toLowerCase());
}

/**
 * La forme sur laquelle le budget par DOMAINE se compte : le domaine haché, ou
 * null pour un fournisseur public (jamais compté) et pour une chaîne sans
 * arobase (rien à compter).
 */
export function domainBudgetKey(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain || PUBLIC_MAILBOX_DOMAINS.has(domain)) return null;
  return sha256(domain);
}

/**
 * May we mail a verification code for this (source, recipient) right now?
 * Both windows are 24h. Returns the reason so the caller can answer precisely.
 */
export type ChallengeSendCheck =
  { ok: true } | { ok: false; reason: 'recipient' | 'source' | 'domain' };
export function challengeSendAllowed(source: string | null, email: string): ChallengeSendCheck {
  const db = getStatsDB();
  const emailKey = sendBudgetKey(email);
  const toEmail = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM verification_sends WHERE email_hash = ? AND created_at >= datetime('now', '-24 hours')",
      )
      .get(emailKey) as { n: number }
  ).n;
  if (toEmail >= VERIFICATION_SENDS_PER_EMAIL_DAY_TOTAL) return { ok: false, reason: 'recipient' };
  // Le créneau (adresse, réseau). Sans réseau connu, l'ancien plafond par
  // adresse seule reprend : fermé, jamais ouvert, quand on ne sait pas d'où ça vient.
  const toEmailFromHere = source
    ? (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM verification_sends WHERE email_hash = ? AND ip_hash = ? AND created_at >= datetime('now', '-24 hours')",
          )
          .get(emailKey, source) as { n: number }
      ).n
    : toEmail;
  if (toEmailFromHere >= VERIFICATION_SENDS_PER_EMAIL_DAY)
    return { ok: false, reason: 'recipient' };
  const domainKey = domainBudgetKey(email);
  if (domainKey) {
    const toDomain = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM verification_sends WHERE domain_hash = ? AND created_at >= datetime('now', '-24 hours')",
        )
        .get(domainKey) as { n: number }
    ).n;
    if (toDomain >= VERIFICATION_SENDS_PER_DOMAIN_DAY) return { ok: false, reason: 'domain' };
  }
  // A null source (unknown IP) cannot be rate-limited by source, only by
  // recipient — same fail-open stance as the creation guard. In prod Railway
  // always supplies the IP, so source is never null there.
  if (source) {
    const fromSource = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM verification_sends WHERE ip_hash = ? AND created_at >= datetime('now', '-24 hours')",
        )
        .get(source) as { n: number }
    ).n;
    if (fromSource >= VERIFICATION_SENDS_PER_SOURCE_DAY) return { ok: false, reason: 'source' };
  }
  return { ok: true };
}

/**
 * Log a code send (append-only) and opportunistically purge: old send rows
 * (past the 24h counting window) and expired pending challenges, so neither
 * table grows without bound between the daily retention runs.
 */
export function recordVerificationSend(source: string | null, email: string): number {
  const db = getStatsDB();
  const info = db
    .prepare('INSERT INTO verification_sends (ip_hash, email_hash, domain_hash) VALUES (?, ?, ?)')
    .run(source, sendBudgetKey(email), domainBudgetKey(email));
  db.prepare("DELETE FROM verification_sends WHERE created_at < datetime('now', '-2 days')").run();
  db.prepare("DELETE FROM pending_verifications WHERE expires_at < datetime('now')").run();
  return Number(info.lastInsertRowid);
}

/**
 * Record what the relay did with a verification code.
 *
 * `accepted` is what the relay said, not what the mailbox did: a 200 means
 * queued, and the hard bounce arrives later by a path nothing here can see.
 * Recording it anyway is the difference between a failure rate we can watch
 * and the silence that let three days of bounces go uncounted.
 */
export function markVerificationOutcome(id: number, accepted: boolean): void {
  if (!Number.isFinite(id) || id <= 0) return;
  getStatsDB()
    .prepare('UPDATE verification_sends SET relay_accepted = ? WHERE id = ?')
    .run(accepted ? 1 : 0, id);
}

export interface VerificationDelivery {
  window_hours: number;
  attempted: number;
  refused: number;
  /** Share refused by the relay, 0..1. `null` when nothing was attempted. */
  refused_ratio: number | null;
}

/**
 * How the verification channel is doing, over the last `hours`.
 *
 * Rows with a NULL outcome are counted as attempted but never as refused:
 * an unknown outcome is not a success and not a failure, and inventing either
 * would be the same mistake as calling a relay 200 a delivery.
 */
export function verificationDelivery(hours = 24): VerificationDelivery {
  const row = getStatsDB()
    .prepare(
      `SELECT COUNT(*) attempted,
              SUM(CASE WHEN relay_accepted = 0 THEN 1 ELSE 0 END) refused
         FROM verification_sends
        WHERE created_at >= datetime('now', ?)`,
    )
    .get(`-${hours} hours`) as { attempted: number; refused: number | null };
  const attempted = row?.attempted ?? 0;
  const refused = row?.refused ?? 0;
  return {
    window_hours: hours,
    attempted,
    refused,
    refused_ratio: attempted === 0 ? null : refused / attempted,
  };
}

/**
 * Retention backstop for the two verification tables, in case no send happens
 * to trigger the opportunistic purge above. Called from the daily cron.
 * Returns the number of rows removed.
 */
export function purgeExpiredVerifications(): number {
  const db = getStatsDB();
  const a = db
    .prepare("DELETE FROM verification_sends WHERE created_at < datetime('now', '-2 days')")
    .run().changes;
  const b = db
    .prepare("DELETE FROM pending_verifications WHERE expires_at < datetime('now')")
    .run().changes;
  const c = freeKeyMailDB()
    .prepare("DELETE FROM free_key_mail_sends WHERE created_at < datetime('now', '-2 days')")
    .run().changes;
  return a + b + c;
}

/**
 * Issue (or replace) the verification challenge for this address and return
 * the plain code — the CALLER mails it; only the hash is stored.
 *
 * `keyPrefix` dit à QUOI le code sert. null (ou absent) = défi du chemin de
 * CRÉATION, comportement inchangé octet pour octet pour tous les appels
 * existants ; sinon la clé qu'un défi de RÉCLAMATION vise. Sans cette cible,
 * la clé primaire de la table étant l'adresse seule, un code émis pour créer
 * une clé serait consommable pour en réclamer une autre.
 *
 * Retour `string | { refused: 'in_flight' }` et non un objet dans les deux
 * cas : la forme heureuse reste la chaîne que trois appelants consomment déjà
 * telle quelle, et seul le refus se distingue (`typeof r === 'string'`).
 */
export function createVerificationChallenge(
  email: string,
  source: string | null,
  keyPrefix?: string | null,
): string | { refused: 'in_flight' } {
  const db = getStatsDB();
  const target = keyPrefix ?? null;
  // Un défi vivant qui vise une AUTRE cible et a moins de CHALLENGE_GRACE_MINUTES
  // n'est pas écrasé : son destinataire est peut-être en train de recopier ses
  // six chiffres, et sur /claim l'écrasement est infligé par un TIERS (toute
  // clé anonyme permet de demander un code vers n'importe quelle adresse).
  const live = db
    .prepare(
      `SELECT key_prefix, (created_at >= datetime('now', ?)) AS fresh
         FROM pending_verifications
        WHERE email = ? AND expires_at > datetime('now')`,
    )
    .get(`-${CHALLENGE_GRACE_MINUTES} minutes`, email) as
    { key_prefix: string | null; fresh: number } | undefined;
  if (live && live.fresh === 1 && (live.key_prefix ?? null) !== target) {
    return { refused: 'in_flight' };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(
    // key_prefix est dans le DO UPDATE aussi : sans cela un défi de réclamation
    // qui remplace un défi de création garderait l'ancienne cible.
    `INSERT INTO pending_verifications (email, code_hash, ip_hash, attempts, created_at, expires_at, key_prefix)
       VALUES (?, ?, ?, 0, datetime('now'), datetime('now', ?), ?)
       ON CONFLICT(email) DO UPDATE SET
         code_hash = excluded.code_hash, ip_hash = excluded.ip_hash,
         attempts = 0, created_at = excluded.created_at, expires_at = excluded.expires_at,
         key_prefix = excluded.key_prefix`,
  ).run(email, sha256(code), source, `+${VERIFICATION_TTL_MINUTES} minutes`, target);
  return code;
}

export type VerificationCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'no_challenge' | 'expired' | 'too_many_attempts' | 'wrong_code' | 'wrong_target';
    };

/**
 * Check a submitted code. Deletes the challenge on success; counts attempts
 * on failure so the 6 digits cannot be brute-forced within the TTL.
 *
 * `expectKeyPrefix` est la cible attendue : absente ou null pour le chemin de
 * création (non-régression stricte), le préfixe de la clé présentée pour une
 * réclamation.
 */
export function checkVerificationCode(
  email: string,
  code: string,
  expectKeyPrefix?: string | null,
): VerificationCheck {
  const db = getStatsDB();
  const row = db
    .prepare(
      'SELECT code_hash, attempts, expires_at, key_prefix FROM pending_verifications WHERE email = ?',
    )
    .get(email) as
    | { code_hash: string; attempts: number; expires_at: string; key_prefix: string | null }
    | undefined;
  if (!row) return { ok: false, reason: 'no_challenge' };

  const expired = db.prepare("SELECT datetime('now') > ? AS gone").get(row.expires_at) as {
    gone: number;
  };
  if (expired.gone) {
    db.prepare('DELETE FROM pending_verifications WHERE email = ?').run(email);
    return { ok: false, reason: 'expired' };
  }
  // 🚨 La mauvaise cible n'incrémente PAS `attempts`. Le compteur vit sur une
  // ligne clée par l'ADRESSE seule : un tiers muni d'une clé anonyme postait
  // cinq codes bidon visant l'adresse d'une victime, chacun comptant un essai,
  // et bloquait le défi en cours de celle-ci jusqu'à expiration. La cible
  // présentée ne prouve rien sur le code : la compter comme un essai punit la
  // victime, pas l'attaquant. L'anti-oracle est préservé autrement — même
  // raison HTTP et même texte que `wrong_code`.
  if ((row.key_prefix ?? null) !== (expectKeyPrefix ?? null)) {
    return { ok: false, reason: 'wrong_target' };
  }
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const got = Buffer.from(sha256(code.trim()));
  const want = Buffer.from(row.code_hash);
  const match = got.length === want.length && timingSafeEqual(got, want);
  if (!match) {
    db.prepare('UPDATE pending_verifications SET attempts = attempts + 1 WHERE email = ?').run(
      email,
    );
    return { ok: false, reason: 'wrong_code' };
  }
  db.prepare('DELETE FROM pending_verifications WHERE email = ?').run(email);
  return { ok: true };
}

// ─── Les plafonds globaux des mails déclenchés sans compte (C12, 10.11.2026) ─

/**
 * Deux plafonds GLOBAUX sur les mails que n'importe qui peut faire partir sans
 * compte ni paiement : les codes de vérification de TOUTES les portes
 * (création, réclamation, approbation par appareil et connexion au compte, qui
 * s'inscrivent toutes à `verification_sends`) et le mail de clé gratuite de
 * `POST /v1/keys/generate` (inscrit à `free_key_mail_sends`, ci-dessous). Les
 * deux lisent le même registre, l'un sur l'heure glissante, l'autre sur
 * 24 heures glissantes ; un mail ne part que s'il reste de la place dans les
 * deux.
 *
 * Pourquoi (SEC-06, audit du 10.11.2026) : les plafonds par destinataire, par
 * réseau et par domaine ne bornent pas un envoi réparti sur beaucoup d'adresses
 * et de réseaux, et la première clé d'un réseau part avec son mail sans aucune
 * preuve de boîte. Tous ces mails partent de la MÊME boîte d'envoi que les clés
 * payées, et le vrai dégât est le blocage de cette boîte par son fournisseur :
 * pour des rebonds en série (02/09/2026), ou parce qu'elle a épuisé la limite
 * d'envoi qu'il lui compte sur 24 heures glissantes. Au-delà de l'un ou l'autre
 * plafond, ce sont donc les mails des inconnus qui cèdent : la clé gratuite est
 * rendue sans son mail, une demande de code répond 503 avec `Retry-After`. La
 * livraison d'une clé PAYÉE ne lit ni n'écrit ces compteurs.
 *
 * La connexion au compte entre dans les deux comptes (même registre) mais n'est
 * bloquée par aucun des deux : ses deux plafonds PROPRES la bornent, celui de
 * l'heure, plus bas (`ACCOUNT_CODES_GLOBAL_PER_HOUR`), et celui de la journée,
 * compté sur ses seuls codes (`ACCOUNT_CODES_PER_DAY`, tous deux dans
 * `src/lib/account.ts`). 🚨 Sa route ne doit PAS lire `unauthenticatedMailAllowed` :
 * un inconnu fermerait alors la page du compte à tous les clients en épuisant ce
 * budget commun par une autre porte (C14, 11.11.2026).
 */

/**
 * Le plafond HORAIRE : la borne de rafale. Deux fois le plafond des codes de
 * connexion, qui se compte sur le même registre et doit rester le plus bas des
 * deux pour que la connexion cède la première (un test tient cet ordre ;
 * l'importer ici ferait un cycle, le module du compte important celui-ci).
 * Assez large pour qu'une heure de lancement ne coupe pas l'inscription (au
 * pire, la première clé d'un réseau est rendue sans son mail), assez bas pour
 * qu'une seule heure au plafond ne consomme pas à elle seule le plafond de la
 * journée.
 */
export const UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR = 60;

/**
 * Le plafond sur 24 HEURES : la borne de ce que la boîte d'envoi peut perdre.
 * Il reste sous la plus petite limite d'envoi sur 24 heures glissantes que le
 * fournisseur publie par boîte, en gardant une marge pour ce qui ne doit
 * jamais attendre : les clés PAYÉES et le courrier de l'exploitant, qui partent
 * de la même boîte. Le relever n'a de sens qu'après avoir vérifié la limite
 * réelle de la boîte.
 */
export const UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY = 150;

/** Les variables qui remplacent les défauts, lues à chaque appel comme les interrupteurs du dépôt. */
export const UNAUTHENTICATED_MAILS_PER_HOUR_ENV = 'UNAUTHENTICATED_MAILS_PER_HOUR';
export const UNAUTHENTICATED_MAILS_PER_DAY_ENV = 'UNAUTHENTICATED_MAILS_PER_DAY';

/** Une alerte par plafond, distinctes de celles du relais et de la connexion. */
export const UNAUTHENTICATED_MAIL_HOURLY_ALERT = 'mail:unauthenticated-ceiling:hour';
export const UNAUTHENTICATED_MAIL_DAILY_ALERT = 'mail:unauthenticated-ceiling:day';

/**
 * Seul un entier strictement positif remplace le défaut : une variable absente,
 * vide, décimale, nulle, négative ou mal tapée le garde, pour qu'une faute de
 * frappe ne lève pas le plafond et ne ferme pas la porte non plus. Exportée pour
 * le plafond journalier de la connexion (`src/lib/account.ts`), qui suit la
 * même règle.
 */
export function ceilingFromEnv(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/** Le plafond horaire en vigueur. */
export function unauthenticatedMailsPerHour(): number {
  return ceilingFromEnv(UNAUTHENTICATED_MAILS_PER_HOUR_ENV, UNAUTHENTICATED_MAILS_GLOBAL_PER_HOUR);
}

/** Le plafond sur 24 heures en vigueur. */
export function unauthenticatedMailsPerDay(): number {
  return ceilingFromEnv(UNAUTHENTICATED_MAILS_PER_DAY_ENV, UNAUTHENTICATED_MAILS_GLOBAL_PER_DAY);
}

/** Le niveau où l'alerte d'un plafond part, AVANT tout refus : sa moitié. */
export function unauthenticatedMailWarnAt(limit: number): number {
  return Math.ceil(limit / 2);
}

/**
 * Le registre des mails de clé gratuite : une date, rien d'autre. Un compte
 * global n'a besoin ni de l'adresse ni du réseau, donc il n'en garde aucun.
 *
 * Une table à part, et non une ligne de plus dans `verification_sends` : ce
 * registre-là nourrit les plafonds par destinataire, par réseau et par domaine
 * des CODES, le plafond de la connexion et le taux de refus du relais, que le
 * mail de clé fausserait tous les trois. Créée ici au premier usage (idiome de
 * `ensureAliasTable`), purgée au-delà de deux jours comme sa voisine.
 *
 * 🚨 Les deux purges (celle-ci et celle de `verification_sends`) doivent rester
 * au-delà de 24 heures : une ligne retirée plus tôt sortirait du plafond de la
 * journée avant son heure. Un test le tient.
 *
 * En SQLite, comme les compteurs voisins : les plafonds survivent à un
 * redémarrage, qu'un compteur en mémoire remettrait à zéro à chaque déploiement.
 */
const FREE_KEY_MAIL_TABLE_READY = new WeakSet<object>();

function freeKeyMailDB(): ReturnType<typeof getStatsDB> {
  const db = getStatsDB();
  if (!FREE_KEY_MAIL_TABLE_READY.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS free_key_mail_sends (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_free_key_mail_sends_created ON free_key_mail_sends(created_at);
    `);
    FREE_KEY_MAIL_TABLE_READY.add(db);
  }
  return db;
}

const HOUR_MS = 60 * 60 * 1000;

/** L'état d'alerte d'un plafond (voir `noteCeilingReading`). */
interface CeilingEpisode {
  open: boolean;
  failedAt: number;
  lastHotAt: number;
  staleAtBoot: boolean;
}

function freshEpisode(): CeilingEpisode {
  return { open: false, failedAt: 0, lastHotAt: 0, staleAtBoot: true };
}

/** Ce qui distingue les deux plafonds ; tout le reste est commun. */
interface Ceiling {
  /** Le décalage SQLite du début de la fenêtre. */
  since: string;
  /** La fenêtre, en jours (pour julianday). */
  days: number;
  /** La plus longue attente possible, en secondes : la fenêtre entière. */
  maxWaitSeconds: number;
  limit: () => number;
  env: string;
  alert: string;
  /** Les mots de l'alerte. */
  name: string;
  per: string;
  clears: string;
  episode: CeilingEpisode;
}

const HOURLY: Ceiling = {
  since: '-1 hour',
  days: 1 / 24,
  maxWaitSeconds: 3600,
  limit: unauthenticatedMailsPerHour,
  env: UNAUTHENTICATED_MAILS_PER_HOUR_ENV,
  alert: UNAUTHENTICATED_MAIL_HOURLY_ALERT,
  name: 'hourly ceiling',
  per: 'an hour',
  clears: 'the hour clears',
  episode: freshEpisode(),
};

const DAILY: Ceiling = {
  since: '-24 hours',
  days: 1,
  maxWaitSeconds: 24 * 3600,
  limit: unauthenticatedMailsPerDay,
  env: UNAUTHENTICATED_MAILS_PER_DAY_ENV,
  alert: UNAUTHENTICATED_MAIL_DAILY_ALERT,
  name: '24-hour ceiling',
  per: 'over a sliding 24 hours',
  clears: 'the oldest of those mails are 24 hours old',
  episode: freshEpisode(),
};

/**
 * Les mails partis sans compte depuis `since`, les deux registres additionnés.
 * L'horloge est celle de SQLite, comme chez les voisins (`accountCodeBudgetLeft`).
 */
function mailsSince(since: string): number {
  const row = freeKeyMailDB()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM verification_sends WHERE created_at >= datetime('now', ?))
            + (SELECT COUNT(*) FROM free_key_mail_sends WHERE created_at >= datetime('now', ?)) AS n`,
    )
    .get(since, since) as { n: number };
  return row.n;
}

/** Les mails partis sans compte sur l'heure glissante. */
export function unauthenticatedMailsLastHour(): number {
  return mailsSince(HOURLY.since);
}

/** Les mails partis sans compte sur les 24 dernières heures glissantes. */
export function unauthenticatedMailsLastDay(): number {
  return mailsSince(DAILY.since);
}

/**
 * Secondes avant qu'une place se libère sous ce plafond : l'instant où la plus
 * ancienne ligne comptée qui le dépasse encore sort de la fenêtre. Bornées à
 * [1, fenêtre entière].
 */
function secondsUntilASlotFrees(ceiling: Ceiling, count: number, limit: number): number {
  const row = freeKeyMailDB()
    .prepare(
      `SELECT (julianday(created_at) + ? - julianday('now')) * 86400 AS wait
         FROM (SELECT created_at FROM verification_sends WHERE created_at >= datetime('now', ?)
               UNION ALL
               SELECT created_at FROM free_key_mail_sends WHERE created_at >= datetime('now', ?))
        ORDER BY created_at
        LIMIT 1 OFFSET ?`,
    )
    .get(ceiling.days, ceiling.since, ceiling.since, Math.max(0, count - limit)) as
    { wait: number } | undefined;
  const wait = Math.ceil(row?.wait ?? 1);
  return Math.min(ceiling.maxWaitSeconds, Math.max(1, wait));
}

/**
 * L'épisode d'alerte d'UN plafond, tenu en mémoire comme celui de la connexion
 * (`src/lib/account.ts`), une seule différence : il s'ouvre à la MOITIÉ du
 * plafond, donc avant le premier refus, pour qu'une vraie demande laisse le
 * temps de relever le plafond avant que les codes ne cèdent. Chaque plafond a
 * sa clé d'alerte : l'un ouvert n'étouffe jamais l'autre.
 *
 *  - un `opsFail` à la première lecture chaude, puis au plus un par heure tant
 *    que l'épisode dure, refus compris. UN SEUL MESSAGE part par épisode :
 *    c'est l'état persisté `firing` d'`ops-alert` qui le garantit, et il
 *    faut le rappeler pour qu'il retente. Un appel unique par épisode perdrait
 *    l'unique avertissement si Telegram se tait à cet instant, ou si la
 *    fenêtre anti-tempête de six heures d'un épisode précédent est encore
 *    fermée (un `opsOk` ne la rouvre pas) ;
 *  - un `opsOk` au premier mail parti après une heure entière sous la moitié.
 *
 * `staleAtBoot` : l'état persisté par `ops-alert` survit à un redéploiement,
 * pas cette mémoire. Le premier mail calme après le démarrage referme donc une
 * alerte restée ouverte (une simple lecture quand rien ne l'est), sans quoi elle
 * resterait muette au dépassement suivant.
 */
function noteCeilingReading(ceiling: Ceiling, count: number, limit: number, now: number): void {
  const episode = ceiling.episode;
  if (count >= unauthenticatedMailWarnAt(limit)) {
    episode.lastHotAt = now;
    if (now - episode.failedAt < HOUR_MS) return;
    episode.failedAt = now;
    episode.open = true;
    episode.staleAtBoot = false;
    void opsFail(
      ceiling.alert,
      `Mail sent without an account (verification codes and free-key mails) ${
        count >= limit ? 'reached' : 'passed half of'
      } its ${ceiling.name} of ${limit} ${ceiling.per}, from the mailbox that also delivers paid keys. ` +
        `At that ceiling, free keys are issued without their mail and verification codes answer 503 until ` +
        `${ceiling.clears}; sign-in codes keep their own ceilings, hourly and daily. If this is real demand, raise ` +
        `${ceiling.env}, within the mailbox's own 24-hour sending limit. Paid key deliveries are never held ` +
        'by this ceiling.',
      1,
    );
    return;
  }
  if (!episode.open && !episode.staleAtBoot) return;
  if (now - episode.lastHotAt < HOUR_MS) return;
  episode.open = false;
  episode.staleAtBoot = false;
  void opsOk(ceiling.alert, `Mail sent without an account is back under half its ${ceiling.name}.`);
}

export type UnauthenticatedMailCheck = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Un mail de plus, sans compte, sous les deux plafonds ? Lit les deux registres
 * sur les deux fenêtres et tient les deux alertes ; n'écrit RIEN. Pour un code,
 * c'est `recordVerificationSend` qui inscrit l'envoi juste après. Refusé par
 * les deux, l'attente rendue est la plus longue : avant elle, l'un des deux
 * refuserait encore.
 *
 * 🚨 Sa place dans une route : APRÈS `challengeSendAllowed` (ses 429 disent à
 * l'appelant quoi corriger, celui-ci ne dit rien d'une adresse), AVANT
 * `recordVerificationSend` et `createVerificationChallenge` (un refus n'entre
 * pas au registre et ne remet pas à zéro les essais d'un défi en cours), et
 * sans `await` entre lui et l'inscription : better-sqlite3 est synchrone, donc
 * aucune requête concurrente ne peut se glisser entre le contrôle et l'écriture.
 */
export function unauthenticatedMailAllowed(now: number = Date.now()): UnauthenticatedMailCheck {
  let wait = 0;
  for (const ceiling of [HOURLY, DAILY]) {
    const limit = ceiling.limit();
    const count = mailsSince(ceiling.since);
    noteCeilingReading(ceiling, count, limit, now);
    if (count >= limit) wait = Math.max(wait, secondsUntilASlotFrees(ceiling, count, limit));
  }
  return wait === 0 ? { ok: true } : { ok: false, retryAfterSeconds: wait };
}

/**
 * Le mail de clé gratuite : contrôle ET inscription, d'un seul geste
 * synchrone. Faux : un plafond est atteint, la clé est rendue sans son mail.
 */
export function takeFreeKeyMailSlot(now: number = Date.now()): boolean {
  if (!unauthenticatedMailAllowed(now).ok) return false;
  const db = freeKeyMailDB();
  db.prepare('INSERT INTO free_key_mail_sends DEFAULT VALUES').run();
  db.prepare("DELETE FROM free_key_mail_sends WHERE created_at < datetime('now', '-2 days')").run();
  return true;
}

/** Pour les tests : l'état d'un processus qui vient de démarrer. */
export function resetUnauthenticatedMailCeilingAlert(): void {
  HOURLY.episode = freshEpisode();
  DAILY.episode = freshEpisode();
}
