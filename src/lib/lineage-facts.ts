/**
 * Les faits de mesure d'une LIGNÉE de clé (lot M, 15/09/2026).
 *
 * L'unité de l'essai est une lignée, jamais une personne : une lignée survit à
 * `/v1/keys/rotate` et au rattachement par e-mail, et une clé payée distincte
 * peut lui être reliée commercialement sans que les quotas ni les droits se
 * réunissent (contrat de mesure du 15/09).
 *
 * ## Ce qui est écrit, et ce qui ne l'est jamais
 *
 * Des hachages, des dates UTC, des routes canoniques et des contextes pris
 * dans des valeurs contrôlées. JAMAIS un corps métier, un IBAN, une adresse
 * e-mail, une IP même hachée, une clé ou un secret de retrait. La table ne
 * porte pas d'événements mais UN état par lignée : chaque « premier » est
 * écrit une seule fois, par un COALESCE, donc rejouer le même fait ne change
 * rien. Le dédoublonnage est une propriété de la forme.
 *
 * ## La discipline du chemin chaud
 *
 * 🚨 Doctrine du lot 6, rappelée ici parce que ce module est appelé sur le
 * chemin de la RÉPONSE : un écrit de télémétrie ne transforme jamais un 200 en
 * 500. Tout est sous try/catch, et la journalisation d'erreur est bornée à une
 * fois par minute (une base en panne ferait sinon défiler une ligne par
 * requête servie).
 *
 * Le coût par requête est borné par un cache mémoire du jour UTC : au plus une
 * écriture par lignée, par contexte et par jour. Le compteur de jours actifs
 * reste juste malgré ce cache PARCE QU'IL EST IDEMPOTENT EN BASE
 * (`last_success_day`) : un redéploiement en milieu de journée vide le cache,
 * et sans cette colonne le jour serait compté deux fois sans qu'aucun test ne
 * rougisse.
 *
 * Aucune requête préparée n'est gardée au niveau module, volontairement : les
 * modules qui en gardent doivent être réinitialisés à chaque fermeture de base
 * (voir `resetStatsStatements` et sa famille), et la fréquence d'appel ici — au
 * plus deux écritures par lignée et par jour — ne justifie pas ce contrat
 * supplémentaire.
 */
import type DatabaseType from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { isBillableCall, normalizeRequestPath } from './stats.js';
import { isInternalEmail } from './internal-accounts.js';
import { normalizeLineageClient } from './lineage-clients.js';

/**
 * Le marqueur de contexte, en-tête de requête.
 *
 * Deux valeurs, et deux seulement : `demo` quand le panneau du site exécute
 * l'appel, `unknown` partout ailleurs. « Hors panneau » signifie contexte
 * OBSERVÉ, pas preuve d'un vrai dossier client : le contrat interdit de
 * déduire « production » d'une absence de marqueur, et la part de contexte
 * inconnu est publiée à côté de l'indicateur.
 */
export const CONTEXT_HEADER = 'X-IBANforge-Context';

export type LineageContext = 'demo' | 'unknown';

/** Toute valeur autre que `demo` — absence comprise — vaut `unknown`. */
export function normalizeLineageContext(raw: string | null | undefined): LineageContext {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'demo' ? 'demo' : 'unknown';
}

/**
 * Le jour UTC déjà vu, et pour quelles lignées.
 *
 * Deux sortes d'entrées : `<lignée>` dit que le jour est déjà compté,
 * `<lignée>|<contexte>` dit que ce contexte-là est déjà écrit aujourd'hui. Les
 * deux sont nécessaires : sans la seconde, un appel marqué `demo` le matin
 * empêcherait le premier appel sans marqueur de l'après-midi de poser
 * `first_unmarked_success_at`.
 *
 * Depuis le chantier « mesure agents » (15/09), la FAMILLE de client entre dans
 * la clé pour la même raison exactement : sans elle, le premier succès du jour
 * figerait `last_success_client` et un porteur qui passe du panneau du site à
 * son SDK dans la même journée serait lu comme n'ayant jamais quitté le
 * panneau. La borne reste petite et connue d'avance : deux contextes × huit
 * familles = au plus seize écritures par lignée et par jour.
 */
let cachedDay = '';
const seenToday = new Set<string>();

/** Dernière plainte journalisée, pour n'en écrire qu'une par minute. */
let lastComplaintMs = 0;

