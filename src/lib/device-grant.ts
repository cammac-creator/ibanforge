/**
 * Device grant (RFC 8628) : le circuit « un secret posé d'avance, une clé
 * frappée par un événement extérieur, un retrait unique ».
 *
 * L'agent ouvre un grant, affiche un code court à son humain, l'humain approuve
 * sur une page, l'agent vient chercher la clé UNE fois. Rien de personnel ne
 * traverse le modèle : il relaie un code et attend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 TOUTE LA GARDE DE QUOTA VIT ICI, DANS `openGrant`, JAMAIS DANS UN HANDLER
 * ─────────────────────────────────────────────────────────────────────────────
 * Trois surfaces ouvrent des grants (la route HTTP, et deux surfaces MCP qui
 * appellent ce module en direct, sans HTTP). Une serrure laissée dans l'une des
 * trois est une porte sans plafond et sans journal dans les deux autres : les
 * grants nés là n'auraient aucune empreinte, donc seraient invisibles du
 * disjoncteur global, dont l'invariant est « toute frappe d'une clé libre écrit
 * sa ligne, et exactement une ».
 *
 * Corollaire : ce module ne frappe AUCUNE clé et n'écrit JAMAIS dans
 * `key_creations`. La frappe appartient à `generateApiKey`, qui écrit elle-même
 * la ligne de naissance dans sa transaction. Un second appel ici armerait le
 * disjoncteur à la moitié du volume réel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 LA TABLE EST PARTAGÉE, DONC LE RAIL EST UN PARAMÈTRE OBLIGATOIRE
 * ─────────────────────────────────────────────────────────────────────────────
 * `device_codes` porte deux rails sous `grant_type` : `'device'` (ce grant-ci,
 * gratuit, quinze minutes) et `'checkout'` (le nonce d'un paiement, payé,
 * vingt-quatre heures, retrait ouvert sept jours). Les échéances et les valeurs
 * n'ont rien de commun. Chaque fonction qui lit ou écrit cette table prend donc
 * le rail SANS VALEUR PAR DÉFAUT et le teste dans son `WHERE` : un défaut
 * `'device'` redonnerait le défaut au premier appel qui l'oublie, et `tsc` ne
 * dirait rien. Un secret présenté au mauvais rail ne consomme rien.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SYNCHRONE DE BOUT EN BOUT ENTRE LA LECTURE ET L'ÉCRITURE
 * ─────────────────────────────────────────────────────────────────────────────
 * `approveGrant`, `denyGrant` et `consumeGrantKey` n'ont pas un seul `await`
 * entre leur lecture et leur écriture, et branchent sur `changes` et non sur la
 * lecture précédente. C'est ce qui rend « la clé est remise exactement une
 * fois » vrai devant deux retraits concurrents ou un double-clic : better-sqlite3
 * est synchrone et Node mono-fil, un SELECT suivi d'un UPDATE sans point de
 * reprise ne peut pas s'entrelacer. L'attente du long-polling vit dans la
 * boucle de l'appelant, jamais ici.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { getStatsDB } from './db.js';
import { DAILY_KEY_CREATION_LIMIT, keyCreationSource } from './key-creation-guard.js';
import {
  ANONYMOUS_CONTACT,
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT,
  type KeyTier,
} from './tiers.js';

/** RFC 8628 §3.2 `expires_in`. Quinze minutes : le temps qu'un humain quitte
 *  son terminal, ouvre un navigateur, lise la page et clique. Aligné sur
 *  VERIFICATION_TTL_MINUTES pour que le code e-mail ne survive pas au grant. */
export const DEVICE_CODE_TTL_SECONDS = 900;

/** RFC 8628 §3.2 `interval` : l'intervalle minimal entre deux appels du client. */
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

/**
 * Attente maximale côté serveur sur /v1/keys/device/token, et granularité de
 * sa boucle.
 *
 * 🚨 LUES À CHAUD, PAS FIGÉES. vitest ne définit aucun `testTimeout`, donc son
 * défaut de 5 000 ms s'applique : tout test qui poll avant approbation
 * expirerait avant la réponse si l'attente valait 30 s en dur. Les fichiers de
 * test posent 200 ms / 20 ms. Patron : la lecture gardée de RATE_LIMIT_PER_MIN
 * (garde la chaîne VIDE, que `??` ne rattrape pas, et la valeur non finie).
 */
export function devicePollWaitMs(): number {
  return readPositiveEnv('DEVICE_POLL_WAIT_MS', 30_000);
}
export function devicePollTickMs(): number {
  return readPositiveEnv('DEVICE_POLL_TICK_MS', 3_000);
}

/** Gigue ajoutée à chaque tick, pour que N attentes ouvertes ne relisent pas la
 *  base à la même milliseconde. Bornée par le tick lui-même : c'est une
 *  dispersion, pas un délai — une gigue de 500 ms sur un tick de 20 ms (les
 *  tests) ferait rater le réveil que le test mesure. */
export const DEVICE_POLL_JITTER_MS = 500;

/**
 * Attentes longues RETENUES en même temps. TROIS bornes, pas une.
 *
 * 🚨 Le plafond global seul est saturable pour le prix de quatre adresses : le
 * limiteur général autorise 100 requêtes par minute et par adresse, chaque
 * attente est retenue jusqu'à 30 s, ce qui donne de l'ordre de 50 attentes
 * simultanées par adresse en régime permanent. Quatre adresses occupent 200
 * places en continu. Ce n'est pas une brèche (la réponse immédiate reste
 * juste), c'est l'annulation permanente de la fonctionnalité pour tout le
 * monde, et une charge que rien ne facture ni ne mesure.
 *
 * D'où un sous-plafond PAR EMPREINTE DE RÉSEAU, et un sous-plafond PAR RAIL :
 * les attentes du checkout ne doivent pas évincer celles du device.
 *
 * Au-delà de n'importe laquelle des trois bornes : réponse authorization_pending
 * IMMÉDIATE. Aucun client conforme ne casse, il repasse à son intervalle.
 */
export const DEVICE_POLLS_IN_FLIGHT_MAX = 200; // global, tous rails
export const DEVICE_POLLS_IN_FLIGHT_PER_RAIL = 150; // 'device' ou 'checkout'
export const DEVICE_POLLS_IN_FLIGHT_PER_IP = 3; // par empreinte de réseau

export function devicePollsInFlightMax(): number {
  return readPositiveEnv('DEVICE_POLLS_IN_FLIGHT_MAX', DEVICE_POLLS_IN_FLIGHT_MAX);
}
export function devicePollsInFlightPerRail(): number {
  return readPositiveEnv('DEVICE_POLLS_IN_FLIGHT_PER_RAIL', DEVICE_POLLS_IN_FLIGHT_PER_RAIL);
}
export function devicePollsInFlightPerIp(): number {
  return readPositiveEnv('DEVICE_POLLS_IN_FLIGHT_PER_IP', DEVICE_POLLS_IN_FLIGHT_PER_IP);
}

/** RFC 8628 §3.5 : sur `slow_down`, le client AJOUTE 5 s à son intervalle. */
export const DEVICE_SLOW_DOWN_INCREMENT_SECONDS = 5;

/** RFC 8628 §6.1 : base de 20 caractères, sans voyelle (aucun mot involontaire)
 *  et sans chiffre (donc aucune confusion 0/O ni 1/I/L). 20^8 combinaisons. */
export const DEVICE_USER_CODE_CHARSET = 'BCDFGHJKLMNPQRSTVWXZ';
export const DEVICE_USER_CODE_LENGTH = 8; // affiché XXXX-XXXX

