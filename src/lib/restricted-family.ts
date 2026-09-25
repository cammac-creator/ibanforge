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
 * - Les données hors des deux bases, retirées du dépôt public à l'étape du retrait
 *   (25/09/2026, décision du 24/09/2026 « tout ce qui n'est pas redistribuable
 *   sort ») sans devenir des membres : les clés AT, BE, LU, PL et FI de la carte
 *   composite `src/db/bic_data.json`, la liste finlandaise transcrite (ancien
 *   `src/lib/fi-register.ts`), les exports du site pour AT, BE et SM (les pages
 *   sont rendues à la demande depuis l'API) et les blocs EPC des réponses
 *   d'exemple suivies. Ces données ne sont servies par aucune surcouche : une
 *   réponse qui en dépendait dit « non consulté » (src/lib/enrich.ts,
 *   `WITHDRAWN_BANK_CODE_COUNTRIES` dans src/lib/bic-lookup.ts).
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
  },
  {
    id: 'nbp',
    kind: 'bic',
    table: 'bic_entries',
    where: { column: 'source', value: 'nbp' },
    // 21 lignes le 25/09/2026.
    minRows: 10,
    label: 'Narodowy Bank Polski, EWIB directory (non-commercial by default)',
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
  },
  {
    id: 'register_at',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'AT' },
    minRows: RESTRICTED_FLOORS.register_at,
    label: 'Oesterreichische Nationalbank, Austrian bank codes (terms unknown)',
  },
  {
    id: 'register_be',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'BE' },
    minRows: RESTRICTED_FLOORS.register_be,
    label: 'National Bank of Belgium, Belgian bank codes (terms unknown)',
  },
  {
    id: 'register_sm',
    kind: 'bic',
    table: 'national_bank_codes',
    where: { column: 'country', value: 'SM' },
    minRows: RESTRICTED_FLOORS.register_sm,
    label: 'Central Bank of the Republic of San Marino, operating banks (licence unknown)',
  },
  {
    id: 'pra',
    kind: 'bic',
    table: 'pra_banks',
    where: null,
    minRows: RESTRICTED_FLOORS.pra,
    label: 'Bank of England, PRA List of Banks (permission for API use only)',
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
  },
  {
    id: 'epc_sepa',
    kind: 'compliance',
    table: 'sepa_participants',
    where: null,
    // 4 463 lignes le 25/09/2026 (SCT, SCT Inst, SDD Core).
    minRows: 3000,
    label: 'European Payments Council, SEPA scheme registers (non-commercial by default)',
  },
  {
    id: 'epc_vop',
    kind: 'compliance',
    table: 'vop_participants',
    where: null,
    // 1 288 lignes le 25/09/2026.
    minRows: 1000,
    label: 'European Payments Council, Verification of Payee register (non-commercial by default)',
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

/** Les pays de `national_bank_codes` que la famille retire (AT, BE, SM). */
export function restrictedRegisterCountries(): Set<string> {
  return new Set(
    membersOf('bic')
      .filter((m) => m.table === 'national_bank_codes' && m.where)
      .map((m) => m.where!.value),
  );
}