/**
 * Écritures de mesure en échec D'AFFILÉE, remises à zéro par la première
 * écriture qui réussit. Lu par la sonde `lineage:blind` (ops-probes) : une base
 * qui refuse l'écriture produisait un tableau à zéros, indiscernable de
 * « personne n'active » — exactement l'indicateur sur lequel la décision
 * d'ouvrir l'essai va se prendre (revue du 15/09, constat R4).
 */
let failureStreak = 0;
/** Échecs d'affilée au-delà desquels la sonde `lineage:blind` crie. */
export const LINEAGE_BLIND_STREAK = 3;
export function lineageWriteFailures(): number {
  return failureStreak;
}

function complain(err: unknown): void {
  failureStreak++;
  const now = Date.now();
  if (now - lastComplaintMs < 60_000) return;
  lastComplaintMs = now;
  console.error(
    '[lineage] écriture de mesure en échec :',
    err instanceof Error ? err.message : err,
  );
}

/** Pour les tests : repartir d'un cache vide sans attendre minuit UTC. */
export function resetLineageDayCache(): void {
  cachedDay = '';
  seenToday.clear();
  lastComplaintMs = 0;
  failureStreak = 0;
}

/**
 * La naissance d'une lignée, écrite AU FIL DE L'EAU.
 *
 * Appelée juste après la transaction qui frappe la clé, et non dedans : un
 * refus d'écriture ici ne doit pas annuler une clé déjà rendue à son porteur.
 * La perte est réparable — la migration sait reconstituer une naissance depuis
 * `api_keys`, et `recordLineageSuccess` crée la ligne manquante au premier
 * appel métier. C'est `lineage_hash`, sur `api_keys`, qui voyage DANS la
 * transaction : c'est une identité, pas de la télémétrie.
 *
 * `backfilled = 0` est le seul endroit où cette valeur est écrite : c'est ce
 * drapeau qui définit « depuis le démarrage de la nouvelle mesure ».
 *
 * ## 🚨 La preuve de boîte POSÉE À LA NAISSANCE (« mesure agents », 15/09)
 *
 * `first_claim_at` et `claim_method` sont relus sur `api_keys`, par la clé qui
 * vient de naître, et non passés en paramètre. Motif : une clé née d'un code
 * e-mail VÉRIFIÉ reçoit `claimed_at` et `claim_method = 'email_code'` DANS la
 * transaction de frappe (`generateApiKey`, branche `provenMailbox`), et ne
 * passe donc JAMAIS par `claimKey`, seul appelant de `recordLineageClaim` et
 * dont l'UPDATE est gardé par `WHERE tier = 'anonymous'`. Sans ces deux
 * sous-requêtes, `lineage_facts.claim_method` restait NULL pour toutes les
 * clés du rail device nées avec une adresse — et `linkPaidKeyToLineage`, qui
 * exige `claim_method = 'email_code'`, ne pouvait relier AUCUN achat par carte
 * à une identité d'agent. Le chemin d'attribution existait dans le code et
 * était mort dans les faits.
 *
 * La lecture se fait sur `api_keys` plutôt que sur un booléen de l'appelant
 * pour la même raison que le rattrapage de la migration le fait (étape 4 de
 * `migrateLineageFacts`, qui lit `c.claim_method`) : deux écrivains qui
 * déduisent la même valeur par deux chemins différents finissent par ne plus
 * dire la même chose.
 */
export function recordLineageBirth(p: {
  lineageHash: string;
  tier: string | null;
  source?: string | null;
  keyPrefix?: string | null;
  /** Chemin canonique de la page qui a remis la clé, quand l'appelant le sait. */
  deliveryPage?: string | null;
}): void {
  try {
    const db = getStatsDB();
    db.prepare(
      `INSERT OR IGNORE INTO lineage_facts
         (lineage_hash, birth_at, birth_tier, birth_source,
          entry_landing, entry_referrer_domain, delivery_page,
          first_claim_at, claim_method, backfilled, updated_at)
       VALUES (?, datetime('now'), ?, ?,
               (SELECT landing  FROM signup_attribution WHERE key_prefix = ?),
               (SELECT referrer FROM signup_attribution WHERE key_prefix = ?),
               ?,
               (SELECT claimed_at    FROM api_keys WHERE key_hash = ?),
               (SELECT claim_method  FROM api_keys WHERE key_hash = ?),
               0, datetime('now'))`,
    ).run(
      p.lineageHash,
      p.tier,
      p.source ?? null,
      p.keyPrefix ?? null,
      p.keyPrefix ?? null,
      p.deliveryPage ?? null,
      p.lineageHash,
      p.lineageHash,
    );
  } catch (err) {
    complain(err);
  }
}

