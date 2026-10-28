/**
 * La famille « sous conditions » : ce qui quitte le dépôt public pour la surcouche privée.
 *
 * ## Pourquoi ce fichier existe
 *
 * Le 24/09/2026, Claude-Alain a décidé que toute donnée dont la licence n'autorise
 * pas la redistribution quitte le dépôt public, sur le modèle du registre
 * luxembourgeois (src/lib/lu-register.ts) : un fichier privé, désigné par une
 * variable, déposé sur le disque du serveur. L'étude du même jour
 * (docs/data-sources.md pour les licences) a relevé, table par table et source par
 * source, les lignes concernées. Elles sont écrites ICI et nulle part ailleurs :
 * l'extraction (scripts/restricted-overlay.ts), le chargeur
 * (src/lib/restricted-overlay.ts) et les seeders lisent cette constante. Un
 * membre ajouté ou retiré ici change les trois d'un coup ; une seconde liste
 * écrite à la main dans un script serait la première à mentir.
 *
 * ## La règle du 28/10/2026 : hors du dépôt public, mais servi
 *
 * Décision de Claude-Alain du 28/10/2026 (« go pour B », grille des sources) :
 * une donnée de la zone grise (« non commercial », « tous droits réservés »,
 * « accord écrit », propriétaire silencieux) ou compilée chez un concurrent est
 * servie sans attendre de permission, source citée, et retirée dans les 48
 * heures si son propriétaire le demande. La limite ne bouge pas : elle n'entre
 * jamais dans ce dépôt, un paquet ou un export du site, seulement ici, comme
 * membre. D'où les membres `seco`, `map_tr` et ceux des clés retirées le
 * 29/09/2026 (`supplement`), les registres israélien et mongol (`register_il`,
 * `register_mn`), et l'origine de chaque membre (`origin`), que
 * `RESTRICTED_WITHDRAWN` nomme pour un retrait en minutes.
 *
 * ## Ce qui n'y est pas, et pourquoi
 *
 * - La Slovaquie reste publique (décision du 24/09/2026, point 4 : publiable avec
 *   la citation de la NBS). Ses lignes de `national_bank_codes` ne sont pas un membre.
 * - La Tchéquie aussi : les conditions de la ČNB permettent de stocker, transmettre
 *   et reproduire avec « Zdroj: ČNB » (docs/data-sources.md). Ni ses lignes ni la
 *   table de ses éditions annoncées (`national_bank_codes_pending`) ne sont membres.
 *   L'Italie non plus (open data CC BY 4.0 de la Banca d'Italia).
 * - `bic_entries` de source `six_group` : vérifié le 25/09/2026, ces lignes viennent
 *   du MÊME fichier que le registre suisse (`bankmaster_V3.csv`, lu par
 *   scripts/enrich-bic-database.ts et scripts/seed-bc-nummer.ts), dont la
 *   description dit « may be used freely ». Publiques.
 * - Les clés AT et BE de la carte composite `src/db/bic_data.json`, retirées du
 *   dépôt public à l'étape du retrait (25/09/2026, décision du 24/09/2026 « tout
 *   ce qui n'est pas redistribuable sort ») sans devenir des membres : les
 *   registres autrichien et belge de la surcouche répondent pour ces pays (preuve
 *   centrale du 25/09/2026 : réponses identiques). De même les exports du site
 *   pour AT, BE et SM (les pages sont rendues à la demande depuis l'API) et les
 *   blocs EPC des réponses d'exemple suivies.
 *
 * ## Les membres venus après la première surcouche
 *
 * Les clés PL, FI et LU de la carte composite, et la liste finlandaise des codes
 * d'établissement (ancien `src/lib/fi-register.ts`), sont devenues des membres le
 * 25/09/2026 (décision de la session principale : servir ces clés depuis le dépôt
 * privé, aucune perte de service) : tables `curated_bank_codes` et
 * `fi_monetary_codes`, lues par la carte composite (src/lib/bic-lookup.ts) et par
 * src/lib/fi-register.ts. Une surcouche écrite avant eux ne les porte pas : ils
 * sont marqués `mayBeAbsent`, et un fichier qui ne les porte pas du tout (ni
 * table, ni ligne, ni compte) les laisse « absents » au lieu d'être refusé. Sans
 * eux, une réponse polonaise ou finlandaise dit « non consulté »
 * (`WITHDRAWN_BANK_CODE_COUNTRIES` dans src/lib/bic-lookup.ts).
 *
 * ## Les minimums
 *
 * Chaque membre porte un plancher de lignes, sur le modèle des portes de qualité
 * des seeders : une surcouche tronquée ne doit jamais remplacer silencieusement
 * un jeu entier. Les planchers des registres AT, BE et SM et de la liste PRA sont
 * CEUX des seeders (scripts/seed-national.ts et scripts/seed-pra-banks.ts les
 * importent d'ici). Les autres sont placés bien sous les comptes relevés le
 * 25/09/2026 sur la base livrée, pour qu'un mois ordinaire ne les franchisse pas.
 *
 * Aucune dépendance d'exécution : ce module est importé par les scripts comme par
 * l'API.
 */

