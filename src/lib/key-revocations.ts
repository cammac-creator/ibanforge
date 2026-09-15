/**
 * Révocation par rafale, et son journal d'annulation.
 *
 * Ce module coupe des clés. C'est la seule action de tout le chantier « clé sans
 * e-mail » qu'un `git revert` ne rembobine pas : la migration se laisse, le
 * schéma reste, mais une clé désactivée reste désactivée. D'où le journal, écrit
 * dans la MÊME transaction que la coupe, et qui porte tout ce qu'il faut pour
 * rendre la clé exactement telle qu'elle était.
 *
 * 🚨 POURQUOI CE N'EST PAS `revokeApiKey`, et pourquoi il ne faut jamais
 * unifier les deux. `revokeApiKey` est la révocation libre-service, et sa
 * docstring pose son invariant : une clé révoquée par son porteur ne peut
 * JAMAIS être réactivée (il tourne pour en obtenir une neuve). La révocation par
 * rafale est au contraire ANNULABLE PAR CONSTRUCTION — c'est la condition même
 * de son existence. Deux chemins de code séparés, parce qu'un lecteur pressé qui
 * les unifierait casserait l'un des deux invariants sans qu'aucun test de
 * l'autre ne rougisse. La spec plaçait ces fonctions dans `api-keys.ts`, à côté
 * de `revokeApiKey` ; elles vivent ici parce que ce lot n'édite pas ce fichier,
 * et l'avertissement ci-dessus remplace l'adjacence qui le portait.
 *
 * 🚨 L'UPDATE porte la RÈGLE ENTIÈRE, pas seulement `active = 1`. Le chargeur du
 * radar filtre déjà ces classes de clés, mais un mécanisme qui coupe ne doit pas
 * laisser sa règle dans une autre fonction : le jour où quelqu'un ajoute un
 * `await`, un envoi par cohorte ou une sonde dans la boucle, une clé réclamée ou
 * payée entre-temps serait coupée et rien ici ne l'arrêterait. Les deux listes de
 * clauses sont jumelles, et appliquer une moitié sans l'autre est pire que ne
 * rien faire.
 */

import { getStatsDB } from './db.js';
import { registerInternalEmailFn } from './internal-accounts.js';
import { CLAIM_MIN_PAID_USD } from './tiers.js';
import { ANON_REVOCATION_BATCH } from './cohort-radar.js';

/** Le seul motif écrit par ce module, et celui que le middleware reconnaît. */
export const REVOCATION_REASON_BURST = 'anon_burst';

/** Ce qu'il faut savoir d'une clé et de sa rafale pour la couper et la journaliser. */
export interface BurstRevocationInput {
  keyHash: string;
  keyPrefix: string;
  /** Le préfixe qui porte la ligne de naissance, quand la clé a tourné. */
  originPrefix: string | null;
  episodeId: string | null;
  /** 'ua:<user_agent>' ou 'ip:<ip_hash>'. */
  anchor: string;
  /** Part de l'ancre dans la rafale. RAPPORTÉE, elle ne décide rien. */
  anchorShare: number;
  /** Clés de cette ancre DANS la rafale. */
  anchorKeys: number;
  /** Bornes de la rafale, au format SQLite 'YYYY-MM-DD HH:MM:SS'. */
  burstFrom: string;
  burstTo: string;
  /** Taille de la rafale GLOBALE, toutes ancres confondues. */
  burstKeys: number;
  windowMinutes: number;
  /** ip_hash distincts dans le rayon, au moment de la décision. */
  distinctSources: number;
}