/**
 * La page d'arrivée et le site référent, une fois que la route les a validés.
 *
 * Appelée depuis `recordSignupAttribution` et pas depuis la naissance : la
 * route écrit l'attribution APRÈS avoir frappé la clé, donc au moment de la
 * naissance la ligne n'existe pas encore et les trois champs seraient
 * systématiquement NULL. COALESCE dans les deux sens : une seconde
 * attribution sur le même préfixe ne réécrit pas la première origine.
 */
export function fillLineageEntry(keyPrefix: string): void {
  try {
    getStatsDB()
      .prepare(
        `UPDATE lineage_facts
            SET entry_landing = COALESCE(entry_landing,
                  (SELECT landing FROM signup_attribution WHERE key_prefix = ?)),
                entry_referrer_domain = COALESCE(entry_referrer_domain,
                  (SELECT referrer FROM signup_attribution WHERE key_prefix = ?)),
                updated_at = datetime('now')
          WHERE lineage_hash = (SELECT lineage_hash FROM api_keys WHERE key_prefix = ?)`,
      )
      .run(keyPrefix, keyPrefix, keyPrefix);
  } catch (err) {
    complain(err);
  }
}

/**
 * Un appel métier 2xx servi à une clé : le premier de la lignée, le premier
 * hors panneau, le retour de deuxième semaine et le compteur de jours actifs.
 *
 * Écarte, dans cet ordre : un statut hors 2xx, une route qui n'appartient pas
 * à la famille métier (`isBillableCall`, sur la route NORMALISÉE), une lignée
 * déjà écrite aujourd'hui pour ce contexte.
 *
 * `valid: false` dans le corps de la réponse reste un succès technique : le
 * service a répondu, et le contrat le dit explicitement. Un lot de plusieurs
 * IBAN compte pour UNE activation ; les unités consommées sont un autre
 * indicateur, qui vit ailleurs.
 *
 * ## La famille de client (« mesure agents », 15/09)
 *
 * `first_success_client` par COALESCE — le premier écrit gagne — et
 * `last_success_client` toujours réécrit. L'UA n'est JAMAIS stocké : seule une
 * valeur de la liste fermée de `lineage-clients.ts` entre en base.
 *
 * ⚠️ Ce que `last_success_client` dit exactement : la famille du dernier succès
 * COMPTÉ, c'est-à-dire du dernier succès qui a franchi le cache du jour. Le
 * cache retient une écriture par lignée, par contexte, par famille et par jour,
 * donc un porteur qui alterne entre deux clients dans la même heure ne fait pas
 * défiler la colonne à chaque appel : elle porte le dernier des deux VUS ce
 * jour-là. Ce n'est pas « le client du dernier appel », et le lire ainsi
 * surestimerait la fraîcheur de la colonne.
 */