/**
 * Anti-force brute. 🚨 Deux rôles à ne pas confondre :
 *   - le BUDGET ne compte QUE les tentatives infructueuses (`hit = 0`) ;
 *   - le DÉLAI qui en découle s'applique à TOUTES les réponses 404 de la route.
 *
 * Compter les réussites dans le budget en ferait un interrupteur d'arrêt
 * mondial : dix adresses tirant chacune leur quota saturaient le budget global,
 * et tout humain honnête recevait un refus pendant l'heure suivante. Second
 * effet, structurel : le parcours honnête consomme un lookup PUIS un approve,
 * donc le module se serait plafonné lui-même à une centaine d'approbations
 * honnêtes par heure dans le monde entier.
 *
 * N'appliquer le délai qu'aux `hit = 0` fabriquerait en revanche l'oracle
 * temporel que la réponse 404 uniforme prétend supprimer : un code expiré ou
 * déjà tranché est un `hit`, il répondrait en 120 ms là où un code inexistant
 * répondrait jusqu'à 5 s. Le corps serait uniforme, le temps non.
 */
export const DEVICE_APPROVAL_MISSES_PER_IP_HOUR = 20;
export const DEVICE_APPROVAL_MISSES_GLOBAL_HOUR = 200;
/** Budget SÉPARÉ pour lookup : le parcours honnête consomme un lookup PUIS un
 *  approve, et le jeton d'approbation vient du lookup. Un budget commun ferait
 *  payer au parcours honnête l'émission de son propre jeton. */
export const DEVICE_LOOKUP_MISSES_PER_IP_HOUR = 40;

/** Délai de réponse imposé aux 404. Croissant, borné, et JAMAIS un 429 : la
 *  doctrine est de dégrader, pas de refuser. */
export const DEVICE_MISS_DELAY_FLOOR_MS = 120; // sur TOUTE réponse 404, budget ou non
export const DEVICE_MISS_DELAY_MAX_MS = 5_000;

export function deviceMissDelayFloorMs(): number {
  return readPositiveEnv('DEVICE_MISS_DELAY_FLOOR_MS', DEVICE_MISS_DELAY_FLOOR_MS);
}
export function deviceMissDelayMaxMs(): number {
  return readPositiveEnv('DEVICE_MISS_DELAY_MAX_MS', DEVICE_MISS_DELAY_MAX_MS);
}

/**
 * Ouverture de grants, par RÉSEAU et par heure.
 *
 * 🚨 « par réseau » = keyCreationSource(ip), l'empreinte salée de l'IP
 * normalisée, JAMAIS le champ `source` du corps de la requête, qui est une
 * chaîne libre posée par l'appelant.
 *
 * Ce plafond ne borne QUE le brassage de lignes (ouvrir, refuser, rouvrir). Le
 * nombre de CLÉS est borné ailleurs, et par le même budget que
 * /v1/keys/generate : voir la réservation de `openGrant`.
 */
export const DEVICE_CODES_PER_IP_HOUR = 10;

/**
 * Fenêtre de retrait ouverte par l'approbation, SUR LE RAIL DEVICE.
 *
 * 🚨 Sans elle, l'humain qui approuve à la quatorzième minute voit « c'est
 * fait » pendant que l'agent, qui poll à la quinzième, reçoit expired_token :
 * une clé active existe que personne ne détient. C'est le parcours HONNÊTE qui
 * produit ce défaut, pas une attaque. Trois minutes suffisent largement, un
 * poll conforme revenant toutes les 35 s.
 */
export const DEVICE_COLLECT_WINDOW_SECONDS = 180;

/**
 * Fenêtre de retrait du rail CHECKOUT, en JOURS et non en secondes.
 *
 * 🚨 Un MAX() de trois minutes sur un nonce de 24 h est sans effet tant qu'il
 * reste du temps, et devient une fenêtre de trois minutes quand il n'en reste
 * plus : la fenêtre de retrait d'une clé PAYÉE rétrécirait à zéro à mesure que
 * le nonce vieillit. Le nom canonique (`CHECKOUT_CLAIM_WINDOW_DAYS`) appartient
 * au module du Checkout ; la valeur est ici parce que c'est `approveGrant` qui
 * la pose, et ce module-là importera celle-ci plutôt que d'en écrire une
 * seconde.
 */
export const DEVICE_CHECKOUT_CLAIM_WINDOW_DAYS = 7;

/** Durée de vie du jeton d'approbation rendu par lookup. Court : il ne sert
 *  qu'entre l'affichage de la page et le clic. */
export const DEVICE_APPROVAL_TOKEN_TTL_SECONDS = 300;

/** Rétention du rail device : une ligne expirée reste 24 h pour que
 *  `expired_token` soit une réponse honnête plutôt qu'un `invalid_grant`
 *  trompeur, puis elle part. 🚨 Le rail checkout garde 30 jours et n'est
 *  supprimé que dans un état TRANCHÉ. Ne jamais unifier les deux rétentions. */
export const DEVICE_CODE_RETENTION_HOURS = 24;
export const DEVICE_CHECKOUT_ROW_RETENTION_DAYS = 30;

/**
 * 🚨 LES DEUX HORLOGES NE PARTENT PAS EN MÊME TEMPS.
 * DEVICE_CODE_TTL_SECONDS court depuis la CRÉATION du grant ; le code à six
 * chiffres court depuis son ENVOI, c'est-à-dire au moment où l'humain arrive
 * sur la page. Un humain qui met cinq minutes à ouvrir le lien, puis demande la
 * voie e-mail, reçoit un code valable quinze minutes contre un grant qui meurt
 * dans dix : il tape un code JUSTE et s'entend répondre invalide. La branche
 * d'envoi de code rallonge donc le grant, UNE SEULE FOIS.
 */
export const DEVICE_GRANT_EMAIL_EXTENSION = true;

/** Les deux adresses publiées. La racine EN est l'adresse canonique : le
 *  routage du site est en `localePrefix: 'as-needed'` avec l'anglais à la
 *  racine. */
export const DEVICE_VERIFICATION_URI = 'https://ibanforge.com/device';

/** Préfixes : une fuite dans un journal reste lisible pour ce qu'elle est. */
const DEVICE_CODE_PREFIX = 'ifd_';
const APPROVAL_TOKEN_PREFIX = 'ifa_';

export type GrantRail = 'device' | 'checkout';
export type GrantStatus = 'pending' | 'approved' | 'delivered' | 'denied' | 'expired';
export type AttemptRoute = 'lookup' | 'approve' | 'deny';

export interface GrantRow {
  device_code_hash: string;
  user_code: string | null;
  grant_type: GrantRail;
  status: GrantStatus;
  tier: KeyTier | null;
  key_hash: string | null;
  client_name: string | null;
  reason: string | null;
  source: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  delivered_at: string | null;
  last_polled_at: string | null;
  poll_count: number;
  email_extended: number;
  stripe_session_id: string | null;
  pack: string | null;
  locale: string | null;
  /** Secondes restantes, calculées PAR SQLITE : toutes les échéances de cette
   *  table sont posées et comparées par SQLite, en UTC. Une soustraction faite
   *  en JS arriverait dans le fuseau de la machine. */
  expires_in: number;
  /** 1 quand l'échéance est passée. Même motif. */
  expired: number;
}

export interface MintedKey {
  api_key: string;
  key_prefix: string;
  tier: KeyTier | null;
  /** La colonne `api_keys.monthly_limit` telle qu'elle est ÉCRITE : 25 sur une
   *  clé anonyme, 5 sur une clé née sous alerte du disjoncteur, NULL sur une
   *  clé de palier e-mail (le middleware y lit le plafond du palier). Jamais
   *  déduite du palier : une clé dégradée est à 5, et la réponse ne doit jamais
   *  contredire la colonne. */
  monthly_limit: number | null;
  email: string | null;
}