/**
 * Les clauses du rayon, recopiées dans l'UPDATE qui coupe.
 *
 * Chaque ligne est une classe de clé que ce mécanisme ne doit jamais toucher :
 *  - `active = 1` : idempotence. Une clé déjà coupée ne réécrit pas de journal.
 *  - `tier = 'anonymous'` et `claimed_at IS NULL` : jamais une clé réclamée.
 *    Les DEUX, jamais l'une sans l'autre (instruction paire E3). Et jamais
 *    `tier <> 'claimed'` : avec quatre paliers, écrire l'exemption « tout ce qui
 *    n'est pas réclamé » ferait tomber une clé `paid` dans une branche que
 *    personne n'a écrite.
 *  - les cinq colonnes de paiement : de l'argent a changé de main une fois.
 *  - le cumul réglé : payer une fois le plus petit règlement du catalogue
 *    n'achète pas une immunité permanente, mais l'atteindre l'achète.
 *  - `issued_by_us`, compte interne, adresse de cohorte : nos propres clés.
 *
 * 🚨 `ROUND(..., 6)` n'est pas de la coquetterie. `quoted_amount_usd` est un
 * REAL et le seuil vaut exactement deux cents règlements au tarif unitaire. La
 * somme de deux cents flottants binaires ne vaut pas le seuil exactement ; sans
 * l'arrondi, un payeur qui a réglé la totalité se retrouve révocable pour une
 * erreur au quinzième chiffre.
 */
const RADIUS_CLAUSES = `
     AND active = 1
     AND tier = 'anonymous'
     AND claimed_at IS NULL
     AND credits_remaining IS NULL
     AND credits_total IS NULL
     AND stripe_session_id IS NULL
     AND stripe_subscription_id IS NULL
     AND amount_paid_minor IS NULL
     AND issued_by_us = 0
     AND is_internal_email(email) = 0
     AND email NOT LIKE '%@cohorte.invalid'
     AND NOT EXISTS (
           SELECT 1 FROM key_settlements s
            WHERE s.key_hash = api_keys.key_hash
            GROUP BY s.key_hash
           HAVING ROUND(SUM(s.quoted_amount_usd), 6) >= ?)`;

interface PrevState {
  active: number;
  monthly_limit: number | null;
  no_recredit: number;
  credits_remaining: number | null;
}

/**
 * Coupe une clé et écrit sa ligne de journal, dans une transaction.
 *
 * Rend `false` — et n'écrit AUCUNE ligne de journal — quand l'UPDATE ne touche
 * rien : clé déjà coupée, réclamée entre le scan et l'application, payée, ou
 * interne. L'invariant que ce `false` protège est « jamais une ligne de journal
 * sans une coupe » ; sa réciproque est tenue par l'écriture dans la même
 * transaction.
 */
export function revokeForBurst(input: BurstRevocationInput): boolean {
  return revokeBurstBatch([input]).revoked === 1;
}

/**
 * Le même geste, pour un LOT, en UNE transaction `.immediate()`.
 *
 * 🚨 Pourquoi le lot ne casse pas l'instruction paire, alors qu'un lecteur
 * pressé le croira. Ce qui compte n'est pas l'atomicité du lot, c'est
 * l'invariant « jamais une ligne de journal sans une coupe ». Dans un lot, on le
 * tient en SAUTANT la clé dont l'UPDATE rend zéro (on n'écrit pas sa ligne) et
 * en continuant, au lieu d'annuler les quatre-vingt-dix-neuf autres coupes
 * légitimes. Le résultat PAR CLÉ est identique ; seule la granularité de
 * l'annulation change.
 *
 * `.immediate()` prend le verrou d'écriture au BEGIN plutôt qu'à la première
 * écriture, comme `checkAndIncrementQuota` : sinon deux écrivains concurrents se
 * découvrent au milieu de la transaction et l'un des deux est renvoyé.
 */