/** Les deux bases livrées, et donc les deux fichiers de surcouche. */
export type OverlayKind = 'bic' | 'compliance';

/** Une table que la famille touche, avec les colonnes que le code interroge. */
export interface RestrictedTable {
  /** Nom de la table, identique dans la base publique et dans la surcouche. */
  name: string;
  /**
   * Colonnes que le code de l'API lit. Une surcouche dont la table en manque est
   * refusée ; quand la base publique porte la table, les colonnes doivent en
   * plus être exactement les siennes, dans le même ordre.
   */
  columns: readonly string[];
  /**
   * Colonne alias du rowid (INTEGER PRIMARY KEY), jamais recopiée : la base
   * servie attribue ses propres numéros. Les lignes de la famille sont insérées
   * dans leur ordre d'origine, APRÈS les lignes publiques, exactement comme la
   * reconstruction mensuelle les insère (voir la note de `bic_entries`).
   */
  rowidAlias?: string;
  /**
   * Conflit sur une clé unique pendant la fusion : `ignore` laisse gagner la
   * ligne publique (même règle que l'`INSERT OR IGNORE` du seeder), `fail`
   * refuse le membre.
   */
  onConflict: 'ignore' | 'fail';
  /**
   * La définition de la table et de ses index, telle que la base PUBLIQUE la
   * porte. L'extraction crée les tables de la surcouche avec elle, et la fusion
   * recrée avec elle une table que la base publique n'aurait plus. Jamais le SQL
   * lu dans la surcouche elle-même : un fichier forgé pourrait y cacher une
   * seconde instruction (relecture de la PR 252, R4). Un test compare ces
   * définitions aux bases livrées.
   */
  ddl: readonly string[];
  /**
   * Comment dater les lignes d'un membre, de la même façon des deux côtés
   * (surcouche et base publique), pour décider laquelle sert :
   * - `base_last_refresh` : la date du dernier rafraîchissement de la base de
   *   conformité (`metadata.last_refresh`), faute de date par ligne ;
   * - `max_updated_at` : la plus récente des dates de chargement des lignes ;
   * - `list_month_then_updated_at` : le mois de la liste, puis la date de
   *   chargement (liste PRA : le mois est la condition de la permission) ;
   * - `max_as_of` : la date d'édition la plus récente ; vide pour AT et BE, dont
   *   les éditeurs ne datent rien, ce qui les laisse au public sauf contenu
   *   identique (règle de fusion, src/lib/restricted-overlay.ts).
   */
  freshness: 'base_last_refresh' | 'max_updated_at' | 'list_month_then_updated_at' | 'max_as_of';
  /**
   * Les membres de la table se décident ensemble, tous par la surcouche ou tous
   * par le public. Vrai pour `bic_entries` : OeNB, NBP et EBA STEP2 viennent du
   * même passage mensuel, partagent un `INSERT OR IGNORE` et l'ordre des
   * identifiants que lit la recherche par BIC8 ; en garder un et réinsérer
   * l'autre à la fin changerait la préséance.
   */
  decideTogether: boolean;
}

