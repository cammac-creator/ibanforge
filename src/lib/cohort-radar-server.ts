/**
 * Cohort radar — the I/O half.
 *
 * Reads the signup ledger, hands it to the pure decision in cohort-radar.ts, and
 * applies the outcome: the matched signups are collapsed into one dossier under
 * a synthetic address, and opted out of the monthly allowance reset so an
 * allowance already spent does not come back on the 1st.
 *
 * Runs on its own periodic tick, off the request path: nothing here can add
 * latency to a customer call or refuse one. The worst case for a wrong match is
 * a display change plus a quota basis, both undone by a single call with the
 * saved mapping — no key is ever deactivated there.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEPUIS LE LOT 6 : une SECONDE passe, sur le palier ANONYME
 * ────────────────────────────────────────────────────────────────────────────
 * La passe e-mail ci-dessus est inchangée au caractère près. La passe anonyme
 * qui la suit ne renomme personne : elle peut DÉSACTIVER des clés, ce qui est
 * une action d'une autre nature, et c'est pourquoi elle part ÉTEINTE
 * (`IBANFORGE_REVOCATION_ENABLED` absent) et ne coupe qu'à la main, par
 * `POST /v1/admin/cohorts/cut`.
 *
 * Elle a son propre chargeur, et ce n'est pas du zèle : deux clauses de
 * `loadCreations` (`no_recredit = 0`, `monthly_limit IS NULL`) sont FAUSSES par
 * construction pour une clé anonyme, qui porte un plafond nommé et, née sous
 * alerte, le drapeau de non-recharge. Recopier le chargeur rendrait zéro ligne :
 * radar vert, rapport `anon_scanned: 0`, aucun test existant en échec, et
 * personne ne saurait que le module ne fait rien. C'est le mode de panne le plus
 * probable de tout ce chantier, et il est silencieux.
 */

import { getStatsDB } from './db.js';
import { isInternalEmail, registerInternalEmailFn } from './internal-accounts.js';
import { kvGet, kvSet, sendTelegramShort } from './forum-radar-server.js';
import { notifyOps } from './ops-alert.js';
import {
  findCohorts,
  cohortAddress,
  findBurst,
  groupAnonymousCohorts,
  creationMs,
  toSqliteUtc,
  ANON_BURST_WINDOWS,
  ANON_ANCHOR_MIN_KEYS,
  ANON_CONFIRM_TICKS,
  ANON_REVOCATIONS_PER_TICK_MAX,
  ANON_REVOCATION_BATCH,
  ANCHOR_TRUST_DAYS,
  ANCHOR_TRUST_MIN_KEYS,
  ANCHOR_TRUST_MIN_SOURCES,
  ANCHOR_TRUST_MIN_SPREAD_DAYS,
  BREAKER_MIN_DISTINCT_SOURCES,
  UNKNOWN_SOURCE,
  type CreationRow,
  type Cohort,
  type AnonCreationRow,
  type AnonCohort,
  type Burst,
} from './cohort-radar.js';
import { CLAIM_REPAIR_LANDED } from './tiers.js';
import { isShieldArmed, shieldArmedAtMs, shieldEpisodeId } from './shield-state.js';
import {
  sweepBreaker,
  breakerDisabledByEnv as breakerDisabledByEnvOwner,
} from './creation-breaker.js';
import { revokeBurstBatch, type BurstRevocationInput } from './key-revocations.js';

/**
 * Le battement du timer reste FIXE à cinq minutes ; c'est le DÛ qui devient
 * conditionnel (5 min sous alerte, 60 min en paix).
 *
 * Pourquoi pas un `setInterval` adaptatif : il faudrait `clearInterval` puis
 * réarmer à chaque bascule, donc une course entre le tick en vol et le
 * réarmement, pour un gain nul. Le corps du tick porte déjà la garde de dû et le
 * verrou `running`.
 *
 * 🚨 L'homme mort OPS n'est pas cassé par ce changement : il lit
 * `cohort_radar_last_run` comme une chaîne ISO nue avec un âge maximal de trois
 * heures, et le radar repointe désormais PLUS souvent, jamais moins. Ne pas
 * « uniformiser » cette clé en objet JSON.
 */
const TICK_MS = 5 * 60 * 1000;
/** Offset from the lifecycle (5'), forum (3') and prospect (4') radars. */
const BOOT_DELAY_MS = 6 * 60 * 1000;
const DUE_AFTER_PEACE_MS = 60 * 60 * 1000;
const DUE_AFTER_SHIELD_MS = 5 * 60 * 1000;
const LOOKBACK_HOURS = 24 * 7;
/**
 * Fenêtre de chargement de la passe ANONYME, en heures — six, pas sept jours.
 *
 * La passe e-mail regarde une semaine parce qu'elle renomme des fiches, geste
 * réversible d'un appel. Celle-ci désactive des clés : sa fenêtre est bornée par
 * ce qu'un opérateur peut encore relire, et par la taille du lot qu'un tick doit
 * pouvoir traiter sans bloquer la boucle d'événements.
 */
const ANON_LOOKBACK_HOURS = 6;