export function recordLineageSuccess(p: {
  keyHash: string;
  method: string;
  path: string;
  status: number;
  context: string | null | undefined;
  /** En-tête `User-Agent` brut. Réduit à une famille ICI, jamais stocké. */
  userAgent?: string | null;
}): void {
  if (p.status < 200 || p.status >= 300) return;
  if (!p.keyHash) return;
  if (!isBillableCall(p.method, p.path)) return;
  const context = normalizeLineageContext(p.context);
  // 🚨 Réduit AVANT tout le reste, et l'UA ne redescend jamais plus bas : à
  // partir d'ici il n'existe plus qu'une famille prise dans la liste fermée.
  const client = normalizeLineageClient(p.userAgent, p.context);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== cachedDay) {
    cachedDay = day;
    seenToday.clear();
  }
  // Court-circuit AVANT toute lecture de base, et c'est là tout le coût sur le
  // chemin chaud : une clé déjà vue aujourd'hui dans ce contexte et cette
  // famille ne déclenche plus rien du tout. Sans lui, chaque appel métier payait
  // la résolution de la lignée, soit une lecture indexée par requête servie.
  const fastKey = `k:${p.keyHash}|${context}|${client}`;
  if (seenToday.has(fastKey)) return;
  try {
    const db = getStatsDB();
    const row = db
      .prepare('SELECT lineage_hash FROM api_keys WHERE key_hash = ?')
      .get(p.keyHash) as { lineage_hash: string | null } | undefined;
    // Aucune ligne : la clé a été supprimée. Rien à mesurer, et surtout pas une
    // lignée inventée sur un porteur qui n'existe plus.
    if (!row) return;
    const lineage = row.lineage_hash ?? p.keyHash;
    const contextKey = `${lineage}|${context}|${client}`;
    // La lignée a déjà écrit aujourd'hui dans ce contexte, par une AUTRE clé
    // (le cas d'une lignée qui porterait deux clés actives). On mémorise aussi
    // le raccourci par clé, pour que l'appel suivant s'arrête plus haut.
    if (seenToday.has(contextKey)) {
      seenToday.add(fastKey);
      return;
    }
    // Le porteur d'une clé payée reliée à une lignée d'essai : l'usage payé se
    // lit sur la lignée qui a ACHETÉ, pas sur la clé qui sert. La garde
    // `IS NULL` le rend sans effet dès le deuxième appel.
    db.prepare(
      `UPDATE lineage_facts
          SET paid_first_success_at = datetime('now'), updated_at = datetime('now')
        WHERE paid_key_hash = ? AND paid_first_success_at IS NULL`,
    ).run(p.keyHash);
    const route = canonicalRouteOf(p.method, p.path);
    db.prepare(
      // Le CASE de first_unmarked_success_at : tout contexte qui n'est pas
      // `demo` est un succès hors panneau, y compris un contexte inconnu. Un
      // rattrapage, lui, ne pose JAMAIS cette colonne (voir la migration).
      //
      // Le CASE de week2_success_at lit `first_success_at` NON qualifié, donc
      // la valeur d'AVANT cette instruction : c'est ce qui permet de décider,
      // au moment de l'écriture, si ce succès-ci tombe dans la deuxième
      // semaine. Sur la branche INSERT il n'y a pas de premier succès
      // antérieur, donc la colonne reste NULL, ce qui est juste.
      `INSERT INTO lineage_facts
         (lineage_hash, birth_at, birth_tier, birth_source, backfilled,
          first_success_at, first_success_route, first_success_context,
          first_success_client, last_success_client,
          first_unmarked_success_at, last_success_at, last_success_day, success_days, updated_at)
       VALUES (
         ?,
         (SELECT MIN(created_at) FROM api_keys WHERE lineage_hash = ?),
         (SELECT tier   FROM api_keys WHERE key_hash = ?),
         (SELECT source FROM api_keys WHERE key_hash = ?),
         1,
         datetime('now'), ?, ?,
         ?, ?,
         CASE WHEN ? <> 'demo' THEN datetime('now') END,
         datetime('now'), date('now'), 1, datetime('now'))
       ON CONFLICT(lineage_hash) DO UPDATE SET
         first_success_at      = COALESCE(first_success_at, excluded.first_success_at),
         first_success_route   = COALESCE(first_success_route, excluded.first_success_route),
         first_success_context = COALESCE(first_success_context, excluded.first_success_context),
         first_success_client  = COALESCE(first_success_client, excluded.first_success_client),
         last_success_client   = excluded.last_success_client,
         first_unmarked_success_at = COALESCE(first_unmarked_success_at,
                                              excluded.first_unmarked_success_at),
         week2_success_at = COALESCE(week2_success_at,
           CASE WHEN first_success_at IS NOT NULL
                 AND excluded.last_success_at >= datetime(first_success_at, '+7 days')
                 AND excluded.last_success_at <  datetime(first_success_at, '+14 days')
                THEN excluded.last_success_at END),
         last_success_at  = excluded.last_success_at,
         success_days     = success_days + (CASE WHEN COALESCE(last_success_day, '')
                                                   <> excluded.last_success_day
                                                 THEN 1 ELSE 0 END),
         last_success_day = excluded.last_success_day,
         updated_at       = excluded.updated_at`,
    ).run(lineage, lineage, lineage, lineage, route, context, client, client, context);
    seenToday.add(contextKey);
    seenToday.add(fastKey);
    failureStreak = 0;
  } catch (err) {
    complain(err);
  }
}