export type OpenGrantResult =
  | {
      ok: true;
      deviceCode: string;
      userCode: string;
      expiresAt: string;
      expiresIn: number;
    }
  | { ok: false; error: 'device_rate_limited' | 'device_unavailable' };

/**
 * Lecture d'environnement gardée.
 *
 * La chaîne VIDE est le cas que `??` ne rattrape pas : `process.env.X ?? 30000`
 * rend `''` quand la variable est posée sans valeur, et `Number('')` vaut 0.
 * Une valeur non finie ou négative est signalée plutôt que crue.
 */
function readPositiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[device-grant] ${name}=${raw} is not a positive number. Using ${fallback}.`);
    return fallback;
  }
  return Math.floor(parsed);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Le secret n'existe en base que haché, exactement comme `api_keys.key_hash`. */
export function hashGrantSecret(secret: string): string {
  return sha256(secret);
}

/**
 * La forme normalisée du code court : majuscules, tirets et espaces retirés.
 * La comparaison serveur passe TOUJOURS par ici, dans les deux sens (écriture
 * et lecture), sinon `wdjb mjht` et `WDJB-MJHT` seraient deux codes.
 */
export function normalizeUserCode(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

/** Le code tel qu'un humain le lit et le recopie : XXXX-XXXX. */
export function formatUserCode(normalized: string): string {
  const half = Math.ceil(normalized.length / 2);
  return `${normalized.slice(0, half)}-${normalized.slice(half)}`;
}

/**
 * `randomInt` de node:crypto, jamais `Math.random` : c'est un secret.
 *
 * Exporté pour son test, qui tire dix mille codes et vérifie qu'aucun caractère
 * ne sort du jeu. Le faire en passant par `openGrant` coûterait dix mille
 * insertions, et la garantie « aucune voyelle, aucun chiffre » doit être
 * ASSERTÉE et non espérée : c'est elle qui rend le code dictable à l'oral.
 */
export function drawUserCode(): string {
  let out = '';
  for (let i = 0; i < DEVICE_USER_CODE_LENGTH; i++) {
    out += DEVICE_USER_CODE_CHARSET[randomInt(0, DEVICE_USER_CODE_CHARSET.length)];
  }
  return out;
}

/**
 * Ce qu'un agent a déclaré, prêt à être affiché à un humain sur une page qu'il
 * croit être la nôtre.
 *
 * Tronqué, débarrassé de tout caractère de contrôle, de tout saut de ligne et
 * de toute séquence d'URL, puis réduit au jeu de caractères autorisé. Un champ
 * qui ne passe pas le nettoyage n'est pas une erreur : il devient `null`, et la
 * page affiche son libellé de repli. L'échappement HTML reste le travail de la
 * page ; ceci est la ceinture côté serveur.
 */
export function sanitizeDisplayField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    // Caractères de contrôle et sauts de ligne d'abord : ils deviennent des
    // espaces plutôt que de coller deux mots ensemble.
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    // Toute séquence d'URL part avant le filtre de jeu de caractères, sinon
    // « https://x.example » ressortirait en « httpsx.example ».
    .replace(/https?:\/\//gi, ' ')
    .replace(/:\/\//g, ' ')
    .replace(/\bhttps?\b/gi, ' ')
    .replace(/[^\p{L}\p{N} .()/_-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
  return cleaned === '' ? null : cleaned;
}

/** La validation de `source` de /v1/keys/generate, au caractère près. */
export function normalizeGrantSource(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^[a-z0-9_-]{1,40}$/i.test(value.trim())) {
    return value.trim().toLowerCase();
  }
  return fallback;
}

/** Les colonnes rendues à l'appelant, échéances calculées par SQLite. */
const GRANT_COLUMNS = `device_code_hash, user_code, grant_type, status, tier, key_hash,
        client_name, reason, source, ip_hash, user_agent, created_at, expires_at,
        approved_at, delivered_at, last_polled_at, poll_count, email_extended,
        stripe_session_id, pack, locale,
        CAST(MAX(0, strftime('%s', expires_at) - strftime('%s','now')) AS INTEGER) AS expires_in,
        CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END AS expired`;

/**
 * Les clés déjà frappées par ce réseau, PLUS les grants DEVICE qu'il tient
 * ouverts. Un grant en attente est une clé promise : il occupe une place
 * jusqu'à ce qu'il soit tranché ou qu'il expire.
 *
 * 🚨 `AND grant_type = 'device'` sur le second terme : sans elle, trois
 * checkouts ouverts, gratuits et légitimes, fermeraient la porte gratuite à
 * tout le réseau pendant 24 h. Sous NAT d'entreprise, un développeur qui ouvre
 * trois paiements coupe la clé gratuite à ses collègues.
 *
 * 🚨 Conséquence à écrire noir sur blanc : les deux portes PARTAGENT un budget
 * de DAILY_KEY_CREATION_LIMIT, elles n'en ouvrent pas autant chacune.
 */
export function grantReservationCount(ipHash: string): number {
  const row = getStatsDB()
    .prepare(
      // ⚠️ Deux `?` ANONYMES et l'empreinte passée deux fois, pas un `?1`
      // réutilisé : better-sqlite3 compte les emplacements et refuse la requête
      // numérotée avec « Too many parameter values were provided ». La forme
      // numérotée, plus lisible, rendait la réservation morte à l'exécution
      // alors que `tsc` et toute la suite restaient verts — seul un test qui
      // passe une VRAIE adresse l'attrape, un appel sans adresse ne descendant
      // jamais jusqu'ici (fail-open).
      `SELECT (SELECT COUNT(*) FROM key_creations
                 WHERE ip_hash = ? AND created_at >= datetime('now','-24 hours'))
            + (SELECT COUNT(*) FROM device_codes
                 WHERE ip_hash = ? AND grant_type = 'device'
                   AND status = 'pending' AND expires_at > datetime('now')) AS n`,
    )
    .get(ipHash, ipHash) as { n: number };
  return row.n;
}

/** Lignes du rail device ouvertes par ce réseau dans l'heure. Borne le brassage
 *  de lignes : ouvrir puis refuser puis rouvrir ne consomme pas de place de
 *  réservation, donc rien d'autre ne limiterait l'écriture. */
function grantsOpenedThisHour(ipHash: string): number {
  const row = getStatsDB()
    .prepare(
      `SELECT COUNT(*) AS n FROM device_codes
        WHERE ip_hash = ? AND grant_type = 'device'
          AND created_at >= datetime('now','-1 hour')`,
    )
    .get(ipHash) as { n: number };
  return row.n;
}

/**
 * 🚨 LA porte d'entrée. Elle porte la réservation, le plafond horaire de lignes
 * et la capture des deux valeurs qui n'existeront plus au moment de la frappe.
 * Les trois surfaces l'appellent ; aucun handler ne recopie une seule de ces
 * trois choses.
 *
 * 🚨 `ip` est l'adresse BRUTE de l'appelant, pas une empreinte : la
 * normalisation et le salage appartiennent à `keyCreationSource`. La chaîne
 * 'unknown' qu'une surface MCP substitue à une IP absente est traitée ICI comme
 * une absence.
 *
 * Le fail-open reste sur le PLAFOND, il n'a rien à faire sur le JOURNAL. Une
 * réservation qu'on ne sait pas rattacher n'est pas une raison de refuser
 * (bloquer les inscriptions sur un changement d'en-tête coûterait plus cher
 * qu'une ferme) ; mais la ligne stockée garde `ip_hash = NULL`, et c'est la
 * frappe qui substitue la sentinelle 'unknown' POUR LE JOURNAL. Stocker la
 * sentinelle ici mettrait tous les appelants sans adresse du monde dans un seul
 * seau de `DEVICE_CODES_PER_IP_HOUR`.
 */
export function openGrant(input: {
  ip: string | null;
  userAgent: string | null;
  clientName: string | null;
  reason: string | null;
  source: string | null;
}): OpenGrantResult {
  const db = getStatsDB();
  const rawIp = input.ip && input.ip !== 'unknown' ? input.ip : null;
  const creator = keyCreationSource(rawIp);

  if (creator) {
    if (grantReservationCount(creator) >= DAILY_KEY_CREATION_LIMIT) {
      return { ok: false, error: 'device_rate_limited' };
    }
    if (grantsOpenedThisHour(creator) >= DEVICE_CODES_PER_IP_HOUR) {
      return { ok: false, error: 'device_rate_limited' };
    }
  }

  const insert = db.prepare(
    `INSERT INTO device_codes
       (device_code_hash, user_code, grant_type, status, client_name, reason, source,
        ip_hash, user_agent, expires_at)
     VALUES (?, ?, 'device', 'pending', ?, ?, ?, ?, ?, datetime('now', ?))`,
  );
  // `user_code` est UNIQUE : sur une collision on retire, au plus cinq fois,
  // puis on rend device_unavailable. Cinq tirages ratés sur 20^8 ne sont pas de
  // la malchance, et une ligne de plus dans ce cas serait pire qu'une erreur.
  for (let attempt = 0; attempt < 5; attempt++) {
    const deviceCode = DEVICE_CODE_PREFIX + randomBytes(32).toString('hex');
    const userCode = drawUserCode();
    try {
      insert.run(
        hashGrantSecret(deviceCode),
        userCode,
        input.clientName,
        input.reason,
        input.source,
        creator,
        input.userAgent ? input.userAgent.slice(0, 256) : null,
        `+${DEVICE_CODE_TTL_SECONDS} seconds`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/UNIQUE/i.test(message)) continue;
      console.error('[device-grant] openGrant refused by the database:', message);
      return { ok: false, error: 'device_unavailable' };
    }
    const row = db
      .prepare(
        `SELECT expires_at,
                CAST(strftime('%s', expires_at) - strftime('%s','now') AS INTEGER) AS expires_in
           FROM device_codes WHERE device_code_hash = ?`,
      )
      .get(hashGrantSecret(deviceCode)) as { expires_at: string; expires_in: number };
    return {
      ok: true,
      deviceCode,
      userCode: formatUserCode(userCode),
      expiresAt: row.expires_at,
      expiresIn: row.expires_in,
    };
  }
  return { ok: false, error: 'device_unavailable' };
}

/**
 * Le grant que l'humain désigne par son code court.
 *
 * Ne filtre NI le statut NI l'échéance : c'est l'appelant qui décide du 404, et
 * le journal anti-force-brute a besoin de savoir que le code EXISTAIT. Un code
 * expiré ou déjà tranché est un `hit`.
 */
export function findGrantByUserCode(userCode: string): GrantRow | null {
  const normalized = normalizeUserCode(userCode);
  if (normalized === '') return null;
  const row = getStatsDB()
    .prepare(
      `SELECT ${GRANT_COLUMNS} FROM device_codes
        WHERE user_code = ? AND grant_type = 'device'`,
    )
    .get(normalized) as GrantRow | undefined;
  return row ?? null;
}

/** Le grant que l'agent désigne par son secret. Rail OBLIGATOIRE. */
export function findGrantBySecret(secret: string, expected: GrantRail): GrantRow | null {
  const row = getStatsDB()
    .prepare(
      `SELECT ${GRANT_COLUMNS} FROM device_codes
        WHERE device_code_hash = ? AND grant_type = ?`,
    )
    .get(hashGrantSecret(secret), expected) as GrantRow | undefined;
  return row ?? null;
}

/**
 * Le jeton d'approbation, rendu par lookup et exigé par approve et deny.
 *
 * 🚨 C'est la garde CSRF, et elle est nécessaire : approve et deny sont des
 * écritures d'état, donc atteignables depuis n'importe quelle page web sans
 * requête préalable. CORS n'a jamais protégé un effet de bord — il empêche de
 * LIRE la réponse, et un attaquant qui approuve son propre grant n'a rien à
 * lire. Une requête intersite ne peut pas obtenir ce jeton : la réponse du
 * lookup lui est opaque.
 *
 * Un seul jeton vivant par grant : un nouveau lookup écrase le précédent. Deux
 * onglets ouverts sur le même code, c'est le dernier chargé qui peut approuver.
 */
export function issueApprovalToken(secretHash: string): string | null {
  const token = APPROVAL_TOKEN_PREFIX + randomBytes(32).toString('hex');
  const info = getStatsDB()
    .prepare(
      `UPDATE device_codes
          SET approval_token_hash = ?, approval_token_expires_at = datetime('now', ?)
        WHERE device_code_hash = ? AND grant_type = 'device' AND status = 'pending'`,
    )
    .run(hashGrantSecret(token), `+${DEVICE_APPROVAL_TOKEN_TTL_SECONDS} seconds`, secretHash);
  // Un jeton rendu sans ligne écrite ne validerait jamais : la page repartirait
  // avec un 403 silencieux, une relance, puis « cette page a trop attendu ».
  // Branché sur `changes`, comme approveGrant et denyGrant.
  return info.changes > 0 ? token : null;
}

export function checkApprovalToken(secretHash: string, token: string): boolean {
  if (typeof token !== 'string' || token === '') return false;
  const row = getStatsDB()
    .prepare(
      `SELECT 1 AS one FROM device_codes
        WHERE device_code_hash = ? AND grant_type = 'device' AND status = 'pending'
          AND approval_token_hash = ?
          AND approval_token_expires_at > datetime('now')`,
    )
    .get(secretHash, hashGrantSecret(token)) as { one: number } | undefined;
  return row !== undefined;
}

/**
 * L'empreinte de l'APPROBATEUR : un indice d'enquête, jamais une ancre, et
 * jamais une exemption de révocation.
 *
 * Elle ne part NI au journal des créations NI au radar : la clé est née de
 * l'agent, pas du navigateur qui a cliqué. Une exclusion du rayon du radar qui
 * dépendrait de ces deux valeurs serait une exemption que l'attaquant
 * s'accorde lui-même — ouvrir depuis l'IP A, approuver depuis l'IP B, deux
 * `curl` dans un pool d'adresses résidentielles.
 */
export function markApprover(secretHash: string, approverIpHash: string | null): void {
  getStatsDB()
    .prepare(
      `UPDATE device_codes SET approver_ip_hash = ?
        WHERE device_code_hash = ? AND grant_type = 'device' AND status = 'pending'`,
    )
    .run(approverIpHash, secretHash);
}

/**
 * L'approbation : la clé frappée entre dans la ligne, et la fenêtre de retrait
 * s'ouvre.
 *
 * 🚨 La fenêtre DÉPEND DU RAIL. Sur device, `MAX(échéance, maintenant + 180 s)`
 * évite qu'une approbation de la quatorzième minute laisse une clé sans
 * porteur. Sur checkout, c'est SEPT JOURS fermes, et non un MAX : sur un TTL de
 * 24 h le MAX est sans effet tant qu'il reste du temps, et devient une fenêtre
 * de trois minutes quand il n'en reste plus.
 *
 * 🚨 `keyHash` est FACULTATIF et dérivé de `rawKey` quand il manque : le module
 * du Checkout ne peut pas le calculer (la fonction de hachage des clés n'est
 * pas exportée), et le dériver ici retire à tous les appelants la possibilité
 * d'écrire un `key_hash` qui ne correspond pas à la clé remise.
 *
 * La condition vit dans la requête (`WHERE status = 'pending'`) et la décision
 * dans `changes` : un double-clic frappe une clé, pas deux.
 */
export function approveGrant(
  secretHash: string,
  minted: { tier: KeyTier | null; rawKey: string; keyHash?: string },
  expected: GrantRail,
): boolean {
  const keyHash = minted.keyHash ?? sha256(minted.rawKey);
  const info = getStatsDB()
    .prepare(
      `UPDATE device_codes
          SET status = 'approved', approved_at = datetime('now'),
              approval_token_hash = NULL, approval_token_expires_at = NULL,
              tier = ?, key_hash = ?, raw_key_once = ?,
              expires_at = CASE
                WHEN grant_type = 'checkout' THEN datetime('now', ?)
                ELSE MAX(expires_at, datetime('now', ?))
              END
        WHERE device_code_hash = ? AND grant_type = ? AND status = 'pending'`,
    )
    .run(
      minted.tier,
      keyHash,
      minted.rawKey,
      `+${DEVICE_CHECKOUT_CLAIM_WINDOW_DAYS} days`,
      `+${DEVICE_COLLECT_WINDOW_SECONDS} seconds`,
      secretHash,
      expected,
    );
  return info.changes > 0;
}

/**
 * Le refus. Le jeton entre dans le `WHERE` : l'autorisation et l'écriture sont
 * une seule requête, donc un refus intersite ne peut pas gagner la course.
 *
 * 🚨 Le jeton compte davantage ici que sur approve : un refus intersite ne
 * fabrique rien, il DÉTRUIT. Et un refus obtenu par un tiers ne condamne plus
 * la tentative honnête — l'agent a droit à un nouveau grant.
 */
export function denyGrant(secretHash: string, token: string): boolean {
  if (typeof token !== 'string' || token === '') return false;
  const info = getStatsDB()
    .prepare(
      `UPDATE device_codes
          SET status = 'denied', approval_token_hash = NULL, approval_token_expires_at = NULL
        WHERE device_code_hash = ? AND grant_type = 'device' AND status = 'pending'
          AND approval_token_hash = ?
          AND approval_token_expires_at > datetime('now')`,
    )
    .run(secretHash, hashGrantSecret(token));
  return info.changes > 0;
}

/**
 * Le retrait, exactement une fois dans la vie du grant.
 *
 * 🚨 Le clair est effacé DANS la requête de retrait, jamais en deux temps : un
 * effacement différé laisse une fenêtre où deux appelants lisent la même clé.
 * Et la décision se prend sur `changes`, pas sur la lecture précédente : c'est
 * l'UPDATE conditionnel qui désigne le gagnant de la course.
 *
 * L'échéance est testée : un grant expiré ne se consomme pas, même approuvé.
 * L'appelant distingue alors `expired_token` d'`invalid_grant` en relisant la
 * ligne.
 *
 * Le plafond rendu est la COLONNE `api_keys.monthly_limit`, jamais une
 * déduction depuis le palier : une clé née sous alerte du disjoncteur porte 5,
 * et la réponse ne doit pas contredire la colonne.
 */
export function consumeGrantKey(secretHash: string, expected: GrantRail): MintedKey | null {
  const db = getStatsDB();
  const row = db
    .prepare(
      `SELECT d.raw_key_once AS raw_key_once, d.key_hash AS key_hash, d.tier AS tier,
              k.key_prefix AS key_prefix, k.monthly_limit AS monthly_limit, k.email AS email
         FROM device_codes d
         LEFT JOIN api_keys k ON k.key_hash = d.key_hash
        WHERE d.device_code_hash = ? AND d.grant_type = ? AND d.status = 'approved'
          AND d.raw_key_once IS NOT NULL AND d.expires_at > datetime('now')`,
    )
    .get(secretHash, expected) as
    | {
        raw_key_once: string;
        key_hash: string | null;
        tier: KeyTier | null;
        key_prefix: string | null;
        monthly_limit: number | null;
        email: string | null;
      }
    | undefined;
  if (!row) return null;
  const info = db
    .prepare(
      `UPDATE device_codes
          SET status = 'delivered', delivered_at = datetime('now'), raw_key_once = NULL
        WHERE device_code_hash = ? AND grant_type = ? AND status = 'approved'
          AND raw_key_once IS NOT NULL AND expires_at > datetime('now')`,
    )
    .run(secretHash, expected);
  if (info.changes === 0) return null;
  return {
    api_key: row.raw_key_once,
    key_prefix: row.key_prefix ?? row.raw_key_once.slice(0, 12),
    tier: row.tier,
    monthly_limit: row.monthly_limit,
    // 🚨 La sentinelle du palier anonyme n'est pas une adresse : elle ne sort
    // jamais d'ici. La publier apprendrait à un agent à recopier le mot comme
    // si c'en était une, et il finirait dans un formulaire.
    email: row.email === null || row.email === ANONYMOUS_CONTACT ? null : row.email,
  };
}

/** Le plafond à AFFICHER : la colonne quand elle est écrite, le plafond du
 *  palier quand elle est NULL (c'est la branche e-mail, où le middleware lit
 *  lui-même le plafond du palier gratuit). */
export function grantMonthlyLimit(tier: KeyTier | null, stored: number | null): number {
  if (stored !== null) return stored;
  return tier === 'anonymous' ? ANONYMOUS_MONTHLY_LIMIT : FREE_TIER_MONTHLY_LIMIT;
}

/** Un grant ne vit jamais plus longtemps que ceci, rallonges comprises : deux
 *  durées de vie depuis sa création. Le nombre d'envois de code est déjà borné
 *  ailleurs (par destinataire, par réseau, par domaine) ; cette borne-ci borne
 *  le TEMPS. */
export const DEVICE_GRANT_MAX_LIFETIME_SECONDS = 2 * DEVICE_CODE_TTL_SECONDS;

/**
 * La rallonge de la branche e-mail, à CHAQUE envoi de code, bornée dans le temps.
 *
 * La révision précédente ne rallongeait qu'une fois, et rouvrait au second
 * envoi le symptôme même qu'elle voulait fermer : l'humain qui corrige une
 * adresse mal tapée à la quinzième minute recevait un code valable quinze
 * minutes contre un grant qui mourait dans soixante secondes (revue
 * adversariale du 15/09, H1). Chaque envoi repousse donc l'échéance d'une durée
 * de vie, sans jamais dépasser DEVICE_GRANT_MAX_LIFETIME_SECONDS depuis la
 * création ; `email_extended` compte les rallonges.
 *
 * Rend l'échéance COURANTE de la ligne, rallongée ou non : la page a besoin du
 * décompte vrai pour recaler son horloge. `null` veut dire « aucun grant device
 * en attente sous ce secret », et rien d'autre.
 */
export function extendForEmail(secretHash: string): string | null {
  const db = getStatsDB();
  db.prepare(
    `UPDATE device_codes
        SET expires_at = MIN(MAX(expires_at, datetime('now', ?)), datetime(created_at, ?)),
            email_extended = email_extended + 1
      WHERE device_code_hash = ? AND grant_type = 'device' AND status = 'pending'`,
  ).run(
    `+${DEVICE_CODE_TTL_SECONDS} seconds`,
    `+${DEVICE_GRANT_MAX_LIFETIME_SECONDS} seconds`,
    secretHash,
  );
  const row = db
    .prepare(
      `SELECT expires_at FROM device_codes
        WHERE device_code_hash = ? AND grant_type = 'device' AND status = 'pending'`,
    )
    .get(secretHash) as { expires_at: string } | undefined;
  return row?.expires_at ?? null;
}

/**
 * Le contrôle d'intervalle de la RFC 8628 §3.5.
 *
 * Un appel arrivant moins de `DEVICE_POLL_INTERVAL_SECONDS` après le précédent
 * rend `slow_down`, SANS consommer d'attente : la contre-pression du grant se
 * met ainsi devant le limiteur global de 100 requêtes par minute, qu'un client
 * mal réglé atteindrait sinon en trente secondes.
 *
 * 🚨 `last_polled_at` n'est PAS avancé sur un `slow_down` : sinon un client qui
 * boucle ne s'en sortirait jamais, chaque refus repoussant sa propre échéance.
 * `poll_count` compte tous les passages, refus compris — c'est la mesure, pas
 * la serrure.
 */
export function touchPoll(secretHash: string, expected: GrantRail): 'ok' | 'slow_down' {
  const db = getStatsDB();
  const row = db
    .prepare(
      `SELECT CASE
                WHEN last_polled_at IS NULL THEN 0
                WHEN datetime(last_polled_at, ?) > datetime('now') THEN 1
                ELSE 0
              END AS too_soon
         FROM device_codes
        WHERE device_code_hash = ? AND grant_type = ?`,
    )
    .get(`+${DEVICE_POLL_INTERVAL_SECONDS} seconds`, secretHash, expected) as
    { too_soon: number } | undefined;
  if (!row) return 'ok';
  if (row.too_soon === 1) {
    db.prepare(
      `UPDATE device_codes SET poll_count = poll_count + 1
        WHERE device_code_hash = ? AND grant_type = ?`,
    ).run(secretHash, expected);
    return 'slow_down';
  }
  db.prepare(
    `UPDATE device_codes
        SET poll_count = poll_count + 1, last_polled_at = datetime('now')
      WHERE device_code_hash = ? AND grant_type = ?`,
  ).run(secretHash, expected);
  return 'ok';
}

/** Secondes d'ici à une échéance, calculées par SQLite. Jamais en JS : la
 *  colonne est en UTC et une soustraction JS arriverait dans le fuseau de la
 *  machine. */
export function secondsUntil(timestamp: string): number {
  const row = getStatsDB()
    .prepare(`SELECT CAST(MAX(0, strftime('%s', ?) - strftime('%s','now')) AS INTEGER) AS s`)
    .get(timestamp) as { s: number };
  return row.s;
}

/**
 * Le journal en ajout seul des codes présentés. C'est ce qui transforme
 * « 20^8 combinaisons » en une garantie plutôt qu'en une espérance : l'entropie
 * borne la chance d'un coup, ce journal borne le NOMBRE de coups.
 *
 * L'empreinte est celle de l'APPROBATEUR : c'est lui qui devine ou non un code.
 */
export function recordApprovalAttempt(
  ipHash: string | null,
  route: AttemptRoute,
  hit: boolean,
): void {
  getStatsDB()
    .prepare('INSERT INTO device_code_attempts (ip_hash, route, hit) VALUES (?, ?, ?)')
    .run(ipHash, route, hit ? 1 : 0);
}

/** Les routes qui partagent un budget : lookup a le sien, approve et deny sont
 *  comptées ensemble (le jeton d'approbation vient du lookup, donc un budget
 *  commun ferait payer au parcours honnête l'émission de son propre jeton). */
function attemptFamily(route: AttemptRoute): AttemptRoute[] {
  return route === 'lookup' ? ['lookup'] : ['approve', 'deny'];
}

function countMisses(route: AttemptRoute, ipHash: string | null): number {
  const family = attemptFamily(route);
  const placeholders = family.map(() => '?').join(',');
  const db = getStatsDB();
  if (ipHash) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM device_code_attempts
          WHERE ip_hash = ? AND route IN (${placeholders}) AND hit = 0
            AND created_at >= datetime('now','-1 hour')`,
      )
      .get(ipHash, ...family) as { n: number };
    return row.n;
  }
  return 0;
}

