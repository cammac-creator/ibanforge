/**
 * Le tableau de cohortes de l'essai : les six indicateurs du contrat de mesure
 * du 15/09/2026, avec leurs dénominateurs (lot M).
 *
 * ## Les trois règles qui gouvernent tout ce fichier
 *
 * 1. **Fenêtres en instants UTC, début inclus, fin exclue.** Les dates viennent
 *    de SQLite au format `datetime('now')` (`YYYY-MM-DD HH:MM:SS`), donc les
 *    bornes sont écrites dans ce format et comparées lexicographiquement, ce qui
 *    est exact pour ce format et seulement pour lui. Jamais l'ISO 8601 de
 *    `toISOString()` : son `T` est supérieur à l'espace, et toute comparaison
 *    deviendrait vraie.
 * 2. **Aucun pourcentage avec un dénominateur nul.** `value` vaut alors `null`
 *    et l'indicateur porte `note: 'not_yet_measurable'`. Un zéro affiché là est
 *    une affirmation que nous n'avons pas mesurée.
 * 3. **Le dénominateur ne retient QUE les lignées qui ont le recul requis.**
 *    Celles qui ne l'ont pas encore sont comptées dans `pending`, jamais au
 *    dénominateur — sinon un indicateur à 30 jours s'effondre mécaniquement
 *    chaque fois que de nouvelles lignées naissent.
 *
 * ## Ce que `coverage` veut dire, une fois pour toutes
 *
 * `coverage = denominator / (denominator + pending)` : la part de la cohorte
 * qui a atteint le recul nécessaire, donc la part réellement mesurable
 * aujourd'hui. Une valeur basse dit « attendez », pas « c'est mauvais ».
 * La couverture de RAPPROCHEMENT avec un acheteur est une autre grandeur, et
 * elle est publiée à part, en haut du corps : `paid_link_coverage`.
 *
 * ## Qui est exclu
 *
 * Les comptes internes (`isInternalEmail`, qui couvre déjà `@cohorte.invalid`),
 * les clés que nous avons frappées nous-mêmes (`issued_by_us = 1`), et les
 * lignées reconstituées à la migration (`backfilled = 1`) : celles-là n'ont pas
 * été observées au fil de l'eau, et le contrat parle des lignées « créées
 * depuis le démarrage de la nouvelle mesure ».
 */
import { getStatsDB } from './db.js';
import { registerInternalEmailFn } from './internal-accounts.js';
import {
  DEVICE_BIRTH_SOURCES,
  DEVICE_DOORS,
  type DeviceDoor,
  LINEAGE_CLIENTS,
} from './lineage-clients.js';
import { readDeviceGrantDaily, readMcpRemoteDaily } from './agent-entry-daily.js';

export interface FunnelIndicator {
  numerator: number;
  denominator: number;
  pending: number;
  coverage: number | null;
  value: number | null;
  note?: string;
}

export interface FunnelShare {
  numerator: number;
  denominator: number;
  value: number | null;
  note?: string;
}

/**
 * Une ventilation : une population de lignées, et les trois indicateurs qui ont
 * un sens sur elle (chantier « mesure agents », 15/09/2026).
 *
 * `lineages` est la POPULATION du seau, pas un numérateur : c'est elle qui
 * donne un sens aux trois indicateurs en dessous, et elle se lit différemment
 * selon la ventilation —
 *   - `by_birth_source` : lignées NÉES par cette porte ;
 *   - `by_first_client` : lignées ACTIVÉES par ce client, plus deux seaux qui
 *     ne sont pas des familles — `(unknown)` = activées AVANT que la famille
 *     soit enregistrée, `(none)` = nées et JAMAIS activées.
 *
 * Les trois indicateurs gardent la forme et les règles du haut du fichier :
 * dénominateur limité aux lignées qui ont le recul requis, `pending` pour les
 * autres, jamais de pourcentage sur un dénominateur nul.
 */
export interface FunnelBucket {
  name: string;
  lineages: number;
  first_result_24h: FunnelIndicator;
  return_week_2: FunnelIndicator;
  attributable_purchase_30d: FunnelIndicator;
}

/** Une journée du rail device, telle que le bloc `device` la publie. */
export interface DeviceDoorCounters {
  source: DeviceDoor;
  opened: number;
  rate_limited: number;
  approved_anonymous: number;
  approved_email: number;
  denied: number;
  expired: number;
  delivered: number;
}

/**
 * Le rail device de bout en bout : ouverts → approuvés → remis → lignées nées →
 * premier résultat → retour → achat, plus le haut de l'entonnoir MCP distant.
 *
 * 🚨 DEUX GRANULARITÉS DANS UN SEUL BLOC, et c'est la chose à savoir avant de
 * lire un rapport : `counters` et `mcp_remote` sont à la granularité du JOUR
 * UTC (des compteurs incrémentés à la décision), alors que `lineages` et les
 * trois indicateurs viennent de `lineage_facts`, à la SECONDE. `window_days`
 * dit quels jours ont été sommés. Les rapports internes au bloc `counters`
 * (`chain.approved_of_opened`, `chain.delivered_of_approved`) sont donc
 * cohérents entre eux ; seul `chain.lineages_of_delivered` croise les deux, et
 * il porte sa propre note.
 */