const KV_LAST_RUN = 'cohort_radar_last_run';
const KV_LAST_REPORT = 'cohort_radar_last_report';
/** Drapeau posé par le disjoncteur à l'armement (lot 5), consommé par le tick. */
const KV_SCAN_DUE = 'cohort_scan_due';
/** Compteur de confirmation : combien de ticks cette ancre a-t-elle été vue. */
const KV_SEEN_ANCHORS = 'anon_cohorts_seen';
/** Signature de la dernière alerte envoyée, pour ne pas la répéter tous les 5 min. */
const KV_NOTIFIED = 'anon_cohorts_notified';

/** Pourquoi une cohorte vue n'a pas été coupée. Le rapport doit toujours le dire. */
export type AnonSkippedReason =
  | 'below_anchor_floor'
  | 'below_source_floor'
  | 'not_armed'
  | 'breaker_disabled'
  | 'revocation_off'
  | 'claim_repair_missing'
  | 'trusted_anchor'
  | 'awaiting_confirm';

export interface CohortRadarReport {
  finished_at: string;
  scanned: number;
  cohorts: Array<{
    user_agent: string;
    address: string;
    keys: number;
    window_hours: number;
    machine_shape_ratio: number;
    first_seen: string;
    last_seen: string;
  }>;
  /** Lignes anonymes chargées. 🚨 Un 0 avec des clés anonymes récentes = chargeur recopié. */
  anon_scanned: number;
  shield_armed: boolean;
  /** La rafale GLOBALE de la fenêtre, toutes ancres confondues. `null` si aucune. */
  anon_burst: { from: string; to: string; keys: number; window_minutes: number } | null;
  /** Candidats non traités faute de plafond par tick, repris au tick suivant. */
  anon_pending: number;
  /** Clés réellement coupées par cette passe. Zéro tant que la révocation est éteinte. */
  anon_revoked: number;
  /** Durée de la passe anonyme, en millisecondes. */
  anon_ms: number;
  revocations: Array<{
    anchor: string;
    episode_id: string | null;
    /** Clés coupées. 0 quand on rapporte sans couper, ce qui est le mode par défaut. */
    keys: number;
    /** Lignes dans le rayon AVANT la décision de couper. */
    candidates: number;
    /** Part de l'ancre dans la rafale. RAPPORTÉE, elle ne décide rien. */
    anchor_share: number;
    /** ip_hash distincts dans le rayon : la garde de diversité. */
    distinct_sources: number;
    skipped_reason?: AnonSkippedReason;
    window_minutes: number;
    burst_from: string;
    burst_to: string;
    units_reclaimed: number;
  }>;
  errors: string[];
}

/**
 * Signups from the lookback window, joined to the key they minted.
 *
 * The WHERE clause is the safety net, and every line of it is a class of key
 * this radar must never touch:
 *  - our own accounts;
 *  - anything already regrouped (idempotent re-runs, no cascading renames);
 *  - a key holding prepaid credits, or on a custom allowance: both mean money
 *    changed hands;
 *  - a key already switched off — nothing left to decide.
 */
/**
 * 🚨 Chargé sur le PALIER (`tier = 'email'`), plus sur des valeurs dérivées.
 *
 * Jusqu'au 15/09/2026 ce chargeur exigeait `no_recredit = 0 AND monthly_limit
 * IS NULL` : deux valeurs qui décrivaient « une clé gratuite ordinaire » tant
 * que rien d'autre ne les écrivait. Le bouclier du disjoncteur (lot 5) pose
 * `monthly_limit = 5` et `no_recredit = 1` sur toute clé née sous alerte, et la
 * remontée écrit `monthly_limit = 200` (une VALEUR, là où l'historique portait
 * NULL) : ces clés sortaient des deux passes du radar, définitivement — vues
 * par personne, jamais regroupées (revue adversariale du 15/09, lentille panne
 * silencieuse, constat R1). Le palier dit l'intention sans dépendre de ce que
 * d'autres modules écrivent dans les colonnes de quota. Les clés relabellisées
 * par une cohorte restent exclues par leur adresse `@cohorte.invalid`, les
 * payantes par leur palier, les nôtres par `issued_by_us`.
 */
function loadCreations(): CreationRow[] {
  return getStatsDB()
    .prepare(
      `SELECT c.key_prefix, c.user_agent, c.created_at, k.email
         FROM key_creations c
         JOIN api_keys k ON k.key_prefix = c.key_prefix
        WHERE c.created_at >= datetime('now', ?)
          AND c.key_prefix IS NOT NULL
          AND c.user_agent IS NOT NULL
          AND k.active = 1
          AND k.tier = 'email'
          AND k.issued_by_us = 0
          AND k.credits_remaining IS NULL
          AND k.credits_total IS NULL
          -- Lot B2 (25.09.2026) : un abonnement se pose désormais sur une clé
          -- existante, qui garde son palier « email ». Une clé qui porte un
          -- abonnement, ou dont la lignée a payé, ne se regroupe jamais : le
          -- regroupement la relabelliserait et lui poserait no_recredit.
          AND k.stripe_subscription_id IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM key_purchases kp
                 WHERE kp.lineage_hash = COALESCE(k.lineage_hash, k.key_hash)
                   AND kp.outcome <> 'failed')
          AND k.email NOT LIKE '%@cohorte.invalid'`,
    )
    .all(`-${LOOKBACK_HOURS} hours`)
    .filter((r) => !isInternalEmail((r as { email: string }).email)) as CreationRow[];
}