/** Un membre : un jeu de lignes d'une source, dans une table. */
export interface RestrictedMember {
  /** Identifiant stable, écrit dans la surcouche et dans les journaux. */
  id: string;
  kind: OverlayKind;
  table: string;
  /**
   * Les lignes du membre dans la table : `null` pour la table entière, sinon une
   * égalité sur une colonne. Jamais une chaîne SQL libre : la valeur est liée.
   */
  where: { column: string; value: string } | null;
  /** Plancher de lignes en dessous duquel le membre est refusé. */
  minRows: number;
  /** Ce qu'est la source, pour les journaux et la table de métadonnées. */
  label: string;
  /**
   * Membre ajouté après la première surcouche publiée (25/09/2026) : un fichier
   * qui ne le porte pas du tout (aucune ligne, aucun compte dans
   * `overlay_members`) le laisse « absent » (non servi, « non consulté ») au lieu
   * d'être refusé, sans alerte. Sans cela, la release que la production tire
   * aujourd'hui serait refusée par le code qui introduit le membre, et le
   * passage mensuel qui le construit ne tourne qu'après la fusion. Un membre
   * déjà servi qui devient absent reste une perte : le rechargement garde ce
   * qu'il sert (src/lib/restricted-overlay-runtime.ts) et la porte du manifeste
   * refuse la release (`lost_member`). Jamais pour un membre de la première
   * surcouche : un fichier qui en perdrait un doit toujours être refusé.
   */
  mayBeAbsent?: boolean;
  /**
   * Liste STATIQUE, sans source à télécharger (la liste finlandaise : un PDF
   * transcrit à la main) : le passage mensuel la recopie telle quelle de la
   * surcouche précédente, sans la compter comme reprise ni lui appliquer la
   * borne d'âge des reprises (sa date est celle de la liste). Seul un geste
   * manuel la remplace (FI_LIST_PATH, scripts/seed-curated-map.ts).
   */
  staticList?: boolean;
  /**
   * Qui a publié la donnée, en un mot (son domaine) : le nom qu'un retrait
   * donne à `RESTRICTED_WITHDRAWN` pour cesser de servir tous les membres de
   * cette origine en un redémarrage (voir `withdrawnMembers`). Plusieurs membres
   * peuvent partager une origine (les clés aspirées chez un même concurrent).
   */
  origin: string;
  /**
   * Clés de la carte composite servies EN COMPLÉMENT, code par code (règle du
   * 28/10/2026) : une clé que le fichier public porte déjà, ou qu'une source
   * officielle décide, garde la réponse publique ; la surcouche n'ajoute que
   * les codes qui n'en ont aucune. Sans ce drapeau, un membre de
   * `curated_bank_codes` sert un pays entier, et seulement quand le fichier
   * public n'en porte plus aucune clé (PL, FI, LU).
   */
  supplement?: boolean;
}

export const RESTRICTED_TABLES: Readonly<Record<OverlayKind, readonly RestrictedTable[]>> = {
  bic: [
    {
      name: 'bic_entries',
      // Mesuré le 25/09/2026 : chaque identifiant de la famille est supérieur à
      // chaque identifiant public, parce que la reconstruction mensuelle
      // (refresh-bic.yml) insère OeNB, NBP puis EBA STEP2 en dernier. La
      // recherche par BIC8 lit les lignes dans l'ordre des identifiants : les
      // lignes de la surcouche sont donc ajoutées après les lignes publiques,
      // dans leur ordre d'origine, avec des numéros neufs.
      columns: [
        'id',
        'bic8',
        'bic11',
        'institution',
        'country_code',
        'country_name',
        'city',
        'branch_code',
        'branch_info',
        'lei',
        'lei_status',
        'is_test_bic',
        'source',
        'street',
        'post_code',
        'region',
        'address_en',
        'address_source',
        'address_lang',
        'address_as_of',
        'updated_at',
      ],
      rowidAlias: 'id',
      // Le seeder insère ces sources par INSERT OR IGNORE après les sources
      // publiques : un BIC11 déjà connu d'une source publique garde la ligne
      // publique. La fusion reproduit la même règle.
      onConflict: 'ignore',
      ddl: [
        `CREATE TABLE bic_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bic8         TEXT NOT NULL,
  bic11        TEXT NOT NULL UNIQUE,
  institution  TEXT,
  country_code TEXT NOT NULL,
  country_name TEXT,
  city         TEXT,
  branch_code  TEXT,
  branch_info  TEXT,
  lei          TEXT,
  lei_status   TEXT,
  is_test_bic  INTEGER DEFAULT 0,
  source       TEXT DEFAULT 'gleif',
  street         TEXT,
  post_code      TEXT,
  region         TEXT,
  address_en     TEXT,
  address_source TEXT,
  address_lang   TEXT,
  address_as_of  TEXT,
  updated_at   TEXT DEFAULT (datetime('now'))
)`,
        'CREATE INDEX idx_bic8 ON bic_entries(bic8)',
        'CREATE INDEX idx_bic11 ON bic_entries(bic11)',
        'CREATE INDEX idx_lei ON bic_entries(lei)',
        'CREATE INDEX idx_country ON bic_entries(country_code)',
      ],
      freshness: 'max_updated_at',
      decideTogether: true,
    },
    {
      name: 'national_bank_codes',
      columns: [
        'country',
        'code',
        'name',
        'bic',
        'street',
        'post_code',
        'town',
        'lei',
        'source',
        'as_of',
      ],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE national_bank_codes (
  country TEXT NOT NULL,
  code    TEXT NOT NULL,
  name    TEXT NOT NULL,
  bic     TEXT, street TEXT, post_code TEXT, town TEXT, lei TEXT, source TEXT, as_of TEXT,
  PRIMARY KEY (country, code)
)`,
      ],
      freshness: 'max_as_of',
      decideTogether: false,
    },
    {
      name: 'pra_banks',
      columns: [
        'frn',
        'firm_name',
        'lei',
        'section',
        'lei_basis',
        'list_month',
        'source',
        'updated_at',
      ],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE pra_banks (
  frn        TEXT NOT NULL,
  firm_name  TEXT NOT NULL,
  lei        TEXT,
  section    TEXT NOT NULL,
  lei_basis  TEXT NOT NULL,
  list_month TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'Bank of England',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (frn, section)
)`,
        'CREATE INDEX idx_pra_banks_lei ON pra_banks(lei)',
      ],
      freshness: 'list_month_then_updated_at',
      decideTogether: false,
    },
    {
      // Les clés de la carte composite que le dépôt public ne porte plus (PL, FI,
      // LU) : un code bancaire, le BIC que la compilation lui donne. Aucune base
      // publique ne porte cette table ; la fusion la crée depuis cette définition.
      // `as_of` : la date de l'édition de la compilation lue (publication du
      // paquet), la même pour toutes les lignes d'un passage.
      name: 'curated_bank_codes',
      columns: ['country', 'code', 'bic', 'source', 'as_of'],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE curated_bank_codes (
  country TEXT NOT NULL,
  code    TEXT NOT NULL,
  bic     TEXT NOT NULL,
  source  TEXT NOT NULL,
  as_of   TEXT,
  PRIMARY KEY (country, code)
)`,
      ],
      freshness: 'max_as_of',
      decideTogether: false,
    },
    {
      // La liste finlandaise des codes d'établissement (Finance Finland) : un
      // code, de un à quatre caractères, attribué à un groupe bancaire et à son
      // BIC. Lue par préfixe le plus long (src/lib/fi-register.ts).
      name: 'fi_monetary_codes',
      columns: ['code', 'bic', 'institution', 'source', 'as_of'],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE fi_monetary_codes (
  code        TEXT PRIMARY KEY,
  bic         TEXT NOT NULL,
  institution TEXT NOT NULL,
  source      TEXT NOT NULL,
  as_of       TEXT NOT NULL
)`,
      ],
      freshness: 'max_as_of',
      decideTogether: false,
    },
  ],
  compliance: [
    {
      name: 'sanctioned_entities',
      columns: ['bic8', 'entity_name', 'source_list', 'country_code', 'directory_match'],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE sanctioned_entities (
  bic8        TEXT NOT NULL,
  entity_name TEXT,
  source_list TEXT NOT NULL,
  country_code TEXT,
  directory_match INTEGER NOT NULL DEFAULT 1,
  UNIQUE(bic8, source_list)
)`,
      ],
      freshness: 'base_last_refresh',
      decideTogether: false,
    },
    {
      name: 'sepa_participants',
      columns: ['bic8', 'scheme', 'status'],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE sepa_participants (
  bic8   TEXT NOT NULL,
  scheme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (bic8, scheme)
)`,
      ],
      freshness: 'base_last_refresh',
      decideTogether: false,
    },
    {
      name: 'vop_participants',
      columns: ['bic8', 'status'],
      onConflict: 'fail',
      ddl: [
        `CREATE TABLE vop_participants (
  bic8   TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
)`,
      ],
      freshness: 'base_last_refresh',
      decideTogether: false,
    },
  ],
};