export interface DeviceRail {
  /** Les jours UTC sommés, bornes INCLUSES — pas la fenêtre à la seconde. */
  window_days: { from: string; to: string };
  counters: {
    opened: number;
    rate_limited: number;
    approved_anonymous: number;
    approved_email: number;
    /** La somme des deux branches d'approbation, écrite pour ne pas l'additionner à la main. */
    approved: number;
    denied: number;
    expired: number;
    delivered: number;
  };
  by_door: DeviceDoorCounters[];
  chain: {
    approved_of_opened: FunnelShare;
    delivered_of_approved: FunnelShare;
    lineages_of_delivered: FunnelShare;
  };
  /** Lignées nées par ce rail dans la fenêtre à la seconde. */
  lineages: { created: number; admissible: number };
  indicators: {
    first_result_24h: FunnelIndicator;
    return_week_2: FunnelIndicator;
    attributable_purchase_30d: FunnelIndicator;
  };
  /**
   * Le haut de l'entonnoir de la surface MCP distante, sans clé.
   *
   * 🚨 Des appels SANS IDENTITÉ : cette surface sert sans clé, donc aucun de
   * ces trois nombres n'est rattachable à une lignée, et aucun n'entre dans un
   * dénominateur d'activation. C'est le « traiter cette mesure explicitement »
   * de la passation du 15/09 : la dire, et dire pourquoi elle s'arrête là.
   */
  mcp_remote: {
    sessions: number;
    tool_calls: number;
    key_requests: number;
    note: string;
  };
  notes: string[];
}

export interface LineageFunnel {
  observed_at: string;
  /** Première lignée écrite au fil de l'eau, ou null si la mesure n'a rien vu. */
  measurement_started_at: string | null;
  window: { from: string; to: string };
  lineages: { created: number; admissible: number; pending: number };
  indicators: {
    first_result_24h: FunnelIndicator;
    unmarked_use_7d: FunnelIndicator;
    return_week_2: FunnelIndicator;
    attributable_purchase_30d: FunnelIndicator;
    paid_key_delivered: FunnelIndicator;
    paid_use_7d: FunnelIndicator;
  };
  /** Part des lignées activées dont le contexte du premier succès reste inconnu. */
  unknown_context_share: FunnelShare;
  /** Part des clés payées remises qui sont reliées à une lignée d'essai. */
  paid_link_coverage: FunnelShare;
  /**
   * Par PORTE de naissance. Bornée à la lecture : voir `BIRTH_SOURCE_BUCKETS`.
   */
  by_birth_source: FunnelBucket[];
  /** Par FAMILLE de client du premier succès. Liste fermée, donc complète. */
  by_first_client: FunnelBucket[];
  /** Le rail device de bout en bout, et le haut de l'entonnoir MCP distant. */
  device: DeviceRail;
  notes: string[];
}

/** 'YYYY-MM-DD HH:MM:SS' UTC, le format de datetime('now'). */
function sqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function indicator(numerator: number, denominator: number, pending: number): FunnelIndicator {
  const measurable = denominator + pending;
  return {
    numerator,
    denominator,
    pending,
    coverage: measurable > 0 ? round4(denominator / measurable) : null,
    value: denominator > 0 ? round4(numerator / denominator) : null,
    ...(denominator > 0 ? {} : { note: 'not_yet_measurable' }),
  };
}

function share(numerator: number, denominator: number): FunnelShare {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? round4(numerator / denominator) : null,
    ...(denominator > 0 ? {} : { note: 'not_yet_measurable' }),
  };
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * La cohorte mesurée : les lignées d'ESSAI, écrites au fil de l'eau, nées dans
 * la fenêtre, hors comptes internes et hors clés frappées par nous.
 *
 * `COALESCE(birth_tier, '') <> 'paid'` : une clé payée est une lignée aussi,
 * mais elle n'est pas dans l'essai — la faire entrer ferait chuter « premier
 * résultat sous 24 h » chaque fois qu'un abonnement est vendu. Le COALESCE
 * parce que `birth_tier` peut valoir NULL sur une lignée dont la ligne
 * d'origine a disparu.
 */
const COHORT = `
  SELECT f.*
    FROM lineage_facts f
   WHERE f.backfilled = 0
     AND COALESCE(f.birth_tier, '') <> 'paid'
     AND f.birth_at >= @from AND f.birth_at < @to
     AND NOT EXISTS (
       SELECT 1 FROM api_keys k
        WHERE k.lineage_hash = f.lineage_hash
          AND (is_internal_email(k.email) = 1 OR k.issued_by_us = 1))
`;

/**
 * Les clés PAYÉES remises, dans la fenêtre, hors comptes internes.
 *
 * « Remise confirmée côté serveur » se lit sur l'existence de la ligne :
 * `generateCreditKey`, `generateStripeKey` et `generateOemKey` n'écrivent la
 * clé qu'après le règlement, et la clé rendue est celle de cette ligne.
 */