function countMissesGlobal(route: AttemptRoute): number {
  const family = attemptFamily(route);
  const placeholders = family.map(() => '?').join(',');
  const row = getStatsDB()
    .prepare(
      `SELECT COUNT(*) AS n FROM device_code_attempts
        WHERE route IN (${placeholders}) AND hit = 0
          AND created_at >= datetime('now','-1 hour')`,
    )
    .get(...family) as { n: number };
  return row.n;
}

/**
 * Le DÉLAI à appliquer, jamais un booléen de refus.
 *
 * 🚨 Il ne dort pas : il CALCULE. Le `await` de l'attente est chez l'appelant,
 * et c'est ce qui permet de le compter dans les plafonds d'attentes — retarder
 * est un moyen de défense, pas un moyen de se faire tenir des connexions.
 *
 * 🚨 Il rend 0 sur une empreinte propre, et jamais un code de statut : le
 * dépassement des budgets RETARDE, il ne refuse pas. Un 429 ici rendrait le
 * module fermable au monde entier pour deux cents requêtes par heure.
 *
 * Le budget ne compte que les `hit = 0` ; le PLANCHER que l'appelant ajoute
 * (`uniformMissDelayMs`) s'applique, lui, à tous les 404.
 */
export function missDelayMs(ipHash: string | null, route: AttemptRoute): number {
  const perIpBudget =
    route === 'lookup' ? DEVICE_LOOKUP_MISSES_PER_IP_HOUR : DEVICE_APPROVAL_MISSES_PER_IP_HOUR;
  const floor = deviceMissDelayFloorMs();
  const max = deviceMissDelayMaxMs();
  const over: number[] = [];
  const mine = countMisses(route, ipHash);
  if (mine > perIpBudget) over.push(mine - perIpBudget);
  // Le budget global ne vaut que pour la famille approve+deny : c'est elle qui
  // écrit un état, et c'est sur elle que la spec pose ses deux cents.
  if (route !== 'lookup') {
    const world = countMissesGlobal(route);
    if (world > DEVICE_APPROVAL_MISSES_GLOBAL_HOUR) {
      over.push(world - DEVICE_APPROVAL_MISSES_GLOBAL_HOUR);
    }
  }
  if (over.length === 0) return 0;
  const steps = Math.max(...over);
  return Math.min(floor * 2 ** steps, max);
}