/** Planchers partagés avec les seeders : une seule valeur par registre. */
export const RESTRICTED_FLOORS = {
  register_at: 700,
  register_be: 650,
  register_sm: 3,
  pra: 200,
  // Relevés le 25/09/2026 : 3 004 clés polonaises, 656 finlandaises et 143
  // luxembourgeoises dans la carte de main ; 3 156, 666 et 118 dans la
  // compilation schwifty 2025.9.0. La liste finlandaise de main comptait une
  // centaine de codes (plages développées), la compilation en porte un par
  // code à trois chiffres. Planchers bien en dessous, communs au seeder
  // (scripts/seed-curated-map.ts).
  map_pl: 2000,
  map_fi: 400,
  map_lu: 80,
  register_fi: 50,
  // 28/10/2026 : les clés retirées le 29/09/2026, relevées dans la roue
  // schwifty 2026.10.1 (56 AE, 25 BA, 16 EE, 20 GE, 49 KZ, 9 MD, 26 RS, 49 TR
  // valides ; ES, IT et RO avant le complément). Planchers à peu près à la
  // moitié : une compilation qui perd la moitié d'un pays n'est plus la même.
  map_ae: 25,
  map_ba: 10,
  map_ee: 8,
  map_ge: 10,
  map_kz: 20,
  map_md: 4,
  map_rs: 10,
  map_tr: 20,
  map_es: 150,
  map_it: 150,
  map_ro: 20,
  // 28/10/2026 : registres partiels de la case 2, relevés le jour même (22 codes
  // israéliens, 34 participants mongols hors liquidation). Planchers à la moitié,
  // communs au seeder (scripts/seed-national.ts).
  register_il: 11,
  register_mn: 17,
} as const;