const PAID_KEYS = `
  SELECT k.key_hash, k.created_at, k.x402_payment_ref, k.stripe_session_id
    FROM api_keys k
   WHERE k.tier = 'paid'
     AND k.created_at >= @from AND k.created_at < @to
     AND is_internal_email(k.email) = 0
     AND COALESCE(k.issued_by_us, 0) = 0
`;

/**
 * Les lignées devenues payantes par une RECHARGE de leur propre clé, dans la
 * fenêtre (chantier « clé unique », lot B1, 25.09.2026). Aucune clé payée
 * distincte n'y est frappée : la « clé payée remise » est la clé elle-même, et
 * `markLineagePurchase` la relie à sa lignée. Le premier achat d'une lignée se
 * reconnaît à sa photo (`prev_tier`), prise une fois, à ce premier achat.
 */
const FIRST_RECHARGES = `
  SELECT p.key_hash
    FROM key_purchases p
    LEFT JOIN api_keys k ON k.key_hash = p.key_hash
   WHERE p.outcome = 'credited' AND p.prev_tier IS NOT NULL
     AND p.created_at >= @from AND p.created_at < @to
     AND is_internal_email(COALESCE(k.email, '')) = 0
     AND MAX(p.issued_by_us, COALESCE(k.issued_by_us, 0)) = 0
`;

/**
 * Les clés payées remises et RELIÉES à une lignée d'essai, dans la fenêtre.
 *
 * La date de référence est celle de la remise, pas celle de la naissance de la
 * lignée : « usage payé sous 7 jours » se compte depuis la remise.
 */
const LINKED_PAID = `
  SELECT f.paid_key_delivered_at AS delivered_at, f.paid_first_success_at AS first_at
    FROM lineage_facts f
   WHERE f.paid_key_hash IS NOT NULL
     AND f.paid_key_delivered_at >= @from AND f.paid_key_delivered_at < @to
     AND NOT EXISTS (
       SELECT 1 FROM api_keys k
        WHERE k.key_hash = f.paid_key_hash
          AND (is_internal_email(k.email) = 1 OR COALESCE(k.issued_by_us, 0) = 1))
`;

/**
 * Sentinelles de seau, choisies pour etre IMPOSSIBLES a produire.
 *
 * `birth_source` et les familles de client passent par
 * `/^[a-z0-9_-]{1,40}$/` (cote grant comme cote `POST /v1/keys/generate`), donc
 * aucune parenthese ne peut y entrer. Sans cette precaution, un appelant qui
 * declarerait `source=other` viendrait se confondre avec le seau de
 * debordement, et le tableau dirait n'importe quoi sans qu'aucun test ne
 * rougisse.
 */
const NO_BUCKET = '(none)';
const OVERFLOW_BUCKET = '(other)';
/**
 * 🚨 « Activée, mais AVANT que la famille soit enregistrée », et ce seau n'est
 * pas une subtilite : `first_success_client` arrive NULL sur toutes les lignees
 * ecrites au fil de l'eau par le lot M, qui ont pourtant un premier succes.
 * Les replier dans `(none)` — « jamais activee » — publierait des lignees
 * ACTIVES comme n'ayant jamais rien fait, avec un numerateur de premier
 * resultat non nul dans un seau censé n'en avoir aucun. Les replier dans
 * `other` serait aussi faux : `other` veut dire « un client non reconnu s'est
 * declare », celui-ci veut dire « nous ne mesurions pas encore ». Meme doctrine
 * que `unknown_context_share` : l'inconnu se publie a cote, il ne se devine pas.
 */
const UNKNOWN_BUCKET = '(unknown)';

/**
 * Combien de portes de naissance sont nommees, le reste allant dans `(other)`.
 *
 * 🚨 Une BORNE A LA LECTURE, et elle est necessaire : `birth_source` recopie la
 * source declaree par l'appelant, donc sa cardinalite n'est bornee par rien a
 * l'ecriture. Sans ce plafond, un appelant qui change de `source` a chaque cle
 * ferait grossir la reponse d'un objet par cle creee.
 *
 * Le classement est fait par NOMBRE DE LIGNEES decroissant, ce qui rend le
 * bruit inoffensif : mille sources a une lignee chacune ne deplacent pas une
 * vraie porte du haut du classement, elles s'additionnent dans `(other)`.
 */
const BIRTH_SOURCE_BUCKETS = 12;

export interface FunnelOptions {
  /** 'YYYY-MM-DD' : début de fenêtre. Par défaut, le démarrage de la mesure. */
  since?: string | null;
  /** Longueur de la fenêtre en jours. Par défaut, jusqu'à l'instant observé. */
  days?: number | null;
  /** Horloge injectable, pour les tests. */
  now?: number;
}