/**
 * Le délai RÉELLEMENT appliqué à une réponse 404 : le plancher, ou l'escalade.
 *
 * 🚨 Le plancher vaut pour TOUS les 404, `hit = 1` compris. Un code expiré ou
 * déjà tranché est un parcours qui n'aboutit pas : rien ne justifie de le
 * servir plus vite qu'un code inexistant, et le servir plus vite fabrique
 * l'oracle temporel que le corps uniforme prétend fermer.
 */
export function uniformMissDelayMs(ipHash: string | null, route: AttemptRoute): number {
  return Math.max(deviceMissDelayFloorMs(), missDelayMs(ipHash, route));
}

/**
 * Le compteur d'attentes longues retenues, à trois lectures.
 *
 * En mémoire, donc PAR PROCESSUS : c'est correct parce que la ressource
 * protégée l'est aussi (les attentes de ce processus). Un réplica de plus
 * multiplie le plafond, et c'est pour cela que la réponse au dépassement est
 * une réponse immédiate et juste, jamais une erreur.
 */
interface PollEntry {
  rail: GrantRail;
  ipHash: string | null;
}
const pollsHeld = new Map<number, PollEntry>();
let pollSequence = 0;

/** Retient une place et rend la fonction qui la libère. L'appelant l'appelle
 *  dans un `finally`, toujours : une place jamais rendue est une place perdue
 *  jusqu'au redémarrage. */