/**
 * La route telle qu'elle sera lue dans les tableaux : la forme canonique,
 * verbe compris.
 *
 * Passe par `normalizeRequestPath`, la MÊME normalisation que le journal de
 * requêtes et que `isBillableCall` : deux normalisations parallèles finiraient
 * par diverger, et c'est aussi ce qui garantit qu'aucun identifiant soumis
 * n'arrive jusqu'ici.
 */
function canonicalRouteOf(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeRequestPath(path.split('?')[0] ?? '')}`;
}

/**
 * Le rattachement d'une clé anonyme, posé dans la MÊME transaction que la
 * promotion (contrat : le fait et la promotion ne se désynchronisent pas).
 *
 * Le try/catch est INTÉRIEUR à la transaction, exprès : une erreur
 * d'instruction y est avalée, la transaction se valide, et la réclamation du
 * porteur aboutit. L'inverse — laisser remonter — ferait annuler une
 * promotion légitime par un défaut de télémétrie, ce que la doctrine du lot 6
 * interdit. Le fait perdu se reconstitue depuis `api_keys.claimed_at`.
 */
export function recordLineageClaim(
  db: DatabaseType.Database,
  keyHash: string,
  method: string,
): void {
  try {
    db.prepare(
      `INSERT INTO lineage_facts
         (lineage_hash, birth_at, birth_tier, backfilled, first_claim_at, claim_method, updated_at)
       SELECT k.lineage_hash,
              (SELECT MIN(created_at) FROM api_keys o WHERE o.lineage_hash = k.lineage_hash),
              k.tier, 1, datetime('now'), ?, datetime('now')
         FROM api_keys k
        WHERE k.key_hash = ? AND k.lineage_hash IS NOT NULL
       ON CONFLICT(lineage_hash) DO UPDATE SET
         first_claim_at = COALESCE(first_claim_at, excluded.first_claim_at),
         claim_method   = COALESCE(claim_method, excluded.claim_method),
         updated_at     = excluded.updated_at`,
    ).run(method, keyHash);
  } catch (err) {
    complain(err);
  }
}

/**
 * Un règlement qui a RÉELLEMENT été inséré dans le journal des paiements.
 *
 * L'appelant garantit l'idempotence par `payment_ref UNIQUE` : on ne compte
 * donc ici que les insertions réelles, et `settlement_count` ne double pas sur
 * une requête rejouée. `first_settlement_at` reste un COALESCE par sécurité.
 */
export function recordLineageSettlement(keyHash: string): void {
  try {
    getStatsDB()
      .prepare(
        `INSERT INTO lineage_facts
           (lineage_hash, birth_at, birth_tier, backfilled,
            first_settlement_at, settlement_count, updated_at)
         SELECT k.lineage_hash,
                (SELECT MIN(created_at) FROM api_keys o WHERE o.lineage_hash = k.lineage_hash),
                k.tier, 1, datetime('now'), 1, datetime('now')
           FROM api_keys k
          WHERE k.key_hash = ? AND k.lineage_hash IS NOT NULL
         ON CONFLICT(lineage_hash) DO UPDATE SET
           first_settlement_at = COALESCE(first_settlement_at, excluded.first_settlement_at),
           settlement_count    = settlement_count + 1,
           updated_at          = excluded.updated_at`,
      )
      .run(keyHash);
  } catch (err) {
    complain(err);
  }
}

/**
 * Une recharge de la clé ELLE-MÊME (chantier « clé unique », lot B1,
 * 25.09.2026) : la lignée devient payante sans qu'aucune clé payée distincte ne
 * soit frappée. Sans ce fait, `linkPaidKeyToLineage`, appelé seulement à la
 * frappe, ne voyait rien, et les indicateurs 4 et 5 de l'entonnoir rataient
 * exactement la conversion que ce lot crée.
 *
 * Mêmes colonnes que le rapprochement, en `COALESCE` : la clé payée est la clé
 * elle-même, et la date est celle du PREMIER achat. Dans la transaction du
 * crédit, et elle avale ses propres erreurs comme les autres écrivains de
 * mesure : un défaut de télémétrie ne fait jamais échouer un paiement.
 */
export function markLineagePurchase(
  db: DatabaseType.Database,
  lineageHash: string,
  keyHash: string,
): void {
  try {
    db.prepare(
      `INSERT INTO lineage_facts
         (lineage_hash, birth_at, birth_tier, backfilled, paid_key_hash, paid_key_delivered_at,
          updated_at)
       SELECT ?,
              (SELECT MIN(created_at) FROM api_keys o
                WHERE COALESCE(o.lineage_hash, o.key_hash) = ?),
              k.tier, 1, ?, datetime('now'), datetime('now')
         FROM api_keys k
        WHERE k.key_hash = ?
       ON CONFLICT(lineage_hash) DO UPDATE SET
         paid_key_hash         = COALESCE(paid_key_hash, excluded.paid_key_hash),
         paid_key_delivered_at = COALESCE(paid_key_delivered_at, excluded.paid_key_delivered_at),
         updated_at            = excluded.updated_at`,
    ).run(lineageHash, lineageHash, keyHash, keyHash);
  } catch (err) {
    complain(err);
  }
}

/**
 * Relier une clé PAYÉE à la lignée d'essai du même porteur, quand le
 * rapprochement est sans ambiguïté.
 *
 * Quatre conditions, toutes nécessaires, et le silence en cas de doute — le
 * contrat dit d'écarter la correspondance ambiguë, pas de choisir la plus
 * plausible :
 *   1. l'adresse de la clé payée est une vraie adresse (les placeholders
 *      `credits-buyer`, `stripe-buyer`, `oem-subscriber` n'en sont pas) ;
 *   2. elle n'est pas un compte interne ;
 *   3. la lignée candidate a été réclamée par un code vérifié (`email_code`),
 *      seule preuve de boîte que nous détenions ;
 *   4. il y a EXACTEMENT une lignée candidate.
 *
 * Ce qui n'est pas relié n'est pas perdu : la couverture de rapprochement est
 * publiée à part (`paid_link_coverage`), comme le contrat l'exige.
 *
 * Ne modifie AUCUN comportement de paiement : tout est sous try/catch, et
 * l'écriture est un COALESCE.
 */
export function linkPaidKeyToLineage(p: {
  paidKeyHash: string;
  email: string | null;
  emailNorm: string | null;
}): boolean {
  try {
    if (!p.emailNorm || !p.emailNorm.includes('@')) return false;
    if (isInternalEmail(p.email) || isInternalEmail(p.emailNorm)) return false;
    const db = getStatsDB();
    const candidates = db
      .prepare(
        `SELECT DISTINCT f.lineage_hash AS lineage
           FROM lineage_facts f
           JOIN api_keys k ON k.lineage_hash = f.lineage_hash
          WHERE k.email_norm = ?
            AND f.claim_method = 'email_code'
            AND f.paid_key_hash IS NULL
          LIMIT 2`,
      )
      .all(p.emailNorm) as Array<{ lineage: string }>;
    if (candidates.length !== 1) return false;
    const info = db
      .prepare(
        `UPDATE lineage_facts
            SET paid_key_hash         = COALESCE(paid_key_hash, ?),
                paid_key_delivered_at = COALESCE(paid_key_delivered_at, datetime('now')),
                updated_at            = datetime('now')
          WHERE lineage_hash = ? AND paid_key_hash IS NULL`,
      )
      .run(p.paidKeyHash, candidates[0].lineage);
    return info.changes > 0;
  } catch (err) {
    complain(err);
    return false;
  }
}

/**
 * Rétention : aucune promesse nouvelle.
 *
 * Alignée sur les 12 mois de `request_log`, qui est l'engagement déjà publié.
 * Une ligne part quand la lignée n'a plus AUCUNE clé active et que son dernier
 * signe de vie a plus de douze mois.
 *
 * 🚨 La recommandation de 90 jours du plan du 14/09 vise une télémétrie
 * d'ÉVÉNEMENTS — un identifiant dédoublonnable, un instant et une route par
 * appel. Ce n'est pas ce que cette table contient : une ligne par lignée, sans
 * corps métier et sans identifiant personnel. Elle n'est donc pas appliquée
 * ici, et la politique d'information reste à trancher par l'intégrateur : ce
 * lot ne décide pas ce qui est publié aux porteurs.
 */
export function purgeLineageFacts(months = 12): number {
  const info = getStatsDB()
    .prepare(
      `DELETE FROM lineage_facts
        WHERE COALESCE(last_success_at, birth_at) < datetime('now', ?)
          AND NOT EXISTS (SELECT 1 FROM api_keys k
                           WHERE k.lineage_hash = lineage_facts.lineage_hash AND k.active = 1)`,
    )
    .run(`-${Math.max(1, Math.floor(months))} months`);
  return info.changes;
}