export function revokeBurstBatch(rows: BurstRevocationInput[]): {
  revoked: number;
  skipped: string[];
  unitsReclaimed: number;
} {
  const out = { revoked: 0, skipped: [] as string[], unitsReclaimed: 0 };
  if (rows.length === 0) return out;

  const db = getStatsDB();
  registerInternalEmailFn(db);

  const readPrev = db.prepare(
    'SELECT active, monthly_limit, no_recredit, credits_remaining FROM api_keys WHERE key_hash = ?',
  );
  // Tous mois confondus, et non le mois courant : ces clés portent no_recredit,
  // et c'est sur cette base que leur plafond se mesure. Le mois courant seul
  // ferait consigner un solde que la restauration ne rendrait pas.
  const readUsed = db.prepare(
    'SELECT COALESCE(SUM(count), 0) AS used FROM api_usage WHERE key_hash = ?',
  );
  const cut = db.prepare(
    `UPDATE api_keys
        SET active = 0, deactivated_at = datetime('now')
      WHERE key_hash = ?${RADIUS_CLAUSES}`,
  );
  const journal = db.prepare(
    `INSERT INTO key_revocations
       (key_prefix, origin_prefix, key_hash, reason, episode_id, anchor, anchor_share,
        anchor_keys, burst_from, burst_to, burst_keys, window_minutes, distinct_sources,
        prev_active, prev_monthly_limit, prev_units_used, prev_no_recredit, prev_credits_remaining)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction((batch: BurstRevocationInput[]) => {
    for (const r of batch) {
      const prev = readPrev.get(r.keyHash) as PrevState | undefined;
      if (!prev) {
        // La clé a disparu entre le scan et l'application : sauter, ne pas
        // inventer un état d'avant qu'on n'a pas lu.
        out.skipped.push(r.keyPrefix);
        continue;
      }
      const used = (readUsed.get(r.keyHash) as { used: number }).used;
      if (cut.run(r.keyHash, CLAIM_MIN_PAID_USD).changes === 0) {
        out.skipped.push(r.keyPrefix);
        continue;
      }
      journal.run(
        r.keyPrefix,
        r.originPrefix,
        r.keyHash,
        REVOCATION_REASON_BURST,
        r.episodeId,
        r.anchor,
        r.anchorShare,
        r.anchorKeys,
        r.burstFrom,
        r.burstTo,
        r.burstKeys,
        r.windowMinutes,
        r.distinctSources,
        prev.active,
        prev.monthly_limit,
        used,
        prev.no_recredit,
        prev.credits_remaining,
      );
      out.revoked++;
      // Les unités REPRISES sont celles qui restaient, jamais celles qui ont été
      // dépensées : le radar ne récupère pas le butin, il ferme le robinet.
      out.unitsReclaimed += Math.max((prev.monthly_limit ?? 0) - used, 0);
    }
  });
  tx.immediate(rows);
  return out;
}

/** Une ligne du journal, telle qu'elle est servie à l'administration. */
export interface KeyRevocationRow {
  id: number;
  key_prefix: string;
  origin_prefix: string | null;
  key_hash: string;
  revoked_at: string;
  reason: string;
  episode_id: string | null;
  anchor: string;
  anchor_share: number;
  anchor_keys: number;
  burst_from: string;
  burst_to: string;
  burst_keys: number;
  window_minutes: number;
  distinct_sources: number;
  prev_active: number;
  prev_monthly_limit: number | null;
  prev_units_used: number;
  prev_no_recredit: number;
  prev_credits_remaining: number | null;
  restored_at: string | null;
}

/** Plafond de lignes rendues par un appel, et son défaut. */
export const REVOCATIONS_PAGE_DEFAULT = 200;
export const REVOCATIONS_PAGE_MAX = 1000;

/**
 * Le journal, filtrable. `total` compte les lignes qui satisfont le filtre, pas
 * celles qui rentrent dans la page : un opérateur qui lit `n: 200` doit savoir
 * s'il en reste.
 *
 * 🚨 Le hash complet de la clé n'est JAMAIS rendu : il sert à écrire, pas à
 * lire, et une réponse d'administration qui le porte le fait entrer dans des
 * journaux et des presse-papiers. Le préfixe suffit à la lecture humaine, et la
 * restauration se fait côté serveur, par hash.
 */
export function listKeyRevocations(
  opts: {
    episodeId?: string;
    prefix?: string;
    pendingOnly?: boolean;
    limit?: number;
  } = {},
): { total: number; n: number; rows: Array<Omit<KeyRevocationRow, 'key_hash'>> } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.episodeId) {
    where.push('episode_id = ?');
    params.push(opts.episodeId);
  }
  if (opts.prefix) {
    where.push('(key_prefix = ? OR origin_prefix = ?)');
    params.push(opts.prefix, opts.prefix);
  }
  if (opts.pendingOnly) where.push('restored_at IS NULL');
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(
    Math.max(Math.trunc(opts.limit ?? REVOCATIONS_PAGE_DEFAULT), 1),
    REVOCATIONS_PAGE_MAX,
  );

  const db = getStatsDB();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM key_revocations ${clause}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT id, key_prefix, origin_prefix, revoked_at, reason, episode_id, anchor,
              anchor_share, anchor_keys, burst_from, burst_to, burst_keys, window_minutes,
              distinct_sources, prev_active, prev_monthly_limit, prev_units_used,
              prev_no_recredit, prev_credits_remaining, restored_at
         FROM key_revocations ${clause}
        ORDER BY revoked_at DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as Array<Omit<KeyRevocationRow, 'key_hash'>>;
  return { total, n: rows.length, rows };
}

/**
 * Cette clé a-t-elle été coupée pour rafale, et pas encore rendue ?
 *
 * Lue UNIQUEMENT sur le chemin d'échec du middleware (une clé présentée qui ne
 * valide pas), donc jamais sur le chemin chaud d'un client valide. L'index
 * (key_hash, restored_at) est là pour elle.
 *
 * Ne jette jamais : sur une base où la table n'existe pas encore (une image
 * revenue en arrière, un ordre de fusion inattendu), le middleware doit servir
 * son message historique, pas un 500.
 */
export function burstRevocationFor(keyHash: string): { revoked_at: string } | null {
  try {
    const row = getStatsDB()
      .prepare(
        `SELECT revoked_at FROM key_revocations
          WHERE key_hash = ? AND reason = ? AND restored_at IS NULL
          ORDER BY revoked_at DESC LIMIT 1`,
      )
      .get(keyHash, REVOCATION_REASON_BURST) as { revoked_at: string } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Rend une clé coupée pour rafale, telle qu'elle était : le pendant de
 * `revokeBurstBatch`, appelé par la RÉCLAMATION une fois le code vérifié
 * (lot 6b, 15/09/2026). L'appelant l'enchaîne avec la promotion dans UNE
 * transaction : si la promotion échouait, la clé serait rendue et non promue,
 * jamais promue et non rendue.
 *
 * 🚨 Par hash, jamais par préfixe (voir la migration). Rend `false` — et ne
 * touche rien — quand il n'y a rien à rendre : clé déjà active, ou aucune
 * ligne `anon_burst` non restaurée. L'ancien plafond et le drapeau de
 * non-recharge reviennent tels que le journal les a consignés ; la promotion
 * qui suit les réécrit, et c'est voulu.
 */
export function restoreBurstRevocation(keyHash: string): boolean {
  const db = getStatsDB();
  const tx = db.transaction((): boolean => {
    const row = db
      .prepare(
        `SELECT prev_monthly_limit, prev_no_recredit FROM key_revocations
          WHERE key_hash = ? AND reason = ? AND restored_at IS NULL
          ORDER BY revoked_at DESC, id DESC LIMIT 1`,
      )
      .get(keyHash, REVOCATION_REASON_BURST) as
      { prev_monthly_limit: number | null; prev_no_recredit: number } | undefined;
    if (!row) return false;
    const res = db
      .prepare(
        `UPDATE api_keys
            SET active = 1, deactivated_at = NULL, monthly_limit = ?, no_recredit = ?
          WHERE key_hash = ? AND active = 0`,
      )
      .run(row.prev_monthly_limit, row.prev_no_recredit, keyHash);
    if (res.changes === 0) return false;
    db.prepare(
      `UPDATE key_revocations SET restored_at = datetime('now')
        WHERE key_hash = ? AND reason = ? AND restored_at IS NULL`,
    ).run(keyHash, REVOCATION_REASON_BURST);
    return true;
  });
  return tx();
}

/** Ré-export pour que la route de coupe manuelle lotisse comme la passe. */
export { ANON_REVOCATION_BATCH };
