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
  const count = (sql: string): number => {
    const bound: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(bounds)) {
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
  // Il attrape le seul écart réel — un règlement journalisé sans clé frappée,
  // par exemple un webhook interrompu — et il est aveugle à une clé frappée
  // sans aucune trace de règlement, qui n'aurait par définition pas de
  // référence à compter. Les règlements x402 à l'appel sont EXCLUS : le contrat
  // en fait une série distincte, et ils ne remettent aucune clé.
  const purchaseRefs = db
    .prepare(
      `SELECT ref, MAX(delivered) AS delivered FROM (
         SELECT s.payment_ref AS ref,
                (SELECT COUNT(*) FROM api_keys k
                  WHERE k.tier = 'paid'
                    AND (k.x402_payment_ref = s.payment_ref OR k.stripe_session_id = s.payment_ref)
                ) AS delivered
           FROM key_settlements s
          WHERE s.created_at >= @from AND s.created_at < @to
            AND s.route LIKE '%/v1/credits/buy'
         UNION ALL
         SELECT COALESCE(k.x402_payment_ref, k.stripe_session_id) AS ref, 1 AS delivered
           FROM (${PAID_KEYS}) k
          WHERE COALESCE(k.x402_payment_ref, k.stripe_session_id) IS NOT NULL
       )
       GROUP BY ref`,
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
  const paidDelivered = count(`SELECT COUNT(*) AS n FROM (${PAID_KEYS}) k`);
  const paidLinked = count(`SELECT COUNT(*) AS n FROM (${LINKED}) l`);

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
    notes: [
      `${created - admissible} lignee(s) ecartee(s) de la fenetre : compte interne, cle frappee par nous, ou cohorte regroupee.`,
      "Les appels servis par MCP ne comptent pas comme activation : ils atterrissent sous /mcp, hors des familles de routes metier. Un agent qui n'utilise que MCP produit donc zero activation mesuree.",
      'paid_key_delivered vaut presque toujours 1 par construction : la reference de reglement et la cle sont ecrites dans la meme operation.',
      "Les reglements x402 a l'appel forment une serie distincte et ne remettent aucune cle.",
      'coverage = denominator / (denominator + pending) : la part de la cohorte qui a atteint le recul requis, pas un jugement sur le resultat.',
    ],
  };
}