export function enterPoll(rail: GrantRail, ipHash: string | null): () => void {
  const id = ++pollSequence;
  pollsHeld.set(id, { rail, ipHash });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pollsHeld.delete(id);
  };
}

export function pollsInFlight(rail?: GrantRail, ipHash?: string): number {
  let n = 0;
  for (const entry of pollsHeld.values()) {
    if (rail !== undefined && entry.rail !== rail) continue;
    if (ipHash !== undefined && entry.ipHash !== ipHash) continue;
    n++;
  }
  return n;
}

/** L'attente, interruptible par l'abandon du client. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Ce que l'attente longue a trouvé. `vanished` est le seul cas où l'appelant
 * n'a plus de ligne à interpréter : la purge est passée, ou un retrait
 * concurrent a gagné.
 */
export type GrantWaitOutcome = { kind: 'alive'; grant: GrantRow } | { kind: 'vanished' };

/**
 * Le long-polling, UNE SEULE FOIS, pour la route HTTP comme pour la surface
 * MCP.
 *
 * 🚨 Extrait de `src/routes/device-grant.ts` le 15/09/2026 parce que la surface
 * MCP HTTP attend sur la MÊME base, avec les MÊMES trois plafonds. Deux boucles
 * auraient donné deux comportements sous saturation, et c'est précisément le
 * cas où une divergence ne se voit pas : les deux répondent
 * `authorization_pending`, l'une en trente secondes et l'autre tout de suite,
 * et rien ne dit laquelle a raison.
 *
 * Les trois bornes de `pollsInFlight` sont lues ICI, avant de retenir la place.
 * Au-delà de n'importe laquelle on ne fait PAS attendre : on rend la ligne
 * telle quelle, l'appelant répond `authorization_pending` immédiatement, le
 * client conforme repasse à son intervalle. Aucune réponse n'est fausse, et le
 * dommage est borné quel que soit le nombre de réplicas.
 *
 * `signal` est facultatif : la route passe `c.req.raw.signal`, une surface qui
 * n'a pas de requête HTTP sous la main ne passe rien et l'attente va jusqu'à
 * son échéance.
 */