export function getLineageFunnel(opts: FunnelOptions = {}): LineageFunnel {
  const db = getStatsDB();
  registerInternalEmailFn(db);
  const nowMs = opts.now ?? Date.now();
  const observedAt = sqliteUtc(nowMs);

  const started = (
    db.prepare('SELECT MIN(birth_at) AS t FROM lineage_facts WHERE backfilled = 0').get() as {
      t: string | null;
    }
  ).t;

  // Début : la date demandée à minuit UTC, sinon le démarrage de la mesure,
  // sinon l'instant courant — une fenêtre vide plutôt qu'une fenêtre inventée.
  //
  // 🚨 La fin est EXCLUE, y compris pour la fenêtre par défaut, et SQLite
  // horodate à la seconde : une lignée née dans la seconde même de la lecture
  // n'y est pas encore, elle apparaît à la lecture suivante. C'est la
  // conséquence assumée de « début inclus, fin exclue » ; l'alternative —
  // annoncer une borne et en compter une autre — ferait deux lectures
  // successives qui ne s'additionnent pas.
  const from = opts.since ? `${opts.since} 00:00:00` : (started ?? observedAt);
  const to =
    opts.days && opts.days > 0
      ? sqliteUtc(Date.parse(`${from.replace(' ', 'T')}Z`) + opts.days * 86_400_000)
      : observedAt;
  const bounds = { from, to, observed: observedAt };

  /**
   * Ne lie que les paramètres que la requête nomme réellement.
   *
   * better-sqlite3 refuse un objet qui porte un nom absent de l'instruction, et
   * toutes les lectures ci-dessous ne se servent pas des trois bornes. Filtrer
   * ici évite d'avoir à tenir à jour un jeu de paramètres par requête — la
   * faute que ce filtre rend impossible.
   */
  const count = (sql: string, extra: Record<string, unknown> = {}): number => {
    const bound: Record<string, unknown> = {};
    for (const [name, value] of Object.entries({ ...bounds, ...extra })) {
      if (sql.includes(`@${name}`)) bound[name] = value;
    }
    return (db.prepare(sql).get(bound) as { n: number }).n;
  };

  // ── L'état de la cohorte ────────────────────────────────────────────────
  //
  // `created` compte toutes les lignées d'essai nées dans la fenêtre,
  // `admissible` celles qui restent après les exclusions : sans les deux, le
  // lecteur ne peut pas savoir combien de lignées ont été écartées ni pourquoi
  // un dénominateur est plus petit qu'attendu.
  const created = count(`
    SELECT COUNT(*) AS n FROM lineage_facts f
     WHERE f.backfilled = 0
       AND COALESCE(f.birth_tier, '') <> 'paid'
       AND f.birth_at >= @from AND f.birth_at < @to`);
  const admissible = count(`SELECT COUNT(*) AS n FROM (${COHORT})`);
  // « Encore en attente » au sens le plus strict : nées il y a moins de 24 h,
  // donc absentes de TOUS les dénominateurs.
  const pendingAll = count(`
    SELECT COUNT(*) AS n FROM (${COHORT}) c
     WHERE c.birth_at > datetime(@observed, '-1 day')`);

  // ── 1. Premier résultat sous 24 h ───────────────────────────────────────
  const d1 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.birth_at <= datetime(@observed, '-1 day')`,
  );
  const n1 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c
      WHERE c.birth_at <= datetime(@observed, '-1 day')
        AND c.first_success_at IS NOT NULL
        AND c.first_success_at < datetime(c.birth_at, '+1 day')`,
  );

  // ── 2. Utilisation hors panneau sous 7 jours ────────────────────────────
  const d2 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.birth_at <= datetime(@observed, '-7 days')`,
  );
  const n2 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c
      WHERE c.birth_at <= datetime(@observed, '-7 days')
        AND c.first_unmarked_success_at IS NOT NULL
        AND c.first_unmarked_success_at < datetime(c.birth_at, '+7 days')`,
  );
  const p2 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.birth_at > datetime(@observed, '-7 days')`,
  );

  // ── 3. Retour en deuxième semaine ───────────────────────────────────────
  // La population est celle des lignées ACTIVÉES : le recul se compte depuis le
  // premier succès, pas depuis la naissance.
  const d3 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c
      WHERE c.first_success_at IS NOT NULL
        AND c.first_success_at <= datetime(@observed, '-14 days')`,
  );
  const n3 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c
      WHERE c.first_success_at IS NOT NULL
        AND c.first_success_at <= datetime(@observed, '-14 days')
        AND c.week2_success_at IS NOT NULL`,
  );
  const p3 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c
      WHERE c.first_success_at IS NOT NULL
        AND c.first_success_at > datetime(@observed, '-14 days')`,
  );

  // ── 4. Achat attribuable sous 30 jours ──────────────────────────────────
  // « Réglé ET relié » : un règlement sur la clé de la lignée l'est par
  // construction ; une clé payée distincte l'est par le rapprochement, dont la
  // couverture est publiée séparément.
  const d4 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.birth_at <= datetime(@observed, '-30 days')`,
  );
  const n4 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c
      WHERE c.birth_at <= datetime(@observed, '-30 days')
        AND ((c.first_settlement_at IS NOT NULL
              AND c.first_settlement_at < datetime(c.birth_at, '+30 days'))
          OR (c.paid_key_delivered_at IS NOT NULL
              AND c.paid_key_delivered_at < datetime(c.birth_at, '+30 days')))`,
  );
  const p4 = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.birth_at > datetime(@observed, '-30 days')`,
  );

  // ── 5. Clé payée remise ─────────────────────────────────────────────────
  //
  // Dénominateur : les achats de clés ou de crédits RÉGLÉS dont le serveur
  // garde une trace, identifiés par leur référence de règlement — le journal
  // des paiements sur une route d'ACHAT, plus les références portées par les
  // clés payantes elles-mêmes (x402, session Stripe). Numérateur : ceux pour
  // lesquels une clé payante existe réellement.
  //
  // 🚨 Ce que cet indicateur peut et ne peut PAS voir, à dire avant de lire le
  // chiffre : il vaut presque toujours 1 par construction, parce que les trois
  // chemins de frappe écrivent la référence ET la clé dans la même opération.
  // La route journalisée porte le paquet (« POST /v1/credits/buy/1k »), d'où le
  // joker APRÈS la barre oblique : sans lui, aucun règlement de paquet n'entrait.
  // Il attrape le seul écart réel — un règlement journalisé sans clé frappée,
  // par exemple un webhook interrompu — et il est aveugle à une clé frappée
  // sans aucune trace de règlement, qui n'aurait par définition pas de
  // référence à compter. Les règlements x402 à l'appel sont EXCLUS : le contrat
  // en fait une série distincte, et ils ne remettent aucune clé.
  //
  // Depuis le lot B1 (25.09.2026), les achats se lisent au REGISTRE : une ligne
  // par paiement, `payment_ref` unique, packs et abonnements, carte et USDC,
  // recharges de la même clé comprises (elles ne frappent aucune clé, et le
  // journal des règlements ne les voit plus). Dénominateur : les achats réglés
  // ou dont le règlement est encore en attente. Numérateur : ceux dont les
  // crédits ou l'abonnement sont sur une clé. Une ligne `pending` est donc
  // exactement l'écart que cet indicateur existe pour montrer.
  const purchaseRefs = db
    .prepare(
      `SELECT p.payment_ref AS ref,
              CASE WHEN p.outcome IN ('credited', 'minted', 'minted_fallback', 'attached')
                   THEN 1 ELSE 0 END AS delivered
         FROM key_purchases p
         LEFT JOIN api_keys k ON k.key_hash = p.key_hash
        WHERE p.outcome IN ('credited', 'minted', 'minted_fallback', 'attached', 'pending')
          AND p.created_at >= @from AND p.created_at < @to
          AND is_internal_email(COALESCE(k.email, '')) = 0
          AND MAX(p.issued_by_us, COALESCE(k.issued_by_us, 0)) = 0`,
    )
    .all({ from, to }) as Array<{ ref: string; delivered: number }>;
  const d5 = purchaseRefs.length;
  const n5 = purchaseRefs.filter((r) => r.delivered > 0).length;

  // ── 6. Usage payé sous 7 jours ──────────────────────────────────────────
  //
  // Population : les clés payées remises et RELIÉES à une lignée — c'est la
  // lignée qui porte la date du premier usage payé. Les clés payées non
  // reliées sont hors de portée de cet indicateur, et c'est exactement ce que
  // `paid_link_coverage` sert à dire.
  const LINKED = LINKED_PAID;
  const d6 = count(
    `SELECT COUNT(*) AS n FROM (${LINKED}) l
      WHERE l.delivered_at <= datetime(@observed, '-7 days')`,
  );
  const n6 = count(
    `SELECT COUNT(*) AS n FROM (${LINKED}) l
      WHERE l.delivered_at <= datetime(@observed, '-7 days')
        AND l.first_at IS NOT NULL
        AND l.first_at < datetime(l.delivered_at, '+7 days')`,
  );
  const p6 = count(
    `SELECT COUNT(*) AS n FROM (${LINKED}) l
      WHERE l.delivered_at > datetime(@observed, '-7 days')`,
  );

  // ── Les deux couvertures publiées à côté ────────────────────────────────
  const activated = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.first_success_at IS NOT NULL`,
  );
  const unknownContext = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE c.first_success_context = 'unknown'`,
  );
  // Les remises payées : les clés payées frappées dans la fenêtre, plus les
  // lignées devenues payantes par une recharge de leur propre clé (lot B1), que
  // `markLineagePurchase` relie comme une remise. Sans ce second terme, la
  // couverture pourrait dépasser 1.
  const paidDelivered =
    count(`SELECT COUNT(*) AS n FROM (${PAID_KEYS}) k`) +
    count(`SELECT COUNT(*) AS n FROM (${FIRST_RECHARGES}) r`);
  const paidLinked = count(`SELECT COUNT(*) AS n FROM (${LINKED}) l`);

  // ── Les trois indicateurs, sur un SOUS-ENSEMBLE de la cohorte ───────────
  //
  // Les mêmes requêtes que ci-dessus, avec un prédicat de seau en plus.
  // Écrites une fois ici plutôt que recopiées par ventilation : deux
  // formulations du même indicateur finissent par ne plus dire la même chose,
  // et c'est toujours celle qu'on ne relit pas qui est publiée.
  //
  // `filter` est une expression SQL écrite DANS ce fichier ; les valeurs de
  // seau, elles, sont liées par paramètre nommé (`extra`), parce qu'elles
  // viennent de la base et donc, en dernière analyse, de l'appelant.
  //
  // `pending` est celui du SEAU, pas celui de la cohorte entière : un seau né
  // hier ne doit pas emprunter la couverture d'un seau né le mois dernier.
  const tripleFor = (
    filter: string,
    extra: Record<string, unknown> = {},
  ): {
    first_result_24h: FunnelIndicator;
    return_week_2: FunnelIndicator;
    attributable_purchase_30d: FunnelIndicator;
  } => {
    const bucket = `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE (${filter})`;
    const d24 = count(`${bucket} AND c.birth_at <= datetime(@observed, '-1 day')`, extra);
    const n24 = count(
      `${bucket} AND c.birth_at <= datetime(@observed, '-1 day')
         AND c.first_success_at IS NOT NULL
         AND c.first_success_at < datetime(c.birth_at, '+1 day')`,
      extra,
    );
    const p24 = count(`${bucket} AND c.birth_at > datetime(@observed, '-1 day')`, extra);
    const dW2 = count(
      `${bucket} AND c.first_success_at IS NOT NULL
         AND c.first_success_at <= datetime(@observed, '-14 days')`,
      extra,
    );
    const nW2 = count(
      `${bucket} AND c.first_success_at IS NOT NULL
         AND c.first_success_at <= datetime(@observed, '-14 days')
         AND c.week2_success_at IS NOT NULL`,
      extra,
    );
    const pW2 = count(
      `${bucket} AND c.first_success_at IS NOT NULL
         AND c.first_success_at > datetime(@observed, '-14 days')`,
      extra,
    );
    const d30 = count(`${bucket} AND c.birth_at <= datetime(@observed, '-30 days')`, extra);
    const n30 = count(
      `${bucket} AND c.birth_at <= datetime(@observed, '-30 days')
         AND ((c.first_settlement_at IS NOT NULL
               AND c.first_settlement_at < datetime(c.birth_at, '+30 days'))
           OR (c.paid_key_delivered_at IS NOT NULL
               AND c.paid_key_delivered_at < datetime(c.birth_at, '+30 days')))`,
      extra,
    );
    const p30 = count(`${bucket} AND c.birth_at > datetime(@observed, '-30 days')`, extra);
    return {
      first_result_24h: indicator(n24, d24, p24),
      return_week_2: indicator(nW2, dW2, pW2),
      attributable_purchase_30d: indicator(n30, d30, p30),
    };
  };

  // ── Ventilation par PORTE de naissance, bornée à la lecture ─────────────
  //
  // La liste des seaux est tirée de la cohorte ADMISSIBLE et non des lignées
  // créées : c'est cette population-là que les indicateurs mesurent, et deux
  // populations dans un même objet feraient lire un numérateur contre le
  // mauvais total.
  const sourceRows = db
    .prepare(
      `SELECT COALESCE(c.birth_source, @none) AS bucket, COUNT(*) AS n
         FROM (${COHORT}) c
        GROUP BY bucket
        ORDER BY n DESC, bucket ASC`,
    )
    .all({ from, to, none: NO_BUCKET }) as Array<{ bucket: string; n: number }>;
  const namedSources = sourceRows.slice(0, BIRTH_SOURCE_BUCKETS);
  const overflowSources = sourceRows.slice(BIRTH_SOURCE_BUCKETS);
  const byBirthSource: FunnelBucket[] = namedSources.map((r) => ({
    name: r.bucket,
    lineages: r.n,
    ...tripleFor('COALESCE(c.birth_source, @none) = @bucket', {
      none: NO_BUCKET,
      bucket: r.bucket,
    }),
  }));
  if (overflowSources.length > 0) {
    // 🚨 `NOT IN` sur les portes NOMMÉES, et non `IN` sur les repliées : le
    // nombre de paramètres liés est alors borné par `BIRTH_SOURCE_BUCKETS`,
    // quoi que fasse l'appelant. Écrit dans l'autre sens, il grandissait avec
    // la cardinalité même que ce plafond existe pour borner — et
    // `getLineageFunnel` n'a aucun try/catch, donc un plafond de paramètres
    // atteint aurait rendu un 500 sur la route d'admin. Aucun risque de NULL :
    // le COALESCE a déjà remplacé l'absence par la sentinelle.
    const extra: Record<string, unknown> = { none: NO_BUCKET };
    namedSources.forEach((r, i) => {
      extra[`nb${i}`] = r.bucket;
    });
    const placeholders = namedSources.map((_, i) => `@nb${i}`).join(', ');
    byBirthSource.push({
      name: OVERFLOW_BUCKET,
      lineages: overflowSources.reduce((sum, r) => sum + r.n, 0),
      ...tripleFor(`COALESCE(c.birth_source, @none) NOT IN (${placeholders})`, extra),
    });
  }

  // ── Ventilation par FAMILLE de client du premier succès ─────────────────
  //
  // Liste FERMÉE, donc tous les seaux sont publiés, y compris à zéro : la forme
  // de la réponse ne change pas d'une lecture à l'autre, et un seau absent
  // serait indiscernable d'un seau à zéro.
  //
  // DEUX seaux au-delà des huit familles, et la distinction n'est pas
  // cosmétique :
  //   - `(unknown)` : activée, mais avant que la famille soit enregistrée.
  //   - `(none)`    : née et JAMAIS activée.
  // Les confondre publierait les lignées déjà mesurées par le lot M — qui ont
  // un premier succès et une famille NULL — comme n'ayant jamais rien fait.
  //
  // Les dix seaux PARTITIONNENT la cohorte : `first_success_at IS NULL` d'un
  // côté, et de l'autre huit familles plus l'absence de famille. Leur somme
  // vaut donc `lineages.admissible`, ce qui est la seule preuve simple que la
  // ventilation ne perd personne.
  const byFirstClient: FunnelBucket[] = [...LINEAGE_CLIENTS, UNKNOWN_BUCKET, NO_BUCKET].map(
    (name) => {
      const filter =
        name === NO_BUCKET
          ? 'c.first_success_at IS NULL'
          : name === UNKNOWN_BUCKET
            ? 'c.first_success_at IS NOT NULL AND c.first_success_client IS NULL'
            : 'c.first_success_client = @bucket';
      const extra = name === NO_BUCKET || name === UNKNOWN_BUCKET ? {} : { bucket: name };
      return {
        name,
        lineages: count(`SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE (${filter})`, extra),
        ...tripleFor(filter, extra),
      };
    },
  );

  // ── Le rail device, de la porte jusqu'à l'achat ─────────────────────────
  //
  // 🚨 Les compteurs sont sommés sur des JOURS UTC pleins : `to` est une borne
  // EXCLUSIVE à la seconde, mais `device_grant_daily` et `mcp_remote_daily` ne
  // savent pas découper une journée. Sur une fenêtre qui commence à midi, ces
  // compteurs portent donc aussi la matinée. `window_days` le dit, et les notes
  // du bloc le répètent : c'est la seule façon honnête de publier un compteur
  // journalier à côté d'une cohorte à la seconde.
  const fromDay = from.slice(0, 10);
  const toDay = to.slice(0, 10);
  const grantDays = readDeviceGrantDaily(fromDay, toDay);
  const mcpDays = readMcpRemoteDaily(fromDay, toDay);
  const sumDoor = (door: DeviceDoor): DeviceDoorCounters => {
    const rows = grantDays.filter((r) => r.source === door);
    const add = (pick: (r: (typeof rows)[number]) => number): number =>
      rows.reduce((sum, r) => sum + pick(r), 0);
    return {
      source: door,
      opened: add((r) => r.opened),
      rate_limited: add((r) => r.rate_limited),
      approved_anonymous: add((r) => r.approved_anonymous),
      approved_email: add((r) => r.approved_email),
      denied: add((r) => r.denied),
      expired: add((r) => r.expired),
      delivered: add((r) => r.delivered),
    };
  };
  const byDoor = DEVICE_DOORS.map(sumDoor);
  const doorTotal = (pick: (d: DeviceDoorCounters) => number): number =>
    byDoor.reduce((sum, d) => sum + pick(d), 0);
  const approvedAnonymous = doorTotal((d) => d.approved_anonymous);
  const approvedEmail = doorTotal((d) => d.approved_email);
  const approved = approvedAnonymous + approvedEmail;
  const opened = doorTotal((d) => d.opened);
  const delivered = doorTotal((d) => d.delivered);

  // Les deux portes du rail, liées par paramètre : la liste est écrite dans
  // `lineage-clients.ts`, et l'y lire plutôt que la retaper garantit qu'une
  // troisième porte ajoutée un jour entre dans ce bloc sans qu'on y pense.
  const deviceExtra: Record<string, unknown> = {};
  DEVICE_BIRTH_SOURCES.forEach((v, i) => {
    deviceExtra[`dv${i}`] = v;
  });
  const devicePlaceholders = DEVICE_BIRTH_SOURCES.map((_, i) => `@dv${i}`).join(', ');
  const deviceFilter = `c.birth_source IN (${devicePlaceholders})`;
  const deviceCreated = count(
    `SELECT COUNT(*) AS n FROM lineage_facts f
      WHERE f.backfilled = 0
        AND COALESCE(f.birth_tier, '') <> 'paid'
        AND f.birth_at >= @from AND f.birth_at < @to
        AND f.birth_source IN (${devicePlaceholders})`,
    deviceExtra,
  );
  const deviceAdmissible = count(
    `SELECT COUNT(*) AS n FROM (${COHORT}) c WHERE ${deviceFilter}`,
    deviceExtra,
  );

  const device: DeviceRail = {
    window_days: { from: fromDay, to: toDay },
    counters: {
      opened,
      rate_limited: doorTotal((d) => d.rate_limited),
      approved_anonymous: approvedAnonymous,
      approved_email: approvedEmail,
      approved,
      denied: doorTotal((d) => d.denied),
      expired: doorTotal((d) => d.expired),
      delivered,
    },
    by_door: byDoor,
    chain: {
      approved_of_opened: share(approved, opened),
      delivered_of_approved: share(delivered, approved),
      lineages_of_delivered: share(deviceAdmissible, delivered),
    },
    lineages: { created: deviceCreated, admissible: deviceAdmissible },
    indicators: tripleFor(deviceFilter, deviceExtra),
    mcp_remote: {
      sessions: mcpDays.reduce((sum, r) => sum + r.sessions, 0),
      tool_calls: mcpDays.reduce((sum, r) => sum + r.tool_calls, 0),
      key_requests: mcpDays.reduce((sum, r) => sum + r.key_requests, 0),
      note:
        'Appels servis SANS AUCUNE IDENTITE sur la surface MCP distante : cette porte sert sans cle, ' +
        "donc aucun de ces trois nombres n'est rattachable a une lignee, et aucun n'entre dans un " +
        "denominateur d'activation. tool_calls compte les appels SERVIS (un refus de plafond " +
        "n'ecrit rien, pour qu'un appelant refuse ne coute aucune ecriture) ; les refus se lisent " +
        'dans request_log sous /mcp:tools-call:refused et /mcp:session:refused.',
    },
    notes: [
      'Deux granularites dans ce bloc : counters et mcp_remote sont sommes sur des JOURS UTC pleins (window_days), lineages et indicators sur la fenetre a la seconde.',
      "opened ne s'additionne PAS en approved + denied + expired + delivered : un grant encore en attente au moment de la lecture n'est dans aucun seau terminal, et un grant approuve puis retire compte dans les deux.",
      'expired veut dire « expiration TRANCHEE par la purge ce jour-la », pas « grant dont le TTL est passe » : le compteur est incremente a la decision, parce que device_codes est purgee a 24 h et ne peut plus rien dire apres coup.',
      'lineages_of_delivered est le seul rapport de ce bloc qui croise les deux granularites : son numerateur vient de lineage_facts, son denominateur des compteurs journaliers.',
      'Les compteurs du rail ne portent que le rail device : une approbation ou un retrait de checkout est un paiement, et ne les touche pas.',
    ],
  };

  return {
    observed_at: observedAt,
    measurement_started_at: started,
    window: { from, to },
    lineages: { created, admissible, pending: pendingAll },
    indicators: {
      first_result_24h: indicator(n1, d1, pendingAll),
      unmarked_use_7d: indicator(n2, d2, p2),
      return_week_2: indicator(n3, d3, p3),
      attributable_purchase_30d: indicator(n4, d4, p4),
      paid_key_delivered: indicator(n5, d5, 0),
      paid_use_7d: indicator(n6, d6, p6),
    },
    unknown_context_share: share(unknownContext, activated),
    paid_link_coverage: share(paidLinked, paidDelivered),
    by_birth_source: byBirthSource,
    by_first_client: byFirstClient,
    device,
    notes: [
      `${created - admissible} lignee(s) ecartee(s) de la fenetre : compte interne, cle frappee par nous, ou cohorte regroupee.`,
      "Les appels servis par MCP ne comptent pas comme activation : ils atterrissent sous /mcp, hors des familles de routes metier. Un agent qui n'utilise que MCP produit donc zero activation mesuree. Ce trafic-la est mesure a part, dans device.mcp_remote, et il n'est rattachable a aucune lignee.",
      'paid_key_delivered vaut presque toujours 1 par construction : la reference de reglement et la cle sont ecrites dans la meme operation.',
      "Les reglements x402 a l'appel forment une serie distincte et ne remettent aucune cle.",
      'coverage = denominator / (denominator + pending) : la part de la cohorte qui a atteint le recul requis, pas un jugement sur le resultat.',
      `by_birth_source est borne a ${BIRTH_SOURCE_BUCKETS} portes nommees plus (other) : birth_source recopie une source DECLAREE par l'appelant, dont la cardinalite n'est bornee par rien a l'ecriture.`,
      "by_first_client vient d'une liste FERMEE de familles derivees de l'User-Agent ; l'User-Agent lui-meme n'entre jamais dans lineage_facts. Deux seaux ne sont pas des familles : (none) = nee et JAMAIS activee, (unknown) = activee AVANT que la famille soit enregistree. Les dix seaux partitionnent la cohorte, leur somme vaut lineages.admissible.",
      "La famille browser est posee quand l'appel porte le marqueur de contexte demo. Ce marqueur est DECLARE par le client, exactement comme l'User-Agent : deux observations, aucune preuve.",
      "L'integration n8n ne pose aucun User-Agent a nous : ses appels tombent dans other, et aucune famille n8n n'existe.",
    ],
  };
}