/**
 * L'ordre dans lequel la reconstruction insère les sources de `bic_entries` :
 * OeNB, NBP, puis EBA STEP2 (scripts/enrich-bic-database.ts les importe dans cet
 * ordre, chacune par INSERT OR IGNORE : la première arrivée garde un BIC11
 * commun). La reprise d'un membre en panne (scripts/restricted-carry-over.ts)
 * réinsère ses lignes à la même place, pour que la préséance reste celle d'un
 * passage où la source aurait répondu. Chaque valeur est aussi l'identifiant du
 * membre (`where.value` = `id` pour ces trois membres).
 */
export const RESTRICTED_BIC_INSERT_ORDER = ['oenb', 'nbp', 'eba_step2'] as const;

/**
 * La fenêtre de la liste PRA de la Bank of England, en mois : le seeder
 * (scripts/seed-pra-banks.ts) prend la liste du mois courant ou, si elle n'est
 * pas encore publiée, celle de l'un des deux mois précédents. La reprise d'une
 * liste en panne n'accepte rien de plus ancien que ce que le seeder publierait
 * lui-même ce jour-là (scripts/restricted-carry-over.ts). Une seule valeur.
 */
export const PRA_LIST_MONTHS_BACK = 2;

export const RESTRICTED_FAMILY: readonly RestrictedMember[] = [
  // --- bic.sqlite -----------------------------------------------------------
  {
    id: 'eba_step2',
    kind: 'bic',
    table: 'bic_entries',
    where: { column: 'source', value: 'eba_step2' },
    // 189 lignes propres à EBA STEP2 le 25/09/2026.
    minRows: 100,
    label: 'EBA CLEARING, STEP2 SCT reachable PSPs (all rights reserved)',
    origin: 'ebaclearing.eu',
  },
  {
    id: 'nbp',
    kind: 'bic',
    table: 'bic_entries',
    where: { column: 'source', value: 'nbp' },
    // 21 lignes le 25/09/2026.
    minRows: 10,
    label: 'Narodowy Bank Polski, EWIB directory (non-commercial by default)',
    origin: 'nbp.pl',
  },
  {
    id: 'oenb',
    kind: 'bic',
    table: 'bic_entries',
    where: { column: 'source', value: 'oenb' },
    // UNE ligne le 25/09/2026 : presque tous les BIC du fichier de l'OeNB sont
    // déjà dans l'annuaire public, et l'INSERT OR IGNORE ne garde que les autres.
    // Un membre vide est donc légitime ; un plancher le ferait refuser à tort.
    minRows: 0,
    label: 'Oesterreichische Nationalbank, SEPA directory (terms unknown)',
    origin: 'oenb.at',
  },
  {
    id: 'register_at',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'AT' },
    minRows: RESTRICTED_FLOORS.register_at,
    label: 'Oesterreichische Nationalbank, Austrian bank codes (terms unknown)',
    origin: 'oenb.at',
  },
  {
    id: 'register_be',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'BE' },
    minRows: RESTRICTED_FLOORS.register_be,
    label: 'National Bank of Belgium, Belgian bank codes (terms unknown)',
    origin: 'nbb.be',
  },
  {
    id: 'register_sm',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'SM' },
    minRows: RESTRICTED_FLOORS.register_sm,
    // Confirmation écrite de la BCSM du 16/10/2026 : l'usage dans les réponses de
    // l'API est acceptable avec la formule et la date de consultation. Elle ne
    // porte pas sur une copie de la liste dans ce dépôt : le membre reste privé.
    label:
      'Central Bank of the Republic of San Marino, Operating Banks (written confirmation for API answers, with attribution)',
    origin: 'bcsm.sm',
  },
  {
    id: 'pra',
    kind: 'bic',
    table: 'pra_banks',
    where: null,
    minRows: RESTRICTED_FLOORS.pra,
    label: 'Bank of England, PRA List of Banks (permission for API use only)',
    origin: 'bankofengland.co.uk',
  },
  // Membres venus après la première surcouche (voir `mayBeAbsent`).
  {
    id: 'map_pl',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'PL' },
    minRows: RESTRICTED_FLOORS.map_pl,
    label:
      'Polish bank codes of the composite map, from the NBP EWIB file (non-commercial by default)',
    mayBeAbsent: true,
    origin: 'nbp.pl',
  },
  {
    id: 'map_fi',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'FI' },
    minRows: RESTRICTED_FLOORS.map_fi,
    label: 'Finnish bank codes of the composite map, from Finance Finland (terms not established)',
    mayBeAbsent: true,
    origin: 'financefinland.fi',
  },
  {
    id: 'map_lu',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'LU' },
    minRows: RESTRICTED_FLOORS.map_lu,
    label: 'Luxembourg bank codes of the composite map, from the ABBL register (API use only)',
    mayBeAbsent: true,
    origin: 'abbl.lu',
  },
  {
    id: 'register_fi',
    kind: 'bic',
    table: 'fi_monetary_codes',
    where: null,
    minRows: RESTRICTED_FLOORS.register_fi,
    label: 'Finance Finland, Finnish monetary institution codes (terms not established)',
    mayBeAbsent: true,
    staticList: true,
    origin: 'financefinland.fi',
  },
  // Règle du 28/10/2026 (« go pour B », DECISIONS.md) : les clés banque → BIC
  // retirées le 29/09/2026 reviennent, servies depuis la surcouche et jamais
  // depuis ce dépôt, en COMPLÉMENT du fichier public (`supplement`). Toutes sont
  // relues chaque mois dans la dernière roue schwifty (scripts/seed-curated-map.ts),
  // depuis le fichier dont elles venaient le 29/09 (docs/data-sources.md). Case 2
  // de la grille pour la Turquie (association qui réserve l'usage commercial à
  // son accord écrit), case 4 pour les autres (compilations de sites concurrents).
  // Un propriétaire qui demande l'arrêt : RESTRICTED_WITHDRAWN=<origine>, puis
  // retrait du membre ici (48 heures au plus).
  {
    // Banques turques : la liste de la TBB (`manual_tr` de schwifty).
    id: 'map_tr',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'TR' },
    minRows: RESTRICTED_FLOORS.map_tr,
    label:
      'Turkish bank codes, Türkiye Bankalar Birliği list compiled by mdomke/schwifty (commercial use subject to written consent; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'tbb.org.tr',
    supplement: true,
  },
  {
    // `manual_ae` de schwifty : ibancalculator.com.
    id: 'map_ae',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'AE' },
    minRows: RESTRICTED_FLOORS.map_ae,
    label:
      'Emirati bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_ba` de schwifty : ibancalculator.com.
    id: 'map_ba',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'BA' },
    minRows: RESTRICTED_FLOORS.map_ba,
    label:
      'Bosnian bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_ge` de schwifty : ibancalculator.com.
    id: 'map_ge',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'GE' },
    minRows: RESTRICTED_FLOORS.map_ge,
    label:
      'Georgian bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_kz` de schwifty : ibancalculator.com.
    id: 'map_kz',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'KZ' },
    minRows: RESTRICTED_FLOORS.map_kz,
    label:
      'Kazakh bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_md` de schwifty : ibancalculator.com.
    id: 'map_md',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'MD' },
    minRows: RESTRICTED_FLOORS.map_md,
    label:
      'Moldovan bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_ee` de schwifty : ibancalculator.com. Le registre officiel privé gagne là où il répond (enrich.ts).
    id: 'map_ee',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'EE' },
    minRows: RESTRICTED_FLOORS.map_ee,
    label:
      'Estonian bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served where the official list does not answer, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_rs` de schwifty : ibancalculator.com. Le registre officiel privé gagne là où il répond (enrich.ts).
    id: 'map_rs',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'RS' },
    minRows: RESTRICTED_FLOORS.map_rs,
    label:
      'Serbian bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served where the official list does not answer, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_it` de schwifty : ibancalculator.com. Les clés reconstruites depuis la Banca d'Italia et GLEIF gardent la priorité.
    id: 'map_it',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'IT' },
    minRows: RESTRICTED_FLOORS.map_it,
    label:
      "Italian bank codes, ibancalculator.com compiled by mdomke/schwifty (no licence; served only for codes the public map and the Banca d'Italia rebuild leave without a BIC, withdrawn within 48 hours on request)",
    mayBeAbsent: true,
    origin: 'ibancalculator.com',
    supplement: true,
  },
  {
    // `generated_es` de schwifty : iban.es.
    id: 'map_es',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'ES' },
    minRows: RESTRICTED_FLOORS.map_es,
    label:
      'Spanish bank codes, iban.es compiled by mdomke/schwifty (no licence; served only for codes the public map does not carry, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'iban.es',
    supplement: true,
  },
  {
    // `generated_ro` de schwifty : internationalmoneytransfers.org. Les clés reconstruites depuis GLEIF gardent la priorité.
    id: 'map_ro',
    kind: 'bic',
    table: 'curated_bank_codes',
    where: { column: 'country', value: 'RO' },
    minRows: RESTRICTED_FLOORS.map_ro,
    label:
      'Romanian bank codes, internationalmoneytransfers.org compiled by mdomke/schwifty (reproduction prohibited; served only for codes the public map does not carry, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'internationalmoneytransfers.org',
    supplement: true,
  },
  // Règle du 28/10/2026, case 2 (suite du point 7) : deux registres PARTIELS pour
  // des pays où l'API ne nommait aucune banque, sur le modèle de Saint-Marin (même
  // table, `NON_EXHAUSTIVE_REGISTERS` dans enrich.ts : un code listé nomme son
  // titulaire, une absence ne dit rien). Relus chaque mois par la chaîne privée
  // (scripts/seed-national.ts, SEED_FAMILY=restricted), jamais dans ce dépôt.
  {
    // La Banque d'Israël sur le portail ouvert du gouvernement : la liste des
    // sociétés bancaires (jeu 375), complétée par la liste des agences pour les
    // codes qu'elle ne porte pas (scripts/seed-national-il.ts).
    id: 'register_il',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'IL' },
    minRows: RESTRICTED_FLOORS.register_il,
    label:
      'Bank of Israel, list of banking corporations and bank branches on data.gov.il (licence "other (open)" without text; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'boi.org.il',
  },
  {
    // Le registre unifié des participants au système de paiement de la Mongolbank,
    // un PDF (scripts/seed-national-mn.ts) : le BIC de la seule colonne SWIFT.
    id: 'register_mn',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'MN' },
    minRows: RESTRICTED_FLOORS.register_mn,
    label:
      'Bank of Mongolia, unified register of payment system participants (no reuse terms published; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'mongolbank.mn',
  },
  // --- compliance.sqlite ----------------------------------------------------
  {
    id: 'un',
    kind: 'compliance',
    table: 'sanctioned_entities',
    where: { column: 'source_list', value: 'UN' },
    // 5 lignes le 25/09/2026. Zéro BIC de banque sur la liste de l'ONU se
    // regarde : le membre est alors refusé, l'ONU n'est plus nommée (PR 249).
    minRows: 1,
    label: 'United Nations Security Council consolidated list (all rights reserved)',
    origin: 'un.org',
  },
  {
    id: 'epc_sepa',
    kind: 'compliance',
    table: 'sepa_participants',
    where: null,
    // 4 463 lignes le 25/09/2026 (SCT, SCT Inst, SDD Core).
    minRows: 3000,
    label: 'European Payments Council, SEPA scheme registers (non-commercial by default)',
    origin: 'europeanpaymentscouncil.eu',
  },
  {
    id: 'epc_vop',
    kind: 'compliance',
    table: 'vop_participants',
    where: null,
    // 1 288 lignes le 25/09/2026.
    minRows: 1000,
    label: 'European Payments Council, Verification of Payee register (non-commercial by default)',
    origin: 'europeanpaymentscouncil.eu',
  },
  {
    // Règle du 28/10/2026, case 2 : la liste suisse des sanctions, servie depuis
    // la surcouche sans attendre la réponse du SECO (les conditions des sites
    // fédéraux demandent un accord écrit préalable pour reproduire leur
    // contenu ; aucun n'est tenu). Lue dans l'export complet par
    // scripts/seco-list.ts, en chaîne privée seulement. Une dizaine de BIC de
    // banque : un plancher à une ligne, comme l'ONU ; la taille de la liste
    // elle-même est gardée par scripts/sanctions-source-floor.ts.
    id: 'seco',
    kind: 'compliance',
    table: 'sanctioned_entities',
    where: { column: 'source_list', value: 'SECO' },
    minRows: 1,
    label:
      'State Secretariat for Economic Affairs SECO, Swiss sanctions list (no written permission; served, withdrawn within 48 hours on request)',
    mayBeAbsent: true,
    origin: 'seco.admin.ch',
  },
];