/**
 * Les créations ANONYMES de la fenêtre courte, candidates au rayon.
 *
 * 🚨 Ce chargeur n'est PAS `loadCreations()` avec un filtre en plus. Ses deux
 * clauses `no_recredit = 0` et `monthly_limit IS NULL` sont FAUSSES par
 * construction pour une clé anonyme (plafond nommé, non-recharge sous alerte) :
 * les recopier viderait la passe en silence.
 *
 * 🚨 La jointure passe par `COALESCE(k.origin_prefix, k.key_prefix)`. Une clé qui
 * a tourné porte un `key_prefix` NEUF et n'a AUCUNE ligne `key_creations` à son
 * nom : jointe sur `k.key_prefix`, elle sortirait du rayon pour un seul appel sur
 * une route libre-service, publiquement documentée et sans plafond.
 * `origin_prefix` est la lignée, et c'est elle qui referme cette évasion — pas
 * `shield_episode`, que ce radar ne lit jamais.
 *
 * 🚨 `tier IN ('anonymous','claimed')`, et c'est délibéré : une clé RÉCLAMÉE est
 * chargée, comptée dans la rafale, regroupée et rapportée. L'observation est
 * large, l'ACTION est étroite — l'UPDATE qui coupe, lui seul, garde
 * `tier = 'anonymous' AND claimed_at IS NULL`. Les deux moitiés sont jumelles :
 * appliquer l'une sans l'autre est pire que ne rien faire. Motif : une passe qui
 * ne charge pas les clés réclamées ne peut pas dire à l'opérateur qu'un client
 * réel est dans le rayon, ce qui est exactement l'information dont il a besoin
 * pour décider de ne PAS couper.
 *
 * 🚨 Ce chargeur n'applique PAS la clause que la spec du device grant lui
 * demandait (exclure les clés d'un grant approuvé depuis un autre réseau). Refus
 * motivé et contractuel : telle qu'écrite elle est inerte (un préfixe de douze
 * caractères comparé à un hash de soixante-quatre, donc un `NOT IN` toujours
 * vrai), et réparée dans son intention elle est pire — « approuvé depuis un autre
 * réseau » est une condition qu'un parc de proxys satisfait gratuitement, ce qui
 * rendrait toute clé du device grant définitivement irrévocable. Une exclusion du
 * rayon ne dépend JAMAIS d'une valeur que l'appelant choisit.
 *
 * 🚨 Pas de branche `k.email IS NULL` : `api_keys.email` est `TEXT NOT NULL`, et
 * une clé anonyme porte la sentinelle `'anonymous'`, qui passe la clause
 * `NOT LIKE '%@cohorte.invalid'` d'elle-même puisqu'elle n'a pas d'arobase.
 *
 * `sinceSql` arrive au format `'YYYY-MM-DD HH:MM:SS'`, celui que `datetime('now')`
 * écrit, pour que la comparaison de chaînes SQLite reste correcte.
 */
function loadAnonymousCreations(sinceSql: string): AnonCreationRow[] {
  const db = getStatsDB();
  registerInternalEmailFn(db);
  return db
    .prepare(
      `SELECT c.key_prefix AS birth_prefix, c.user_agent, c.created_at, c.ip_hash,
              k.key_hash, k.key_prefix,
              CASE WHEN c.ip_hash = ? THEN NULL ELSE (
                SELECT MIN(p.created_at) FROM key_creations p WHERE p.ip_hash = c.ip_hash
              ) END AS ip_first_seen
         FROM key_creations c
         JOIN api_keys k ON COALESCE(k.origin_prefix, k.key_prefix) = c.key_prefix
        WHERE c.created_at >= ?
          AND c.key_prefix IS NOT NULL
          AND k.active = 1
          AND k.tier IN ('anonymous','claimed')
          AND k.credits_remaining IS NULL
          AND k.credits_total IS NULL
          AND k.stripe_session_id IS NULL
          AND k.stripe_subscription_id IS NULL
          AND k.amount_paid_minor IS NULL
          AND k.issued_by_us = 0
          AND is_internal_email(k.email) = 0
          AND k.email NOT LIKE '%@cohorte.invalid'
        ORDER BY c.created_at ASC`,
    )
    .all(UNKNOWN_SOURCE, sinceSql) as AnonCreationRow[];
}