export async function awaitGrantSettlement(
  secret: string,
  rail: GrantRail,
  grant: GrantRow,
  ipHash: string | null,
  signal?: AbortSignal | null,
): Promise<GrantWaitOutcome> {
  const saturated =
    pollsInFlight() >= devicePollsInFlightMax() ||
    pollsInFlight(rail) >= devicePollsInFlightPerRail() ||
    (ipHash !== null && pollsInFlight(rail, ipHash) >= devicePollsInFlightPerIp());
  if (saturated) return { kind: 'alive', grant };

  let current = grant;
  const release = enterPoll(rail, ipHash);
  try {
    const deadline = Date.now() + devicePollWaitMs();
    while (Date.now() < deadline) {
      const tick = devicePollTickMs();
      // Gigue bornée PAR LE TICK : c'est une dispersion pour que N attentes ne
      // relisent pas la base à la même milliseconde, pas un délai. Une gigue de
      // une demi-seconde sur un tick de vingt millisecondes ferait rater le
      // réveil qu'on mesure.
      const jitter = randomInt(0, Math.min(DEVICE_POLL_JITTER_MS, tick) + 1);
      await sleep(Math.min(tick + jitter, Math.max(1, deadline - Date.now())), signal);
      if (signal?.aborted) break;
      const again = findGrantBySecret(secret, rail);
      if (!again) return { kind: 'vanished' };
      current = again;
      if (current.status !== 'pending' || current.expired === 1) break;
    }
  } finally {
    release();
  }
  return { kind: 'alive', grant: current };
}

// ────────────────────────────────────────────────────────────────────────────
// Le bloc que l'agent montre à son humain, construit PAR LE SERVEUR
// ────────────────────────────────────────────────────────────────────────────

/**
 * Les phrases que DEUX portes servent : la route HTTP et la surface MCP HTTP.
 *
 * 🚨 Déclarées ICI et nulle part ailleurs. La route les sert dans son corps de
 * réponse, la surface MCP les sert dans le `message` de sa sortie structurée,
 * et les surfaces MCP stdio les relaient depuis le corps HTTP : une phrase
 * écrite deux fois est une phrase dont une copie finit par dériver, et c'est
 * toujours celle qu'on ne relit pas qui est servie. Un agent qui lit deux
 * explications différentes du même mur conclut à une panne au lieu de prendre
 * le chemin de repli.
 *
 * En anglais, comme tout ce que lit un modèle, et SANS AUCUN CHIFFRE ÉCRIT :
 * chaque nombre est interpolé depuis sa constante.
 */
export const DEVICE_TEXTS = {
  opened:
    'Show the user_code and the verification_uri to a human. Do not open the link yourself. ' +
    'Then poll POST /v1/keys/device/token with the device_code.',
  authorization_pending:
    'Nobody has approved this code yet. Wait for the interval, then call again. Nothing is wrong.',
  slow_down: `You are polling faster than the interval. Add ${DEVICE_SLOW_DOWN_INCREMENT_SECONDS} seconds to your interval and try again.`,
  access_denied:
    'Somebody refused this request. Tell your human and ask them whether to try again; ' +
    'open at most one more request.',
  expired_token:
    'This code expired without being approved. Ask for a new one at most once, then fall back ' +
    'to the keyless allowance or to x402.',
  invalid_grant:
    'Unknown device code, or the key was already collected. A key is handed over exactly once.',
  device_rate_limited:
    'This network has already taken its free keys for today, counting the ones still waiting for ' +
    'approval. Existing keys keep working, the keyless trial needs nothing, and x402 needs no key at all.',
  device_unavailable:
    'The key service is temporarily unable to open a request. Validation still works; try again in a minute.',
  saved: 'Save this key — it will not be shown again.',
} as const;

/**
 * La ligne que l'humain colle dans la configuration de son client MCP.
 *
 * 🚨 Variante A : le paquet npm ne réécrit JAMAIS le fichier de configuration
 * de son propre client. Un serveur MCP qui écrit dans la configuration de son
 * client est une élévation de privilège que personne n'a demandée, et le chemin
 * du fichier diffère selon le client. Le `--` est obligatoire dans la syntaxe
 * publiée par `claude mcp add --help`.
 *
 * Partagée avec la surface MCP HTTP depuis le 15/09/2026 : c'est une ligne
 * qu'un humain COLLE dans un terminal, et deux versions auraient donné une
 * commande qui ne marche pas sur l'une des deux portes.
 */
export function deviceConfigLine(rawKey: string): string {
  return `claude mcp add ibanforge -e IBANFORGE_API_KEY=${rawKey} -- npx -y ibanforge-mcp`;
}

/**
 * Le bloc prêt à coller que l'agent montre à son humain, mot pour mot.
 *
 * 🚨 CONSTRUIT PAR LE SERVEUR, jamais composé par une surface. Les trois
 * surfaces MCP le relaient : A et B le reçoivent dans le corps HTTP, C
 * l'appelle en direct. Trois compositions locales auraient donné trois textes,
 * et c'est celui qu'un humain lit sur l'écran de son terminal — la seule
 * défense simple contre un agent qui afficherait un lien fabriqué est que
 * l'étape 2 lui apprenne à comparer les deux codes.
 *
 * 🚨 LES TROIS CHIFFRES SONT INTERPOLÉS, jamais tapés : le mois anonyme depuis
 * `ANONYMOUS_MONTHLY_LIMIT`, le mois réclamé depuis `FREE_TIER_MONTHLY_LIMIT`,
 * la durée depuis `DEVICE_CODE_TTL_SECONDS`. C'est la SEULE surface autorisée à
 * annoncer la durée du grant, parce qu'elle la lit à la constante au lieu de la
 * promettre.
 *
 * 🚨 `device_code` N'ENTRE JAMAIS ICI. Ce bloc traverse le transcript du
 * modèle, les journaux du client MCP et les copier-coller de rapport
 * d'incident ; le `device_code` est le porteur unique de la clé. Seul le
 * `user_code`, qui ne retire rien, s'y montre.
 */