/** Les membres d'une base. */
export function membersOf(kind: OverlayKind): RestrictedMember[] {
  return RESTRICTED_FAMILY.filter((m) => m.kind === kind);
}

/** La description d'une table de la famille. */
export function restrictedTable(kind: OverlayKind, name: string): RestrictedTable {
  const table = RESTRICTED_TABLES[kind].find((t) => t.name === name);
  if (!table) throw new Error(`Table hors de la famille : ${kind}.${name}`);
  return table;
}

/**
 * La clause WHERE d'un membre et sa valeur liée. Les noms de colonnes viennent de
 * cette constante, jamais d'une entrée : ils sont quand même contrôlés.
 */
export function memberPredicate(member: RestrictedMember): { sql: string; params: string[] } {
  if (!member.where) return { sql: '1 = 1', params: [] };
  if (!/^[a-z_]+$/.test(member.where.column)) throw new Error('Colonne de membre invalide');
  return { sql: `"${member.where.column}" = ?`, params: [member.where.value] };
}

/**
 * Les variables d'environnement qui désignent les surcouches privées, sur le
 * modèle de `LU_REGISTER_PATH`. Absentes : l'API sert la base publique seule.
 */
export const OVERLAY_ENV: Readonly<Record<OverlayKind, string>> = {
  bic: 'RESTRICTED_BIC_OVERLAY_PATH',
  compliance: 'RESTRICTED_COMPLIANCE_OVERLAY_PATH',
};