/**
 * Les User-Agents sous lesquels de VRAIS clients sont arrivés, à plusieurs,
 * depuis plusieurs réseaux, et pas d'un coup. On RAPPORTE sous ces ancres, on ne
 * coupe pas tout seul ; un appel admin coupe.
 *
 * 🚨 CE QU'UNE VERSION PLUS SIMPLE FAISAIT, ET POURQUOI C'ÉTAIT UN OPT-OUT À UN
 * EURO. Protéger toute chaîne sous laquelle UNE clé réclamée existe se fabrique
 * entièrement dans le produit : créer une clé anonyme en envoyant
 * `User-Agent: Zx/1.0`, faire un appel avec elle, la réclamer par code à six
 * chiffres avec UNE boîte jetable — et pour trente jours, `ua:Zx/1.0` est
 * protégé, donc toute une ferme sous cette chaîne sort en `trusted_anchor`. Coût :
 * une boîte et un appel. C'était le renoncement au radar tout entier.
 *
 * Ce que le coût d'entrée est devenu : au moins trois clés réclamées ou payantes
 * distinctes, nées sur au moins trois réseaux distincts, et étalées sur au moins
 * une semaine. Trois boîtes, trois réseaux, de la patience. C'est beaucoup plus
 * cher qu'une boîte, et ce n'est PAS hors de portée : c'est précisément pourquoi
 * la protection ne donne plus une immunité MUETTE. La cohorte est rapportée avec
 * son nombre de candidats, l'alerte part, et un appel coupe.
 *
 * Pourquoi calculée et pas une liste en dur : le client officiel change de chaîne
 * à chaque version, et une liste figée protégerait la version d'hier.
 *
 * Exportée pour être testée directement : dans l'ordre de lisibilité des gardes,
 * `trusted_anchor` vient APRÈS l'absence de réparation par réclamation, donc ce
 * motif n'apparaît dans aucun rapport tant que celle-ci n'est pas livrée — et
 * une protection qu'aucun test ne peut observer est une protection qu'on croit
 * avoir.
 */
export function trustedAnchors(): Set<string> {
  const rows = getStatsDB()
    .prepare(
      `SELECT c.user_agent AS ua
         FROM key_creations c
         JOIN api_keys k ON COALESCE(k.origin_prefix, k.key_prefix) = c.key_prefix
        WHERE k.tier IN ('claimed','paid')
          AND c.user_agent IS NOT NULL
          AND c.ip_hash <> ?
          AND c.created_at >= datetime('now', ?)
        GROUP BY c.user_agent
       HAVING COUNT(DISTINCT k.key_hash) >= ?
          AND COUNT(DISTINCT c.ip_hash) >= ?
          AND julianday(MAX(c.created_at)) - julianday(MIN(c.created_at)) >= ?`,
    )
    .all(
      UNKNOWN_SOURCE,
      `-${ANCHOR_TRUST_DAYS} days`,
      ANCHOR_TRUST_MIN_KEYS,
      ANCHOR_TRUST_MIN_SOURCES,
      ANCHOR_TRUST_MIN_SPREAD_DAYS,
    ) as Array<{ ua: string }>;
  return new Set(rows.map((r) => `ua:${r.ua}`));
}

/**
 * Le début de la fenêtre de chargement anonyme.
 *
 * `max(armed_at - fenêtre du disjoncteur, maintenant - 6 h)` : sous alerte on
 * remonte à l'heure qui précède l'armement, parce que les clés d'une rafale
 * naissent AVANT que le seuil ne soit franchi ; hors alerte, six heures.
 */
function anonSince(nowMs: number): string {
  const armedAt = shieldArmedAtMs();
  const floor = nowMs - ANON_LOOKBACK_HOURS * 3600 * 1000;
  const fromEpisode = armedAt === null ? floor : armedAt - 60 * 60 * 1000;
  return toSqliteUtc(Math.max(floor, fromEpisode));
}

/**
 * L'opt-in de la révocation, lu À CHAQUE PASSE et jamais au niveau du module.
 *
 * 🚨 Lu au niveau du module, un redémarrage serait nécessaire pour l'appliquer,
 * ce qui annule l'intérêt d'un interrupteur de sortie de crise. Et son sens est
 * inversé exprès : ce qui protège part armé, ce qui COUPE part éteint.
 */
function revocationEnabled(): boolean {
  return process.env.IBANFORGE_REVOCATION_ENABLED === '1';
}

/**
 * L'interrupteur de crise du disjoncteur, qui éteint aussi la révocation.
 *
 * DÉLÈGUE au propriétaire, `creation-breaker.ts` (lot 5), depuis le 15/09/2026.
 * Ce fichier relisait `process.env` une seconde fois en attendant ce lot : deux
 * lecteurs de la même variable finissent toujours par diverger sur la forme
 * acceptée (`1`, `true`, espaces) et l'un des deux éteint alors ce que l'autre
 * croit allumé.
 */
function breakerDisabledByEnv(): boolean {
  return breakerDisabledByEnvOwner();
}

interface SeenAnchors {
  episode_id: string | null;
  anchors: Record<string, number>;
}

/** Le compteur de confirmation, remis à zéro à chaque nouvel épisode. */
function readSeenAnchors(episodeId: string | null): SeenAnchors {
  try {
    const parsed = JSON.parse(kvGet(KV_SEEN_ANCHORS) ?? 'null') as SeenAnchors | null;
    if (parsed && parsed.episode_id === episodeId && typeof parsed.anchors === 'object') {
      return { episode_id: episodeId, anchors: { ...parsed.anchors } };
    }
  } catch {
    /* état illisible : on repart d'un compteur vide, jamais d'une exception */
  }
  return { episode_id: episodeId, anchors: {} };
}

function writeSeenAnchors(seen: SeenAnchors): void {
  kvSet(KV_SEEN_ANCHORS, JSON.stringify(seen));
}