export function displayToHuman(
  outcome:
    | { status: 'ok'; userCode: string; verificationUriComplete: string }
    | { status: 'device_rate_limited' }
    | { status: 'device_unavailable' },
): string {
  if (outcome.status === 'device_rate_limited') return DEVICE_TEXTS.device_rate_limited;
  if (outcome.status === 'device_unavailable') return DEVICE_TEXTS.device_unavailable;
  const minutes = Math.round(DEVICE_CODE_TTL_SECONDS / 60);
  return (
    'IBANforge needs one approval from you, and it takes about fifteen seconds.\n' +
    '\n' +
    `  1. Open:  ${outcome.verificationUriComplete}\n` +
    `  2. Check the code shown on the page reads:  ${outcome.userCode}\n` +
    '  3. Click "Get the key". No e-mail, no card, no account.\n' +
    '\n' +
    `That gives ${ANONYMOUS_MONTHLY_LIMIT} requests a month. On the same page you may add an e-mail address\n` +
    `instead, which raises it to ${FREE_TIER_MONTHLY_LIMIT}. The code stops working in ${minutes} minutes.`
  );
}

export interface DevicePurgeResult {
  /** Lignes supprimées, tous rails et toutes tables confondus. */
  removed: number;
  /** Clés du rail device révoquées faute de porteur. */
  revoked: number;
  /** Clés PAYÉES que personne n'est venu chercher : un cas de support, pas un
   *  déchet. Rendues à l'appelant, jamais supprimées ici. */
  unclaimedPaid: string[];
}

/**
 * La purge, rail par rail.
 *
 * 🚨 Chaque étape porte son rail, et c'est l'exigence la plus grave du module.
 * Une purge calibrée sur un grant gratuit de quinze minutes, appliquée sans un
 * mot à un nonce de 24 h, DÉTRUIT UNE CLÉ PAYÉE : au premier passage tombant
 * entre T+24 h et T+25 h, les étapes 1 et 2 n'ont pas encore déclenché (elles
 * attendent T+25 h) et la rétention de 24 h supprime la ligne, clair encore
 * rempli. L'acheteur dont l'agent revient à T+24 h 30 trouve la ligne disparue
 * et sa clé toujours active, le clair nulle part. La purge tourne au démarrage
 * puis toutes les 24 h : le passage fatal est CERTAIN.
 */
export function purgeExpiredDeviceCodes(): DevicePurgeResult {
  const db = getStatsDB();
  let removed = 0;

  // 1. Une clé approuvée que personne n'est jamais venu chercher est une clé
  //    sans porteur : on la révoque plutôt que de la laisser vivante.
  //    RAIL DEVICE SEULEMENT — une clé de checkout appartient à quelqu'un qui a
  //    payé, la révoquer serait lui prendre son argent.
  //    ⚠️ `expires_at` porte déjà la fenêtre de retrait posée par
  //    l'approbation, donc cette étape ne peut pas attraper une clé encore
  //    retirable.
  //    🚨 `deactivated_at` AVEC `active = 0`, comme tous les autres sites de
  //    révocation : la purge de télémétrie des clés terminées (clause 4.7 du
  //    DPA) ne lit que la paire, et une clé révoquée sans date garderait ses
  //    lignes de journal pour toujours (revue adversariale du 15/09, P1).
  const revoked = db
    .prepare(
      `UPDATE api_keys SET active = 0, deactivated_at = datetime('now')
        WHERE key_hash IN (SELECT key_hash FROM device_codes
                            WHERE grant_type = 'device' AND status = 'approved'
                              AND key_hash IS NOT NULL
                              AND expires_at < datetime('now', '-1 hour'))`,
    )
    .run().changes;

  // 2a. Le clair ne survit jamais à la fenêtre de retrait. Rail device.
  db.prepare(
    `UPDATE device_codes
        SET raw_key_once = NULL, approval_token_hash = NULL,
            approval_token_expires_at = NULL, status = 'expired'
      WHERE grant_type = 'device' AND status IN ('pending','approved')
        AND expires_at < datetime('now', '-1 hour')`,
  ).run();

  // 2b. Rail checkout : une ligne 'pending' jamais payée ne porte AUCUNE clé.
  //     On la marque, on ne détruit rien.
  db.prepare(
    `UPDATE device_codes SET status = 'expired'
      WHERE grant_type = 'checkout' AND status = 'pending'
        AND expires_at < datetime('now', '-1 hour')`,
  ).run();

  // 2c. Réservations abandonnées (processus mort entre l'INSERT et l'attache de
  //     la session de paiement).
  removed += db
    .prepare(
      `DELETE FROM device_codes
        WHERE grant_type = 'checkout' AND status = 'pending' AND stripe_session_id IS NULL
          AND created_at < datetime('now', '-120 seconds')`,
    )
    .run().changes;

  // 2d. 🚨 FILET : le clair ne doit jamais survivre à son retrait. La requête de
  //     retrait l'efface elle-même ; ceci rattrape le cas où quelqu'un aurait
  //     réécrit cette requête en deux temps. Vaut pour les DEUX rails :
  //     'delivered' veut dire « déjà remise », donc plus rien à protéger.
  db.prepare(
    `UPDATE device_codes SET raw_key_once = NULL
      WHERE status = 'delivered' AND raw_key_once IS NOT NULL`,
  ).run();

  // 3. Rétention. Le rail device garde 24 h ; le rail checkout garde 30 jours et
  //    n'est supprimé QUE dans un état TRANCHÉ. Une ligne 'approved' de checkout
  //    n'est jamais supprimée par la purge : elle est payée et non retirée.
  removed += db
    .prepare(
      `DELETE FROM device_codes
        WHERE grant_type = 'device' AND created_at < datetime('now', ?)`,
    )
    .run(`-${DEVICE_CODE_RETENTION_HOURS} hours`).changes;
  removed += db
    .prepare(
      `DELETE FROM device_codes
        WHERE grant_type = 'checkout' AND status IN ('delivered','expired','denied')
          AND created_at < datetime('now', ?)`,
    )
    .run(`-${DEVICE_CHECKOUT_ROW_RETENTION_DAYS} days`).changes;
  removed += db
    .prepare("DELETE FROM device_code_attempts WHERE created_at < datetime('now', '-2 days')")
    .run().changes;

  // 4. Une alerte, pas une suppression : une clé payée que personne n'est venu
  //    chercher au-delà de la fenêtre de retrait est un cas de support. Ce lot
  //    ne notifie rien, il rend la liste ; le module du Checkout branchera le
  //    marqueur qui évite la boucle.
  //    🚨 `device_codes` n'a AUCUNE colonne `key_prefix` : le préfixe se lit
  //    dans `api_keys` par jointure, jamais dans cette table.
  const unclaimed = db
    .prepare(
      `SELECT k.key_prefix AS key_prefix
         FROM device_codes d JOIN api_keys k ON k.key_hash = d.key_hash
        WHERE d.grant_type = 'checkout' AND d.status = 'approved'
          AND d.approved_at < datetime('now', ?)`,
    )
    .all(`-${DEVICE_CHECKOUT_CLAIM_WINDOW_DAYS} days`) as Array<{ key_prefix: string }>;

  return { removed, revoked, unclaimedPaid: unclaimed.map((r) => r.key_prefix) };
}