/**
 * Ce qu'un seeder écrit.
 *
 * - `public` sans variable : les sources publiques SEULES, jamais un membre de la
 *   famille. Depuis l'étape du retrait (25/09/2026), c'est le mode des robots
 *   publics (refresh-bic.yml, refresh-compliance.yml, les relectures tchèque et
 *   italienne) et de toute copie d'un contributeur : aucun ne télécharge ni
 *   n'écrit plus la famille dans `data/`, d'où elle serait commitée.
 * - `restricted` avec `SEED_FAMILY=restricted` : la famille seule, pour la chaîne
 *   privée (`npm run overlay:seed`, qui pose la variable elle-même).
 *
 * Le défaut est le mode sûr exprès : un workflow qui oublierait la variable ne
 * peut pas retélécharger la famille dans le dépôt public. Une autre valeur est
 * une faute de frappe qui ne doit passer pour aucun des deux.
 */
export function seedFamilyFromEnv(): 'public' | 'restricted' {
  const value = process.env.SEED_FAMILY ?? '';
  if (value === '') return 'public';
  if (value === 'restricted') return 'restricted';
  throw new Error(`SEED_FAMILY inconnu : « ${value} » (seule valeur admise : restricted)`);
}

/** Les sources de `bic_entries` que la famille retire (OeNB, NBP, EBA STEP2). */
export function restrictedBicSources(): Set<string> {
  return new Set(
    membersOf('bic')
      .filter((m) => m.table === 'bic_entries' && m.where)
      .map((m) => m.where!.value),
  );
}