/**
 * Collapse one cohort into a single dossier and take it off the monthly reset.
 * Each key's previous address is written to `cohort_relabels` first, in the same
 * transaction, so a wrong match can always be undone — the radar has no caller
 * to hand the mapping back to, unlike the manual relabel endpoint.
 */
function applyCohort(cohort: Cohort, day: string): string {
  const db = getStatsDB();
  const address = cohortAddress(cohort.userAgent, day);
  const readEmail = db.prepare('SELECT key_prefix, email FROM api_keys WHERE key_prefix = ?');
  const saveUndo = db.prepare(
    'INSERT INTO cohort_relabels (key_prefix, old_email, address) VALUES (?, ?, ?)',
  );
  const write = db.prepare('UPDATE api_keys SET email = ?, no_recredit = 1 WHERE key_prefix = ?');
  const tx = db.transaction(() => {
    for (const prefix of cohort.keyPrefixes) {
      const before = readEmail.get(prefix) as { key_prefix: string; email: string } | undefined;
      if (!before) continue; // key vanished between scan and apply — skip, don't invent
      saveUndo.run(before.key_prefix, before.email, address);
      write.run(address, prefix);
    }
  });
  tx();
  return address;
}

/** L'entrée de journal d'une ligne du rayon, prête pour `revokeBurstBatch`. */
function toRevocationInput(
  row: AnonCreationRow,
  cohort: AnonCohort,
  burst: Burst,
  episodeId: string | null,
): BurstRevocationInput {
  return {
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    // `key_revocations.origin_prefix` suit la convention d'`api_keys` : NULL
    // quand la clé n'a jamais tourné, puisque son préfixe courant EST sa lignée.
    // Le renseigner quand même ferait croire à une rotation qui n'a pas eu lieu.
    originPrefix: row.birth_prefix === row.key_prefix ? null : row.birth_prefix,
    episodeId,
    anchor: cohort.anchor,
    anchorShare: cohort.rows.length / burst.keys,
    anchorKeys: cohort.rows.length,
    // 🚨 Format SQLite, PAS ISO : le journal se relit en comparant ces bornes à
    // des `created_at` de la même table, et une comparaison de chaînes entre
    // deux formats différents est silencieusement fausse.
    burstFrom: toSqliteUtc(burst.startMs),
    burstTo: toSqliteUtc(burst.endMs),
    burstKeys: burst.keys,
    windowMinutes: burst.window.hours * 60,
    distinctSources: cohort.distinctSources,
  };
}

/**
 * Coupe une liste de lignes par lots, en rendant la main entre deux lots.
 *
 * 🚨 Rendre la main n'est pas du confort. better-sqlite3 est SYNCHRONE et Node
 * est mono-fil : sans ce point de respiration, cinq cents transactions
 * d'écriture bloquent l'API pour tout le monde, clients payants compris. Sûr
 * vis-à-vis de la ré-entrée : le verrou `running` interdit une seconde passe.
 */
async function cutInBatches(
  inputs: BurstRevocationInput[],
): Promise<{ revoked: number; skipped: number; units: number }> {
  let revoked = 0;
  let skipped = 0;
  let units = 0;
  for (let i = 0; i < inputs.length; i += ANON_REVOCATION_BATCH) {
    const r = revokeBurstBatch(inputs.slice(i, i + ANON_REVOCATION_BATCH));
    revoked += r.revoked;
    skipped += r.skipped.length;
    units += r.unitsReclaimed;
    await new Promise((res) => setImmediate(res));
  }
  return { revoked, skipped, units };
}

/**
 * La passe anonyme. Deux temps, et le premier est AVEUGLE À L'ANCRE :
 *  1. la rafale GLOBALE, mesurée sur toutes les lignes anonymes de la fenêtre ;
 *  2. le rayon, borné par l'ancre, dans cette rafale.
 *
 * La rafale globale est la seule grandeur que l'attaquant ne fabrique pas : elle
 * compte des lignes, comme le disjoncteur, et pour la même raison. L'ancre, elle,
 * est un en-tête que l'appelant écrit — elle ne sert qu'à borner les victimes.
 */