/** Les pays de `national_bank_codes` que la famille porte (AT, BE, SM, IL, MN). */
export function restrictedRegisterCountries(): Set<string> {
  return new Set(
    membersOf('bic')
      .filter((m) => m.table === 'national_bank_codes' && m.where)
      .map((m) => m.where!.value),
  );
}

/**
 * Les pays dont TOUTES les clés de la carte composite viennent de la surcouche
 * (PL, FI, LU) : servis pays entier, quand le fichier public n'en porte aucune.
 * Les membres en complément (`supplement`) n'en sont pas : voir
 * `restoredMapCountries`.
 */
export function curatedMapCountries(): Set<string> {
  return new Set(
    membersOf('bic')
      .filter((m) => m.table === 'curated_bank_codes' && m.where && !m.supplement)
      .map((m) => m.where!.value),
  );
}

/**
 * Les pays dont la surcouche complète la carte code par code (règle du
 * 28/10/2026) : les clés retirées le 29/09/2026, de retour depuis le fichier
 * privé seulement. Une clé publique garde toujours la priorité.
 */
export function restoredMapCountries(): Set<string> {
  return new Set(
    membersOf('bic')
      .filter((m) => m.table === 'curated_bank_codes' && m.where && m.supplement)
      .map((m) => m.where!.value),
  );
}

/**
 * La variable qui retire des membres SANS toucher au fichier privé : une liste
 * séparée par des virgules d'origines (`ibancalculator.com`) ou d'identifiants
 * de membres (`map_tr`). Posée sur le serveur, elle prend effet au redémarrage
 * que Railway fait à chaque changement de variable : quelques minutes, contre
 * un passage de la chaîne privée et un tirage pour un retrait par le fichier,
 * que les gardes contre la perte d'un membre refuseraient d'ailleurs
 * (`members_lost`). Un membre retiré n'est pas servi (ses lignes sont ôtées de
 * la copie fusionnée), n'est ni refusé ni absent, et `GET /health` le nomme
 * sous `restricted_overlays.<base>.withdrawn`.
 */
export const WITHDRAWN_ENV = 'RESTRICTED_WITHDRAWN';

/**
 * Ce que `RESTRICTED_WITHDRAWN` retire : les identifiants des membres dont
 * l'identifiant ou l'origine est nommé, et les mots qui ne nomment rien (une
 * faute de frappe ne doit pas passer pour un retrait : `/health` les montre).
 */
export function withdrawnMembers(value: string | undefined = process.env[WITHDRAWN_ENV]): {
  ids: Set<string>;
  unmatched: string[];
} {
  const ids = new Set<string>();
  const unmatched: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const token = raw.trim().toLowerCase();
    if (token === '') continue;
    const hits = RESTRICTED_FAMILY.filter((m) => m.id === token || m.origin === token);
    if (hits.length === 0) unmatched.push(token);
    for (const m of hits) ids.add(m.id);
  }
  return { ids, unmatched };
}