async function runAnonymousPass(report: CohortRadarReport, nowMs: number): Promise<void> {
  const armed = isShieldArmed();
  report.shield_armed = armed;
  const episodeId = shieldEpisodeId();
  const armedAtMs = shieldArmedAtMs();

  const anonRows = loadAnonymousCreations(anonSince(nowMs));
  report.anon_scanned = anonRows.length;
  if (anonRows.length === 0) return;

  const burst = findBurst(
    anonRows.map((r) => creationMs(r.created_at)).sort((a, b) => a - b),
    ANON_BURST_WINDOWS,
  );
  if (!burst) return;
  report.anon_burst = {
    from: new Date(burst.startMs).toISOString(),
    to: new Date(burst.endMs).toISOString(),
    keys: burst.keys,
    window_minutes: burst.window.hours * 60,
  };

  const trusted = trustedAnchors();
  const seen = readSeenAnchors(episodeId);
  const disabled = breakerDisabledByEnv();
  const enabled = revocationEnabled();
  let budget = ANON_REVOCATIONS_PER_TICK_MAX;

  for (const cohort of groupAnonymousCohorts(anonRows, burst, armedAtMs)) {
    const line = {
      anchor: cohort.anchor,
      episode_id: episodeId,
      keys: 0,
      candidates: cohort.rows.length,
      anchor_share: Math.round((cohort.rows.length / burst.keys) * 1000) / 1000,
      distinct_sources: cohort.distinctSources,
      window_minutes: burst.window.hours * 60,
      burst_from: report.anon_burst.from,
      burst_to: report.anon_burst.to,
      units_reclaimed: 0,
    };
    const ticks = (seen.anchors[cohort.anchor] = (seen.anchors[cohort.anchor] ?? 0) + 1);

    // L'ordre de ces gardes est un ordre de LISIBILITÉ : le rapport doit dire le
    // motif le plus informatif, pas le premier venu. Les deux gardes
    // structurelles (celles qui protègent des inconnus) passent avant les
    // interrupteurs d'exploitation, qui eux passent avant les gardes de patience.
    let reason: AnonSkippedReason | null = null;
    if (cohort.rows.length < ANON_ANCHOR_MIN_KEYS) reason = 'below_anchor_floor';
    else if (cohort.distinctSources < BREAKER_MIN_DISTINCT_SOURCES) reason = 'below_source_floor';
    else if (!armed) reason = 'not_armed';
    else if (disabled) reason = 'breaker_disabled';
    else if (!enabled) reason = 'revocation_off';
    else if (!CLAIM_REPAIR_LANDED) reason = 'claim_repair_missing';
    else if (trusted.has(cohort.anchor)) reason = 'trusted_anchor';
    else if (ticks < ANON_CONFIRM_TICKS) reason = 'awaiting_confirm';

    if (reason !== null) {
      report.revocations.push({ ...line, skipped_reason: reason });
      continue;
    }

    const target = cohort.rows.slice(0, budget);
    report.anon_pending += cohort.rows.length - target.length;
    const cut = await cutInBatches(
      target.map((row) => toRevocationInput(row, cohort, burst, episodeId)),
    );
    budget -= target.length;
    report.anon_revoked += cut.revoked;
    report.revocations.push({ ...line, keys: cut.revoked, units_reclaimed: cut.units });
    if (budget <= 0) break;
  }
  writeSeenAnchors(seen);
}

/**
 * L'alerte de la passe anonyme, sur le canal d'exploitation.
 *
 * 🚨 Elle ne se répète pas tous les cinq minutes. Sous alerte, la passe repasse
 * toutes les cinq minutes et un épisode dure jusqu'à trois heures : une alerte
 * par passe ferait des dizaines de messages identiques, donc un canal qu'on
 * cesse de lire, donc la panne suivante invisible. Elle ne repart que si la
 * SIGNATURE change (épisode, ancres, motifs, nombre de clés).
 *
 * 🚨 Aucune adresse, jamais : le canal n'est pas un sous-traitant déclaré. Des
 * nombres de clés et d'unités, et l'ancre, qui est une chaîne d'en-tête publique.
 */
async function notifyAnonymousPass(report: CohortRadarReport): Promise<void> {
  if (report.revocations.length === 0) return;
  const signature = JSON.stringify(
    report.revocations.map((r) => [r.anchor, r.skipped_reason ?? 'cut', r.keys, r.candidates]),
  );
  if (kvGet(KV_NOTIFIED) === signature) return;

  const cut = report.revocations.filter((r) => r.keys > 0);
  const seenOnly = report.revocations.filter((r) => r.keys === 0);
  const messages: string[] = [];
  if (cut.length > 0) {
    messages.push(
      'IBANforge · clés anonymes révoquées\n' +
        cut
          .map(
            (r) =>
              `• ${r.keys} clés · ${r.anchor.slice(0, 48)} · ${r.candidates} clés dans une rafale globale de ${report.anon_burst?.keys ?? 0} · ${r.units_reclaimed} unités reprises`,
          )
          .join('\n') +
        '\nAnnulable : les anciens soldes sont dans key_revocations (GET /v1/admin/key-revocations).',
    );
  }
  if (seenOnly.length > 0) {
    messages.push(
      'IBANforge · rafale VUE, non coupée\n' +
        seenOnly
          .slice(0, 12)
          .map(
            (r) =>
              `• ${r.candidates} clés · ${r.anchor.slice(0, 48)} · motif : ${r.skipped_reason}`,
          )
          .join('\n') +
        (seenOnly.length > 12 ? `\n• … et ${seenOnly.length - 12} autres ancres` : '') +
        '\nCouper cette cohorte : POST /v1/admin/cohorts/cut {"anchor":"…"}.' +
        '\nRapport complet : GET /v1/admin/cohort-scan.',
    );
  }
  for (const m of messages) await notifyOps(m);
  kvSet(KV_NOTIFIED, signature);
}

let running = false;

/**
 * One pass. Never throws upward: a radar that takes the process down with it is
 * worse than a radar that misses a pass.
 */
export async function runCohortScan(now: Date = new Date()): Promise<CohortRadarReport> {
  const report: CohortRadarReport = {
    finished_at: now.toISOString(),
    scanned: 0,
    cohorts: [],
    anon_scanned: 0,
    shield_armed: false,
    anon_burst: null,
    anon_pending: 0,
    anon_revoked: 0,
    anon_ms: 0,
    revocations: [],
    errors: [],
  };
  if (running) {
    report.errors.push('already_running');
    return report;
  }
  running = true;
  try {
    const rows = loadCreations();
    report.scanned = rows.length;
    const day = now.toISOString().slice(0, 10);

    for (const cohort of findCohorts(rows, now)) {
      try {
        const address = applyCohort(cohort, day);
        report.cohorts.push({
          user_agent: cohort.userAgent,
          address,
          keys: cohort.keyPrefixes.length,
          window_hours: cohort.windowHours,
          machine_shape_ratio: cohort.machineShapeRatio,
          first_seen: cohort.firstSeen,
          last_seen: cohort.lastSeen,
        });
      } catch (err) {
        // One bad cohort must not cost the others: record and carry on.
        report.errors.push(
          `${cohort.userAgent}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // La passe anonyme a SA PROPRE garde. `runCohortScan` n'a qu'un `finally` et
    // aucun `catch` ; la boucle par cohorte de la passe e-mail a le sien, mais il
    // ne couvre pas ce qui est écrit à côté d'elle. Une passe anonyme qui jette
    // ne doit coûter ni la passe e-mail, ni le rapport, ni les `kvSet` qui
    // suivent. Le cas le plus probable est la fenêtre où ce lot est fusionné
    // avant celui qui pose les colonnes : « no such column: k.tier ».
    const anonStart = Date.now();
    try {
      await runAnonymousPass(report, now.getTime());
    } catch (err) {
      report.errors.push(`anon: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      report.anon_ms = Date.now() - anonStart;
    }

    // Persist the report BEFORE the Telegram call. sendTelegramShort throws on
    // failure; if it did so after these writes, a pass that already relabelled
    // keys would leave no trace at all (and the undo trail in cohort_relabels
    // would be the only record of what was touched).
    kvSet(KV_LAST_REPORT, JSON.stringify(report));
    kvSet(KV_LAST_RUN, report.finished_at);

    if (report.cohorts.length > 0) {
      const lines = report.cohorts.map(
        (c) => `• ${c.keys} inscriptions regroupées — ${c.user_agent.slice(0, 40)} (${c.address})`,
      );
      try {
        await sendTelegramShort(
          `IBANforge · inscriptions automatiques regroupées\n${lines.join('\n')}\nQuota mensuel non reconduit. Annulable via le mapping (POST /v1/admin/keys/relabel).`,
        );
      } catch (err) {
        // A missed notification must not lose the pass: the report is already saved.
        report.errors.push(`telegram: ${err instanceof Error ? err.message : String(err)}`);
        kvSet(KV_LAST_REPORT, JSON.stringify(report));
      }
    }

    // `notifyOps` ne jette jamais et respecte OPS_ALERTS_DISABLED : pas de
    // try/catch nécessaire, contrairement à `sendTelegramShort` juste au-dessus.
    await notifyAnonymousPass(report);
    return report;
  } finally {
    running = false;
  }
}

/**
 * La voie MANUELLE : couper en un appel une cohorte que la passe a vue et n'a pas
 * coupée.
 *
 * 🚨 C'est cette fonction qui rend acceptables l'ancre protégée ET la révocation
 * éteinte par défaut. Sans elle, une ancre fabriquée par un attaquant donne une
 * immunité MUETTE : la passe voit la ferme, la nomme, et rien ne se passe jusqu'à
 * ce que quelqu'un écrive du SQL à la main sur la production. Avec elle, la
 * protection n'achète qu'un DÉLAI et un regard humain.
 *
 * 🚨 Elle applique les onze clauses SQL du rayon (palier, réclamation, crédits,
 * cumul réglé, compte interne, fenêtre de rafale) mais AUCUNE des gardes
 * consultatives de la passe : ni le plancher d'ancre, ni le plancher de réseaux,
 * ni la confirmation sur deux ticks, ni l'opt-in d'environnement, ni la
 * protection d'ancre. Ces gardes existent parce qu'une machine décide seule ;
 * ici, un humain a lu le rapport et porte la décision. Sans cette différence, la
 * seule voie de coupe que ce lot laisse ouverte ne fonctionnerait sur aucune
 * cohorte réelle — une ferme mono-IP n'a qu'un réseau par construction.
 *
 * Même plafond que la passe automatique, et le reste est rapporté en `pending`.
 */
export async function cutCohortNow(p: {
  anchor: string;
  episodeId?: string | null;
  now?: Date;
  /**
   * Lève la garde de diversité (au moins `BREAKER_MIN_DISTINCT_SOURCES` réseaux
   * dans le rayon). Sans ce drapeau, une cohorte vue depuis moins de réseaux est
   * REFUSÉE ici aussi : le rapport et l'alerte invitent l'opérateur à recopier
   * une ancre dans cette route, et l'ancre qu'il recopie est parfois celle que
   * la garde vient précisément d'épargner (`below_source_floor`) — un nouveau
   * venu isolé sous une chaîne générique, ou tout un NAT d'entreprise (revue
   * adversariale du 15/09, lentille empoisonnement, constat P2). `force: true`
   * reste possible, pour une ferme mono-IP relue et jugée : la décision est
   * alors écrite dans le corps de l'appel, pas prise par omission.
   */
  force?: boolean;
}): Promise<{
  revoked: number;
  skipped: number;
  pending: number;
  candidates: number;
  distinct_sources?: number;
  reason?: 'no_burst' | 'anchor_not_found' | 'below_source_floor';
}> {
  const nowMs = (p.now ?? new Date()).getTime();
  const rows = loadAnonymousCreations(anonSince(nowMs));
  const burst = findBurst(
    rows.map((r) => creationMs(r.created_at)).sort((a, b) => a - b),
    ANON_BURST_WINDOWS,
  );
  if (!burst) return { revoked: 0, skipped: 0, pending: 0, candidates: 0, reason: 'no_burst' };

  const cohort = groupAnonymousCohorts(rows, burst, shieldArmedAtMs()).find(
    (c) => c.anchor === p.anchor,
  );
  if (!cohort) {
    return { revoked: 0, skipped: 0, pending: 0, candidates: 0, reason: 'anchor_not_found' };
  }
  if (!p.force && cohort.distinctSources < BREAKER_MIN_DISTINCT_SOURCES) {
    return {
      revoked: 0,
      skipped: 0,
      pending: 0,
      candidates: cohort.rows.length,
      distinct_sources: cohort.distinctSources,
      reason: 'below_source_floor',
    };
  }

  const episodeId = p.episodeId ?? shieldEpisodeId();
  const target = cohort.rows.slice(0, ANON_REVOCATIONS_PER_TICK_MAX);
  const cut = await cutInBatches(
    target.map((row) => toRevocationInput(row, cohort, burst, episodeId)),
  );
  return {
    revoked: cut.revoked,
    skipped: cut.skipped,
    pending: cohort.rows.length - target.length,
    candidates: cohort.rows.length,
    distinct_sources: cohort.distinctSources,
  };
}

export function lastCohortReport(): {
  last_run_at: string | null;
  report: CohortRadarReport | null;
} {
  let parsed: CohortRadarReport | null;
  try {
    parsed = JSON.parse(kvGet(KV_LAST_REPORT) ?? 'null') as CohortRadarReport | null;
  } catch {
    parsed = null;
  }
  return { last_run_at: kvGet(KV_LAST_RUN) ?? null, report: parsed };
}

export function isCohortScanRunning(): boolean {
  return running;
}

/**
 * The undo trail: what each key's address was before the radar rewrote it.
 * To reverse a wrong match, feed these (key_prefix, old_email) pairs back to
 * POST /v1/admin/keys/relabel with no_recredit:false.
 */
export function getCohortRelabels(
  address?: string,
): Array<{ key_prefix: string; old_email: string; address: string; created_at: string }> {
  const db = getStatsDB();
  if (address) {
    return db
      .prepare(
        'SELECT key_prefix, old_email, address, created_at FROM cohort_relabels WHERE address = ? ORDER BY created_at DESC',
      )
      .all(address) as Array<{
      key_prefix: string;
      old_email: string;
      address: string;
      created_at: string;
    }>;
  }
  return db
    .prepare(
      'SELECT key_prefix, old_email, address, created_at FROM cohort_relabels ORDER BY created_at DESC LIMIT 500',
    )
    .all() as Array<{ key_prefix: string; old_email: string; address: string; created_at: string }>;
}

/**
 * Tick de cinq minutes, première passe quelques minutes après le démarrage.
 * Ne jette jamais vers le haut.
 *
 * Le battement est fixe, le DÛ est conditionnel : cinq minutes sous alerte,
 * soixante en paix. Et le drapeau posé par le disjoncteur à l'armement
 * court-circuite le dû, pour que la première passe d'un épisode ne soit pas
 * retardée d'une heure.
 *
 * 🚨 Le drapeau est consommé AVANT le scan : deux ticks ne le rejouent pas, et un
 * scan qui échoue ne le réarme pas tout seul en boucle.
 *
 * 🚨 `sweepBreaker()` est la PREMIÈRE ligne du tick, et elle y est AVANT la
 * garde de dû : c'est le seul battement du service qui ne dépende d'aucun
 * trafic, donc le seul endroit où un épisode calme, capé, ou laissé armé par
 * l'interrupteur de crise puisse retomber sans qu'une clé soit créée. Placée
 * après la garde de dû, elle ne tournerait qu'une fois par heure en paix — et
 * un épisode armé par la dernière création d'une ferme resterait armé.
 */
export function startCohortRadar(): void {
  const tick = async (): Promise<void> => {
    try {
      sweepBreaker();
    } catch (err) {
      // Le balayage ne jette pas, mais le radar ne doit pas mourir s'il change.
      console.error('[breaker] balayage:', err instanceof Error ? err.message : err);
    }
    try {
      const forced = kvGet(KV_SCAN_DUE) === '1';
      if (forced) kvSet(KV_SCAN_DUE, '0');
      const due = isShieldArmed() ? DUE_AFTER_SHIELD_MS : DUE_AFTER_PEACE_MS;
      const last = kvGet(KV_LAST_RUN);
      if (!forced && last && Date.now() - new Date(last).getTime() < due) return;
      await runCohortScan();
    } catch (err) {
      console.error('[cohort-radar] run failed:', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void tick(), BOOT_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}
