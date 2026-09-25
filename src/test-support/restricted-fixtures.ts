/**
 * Des données inventées à la place de celles que le dépôt public ne peut pas porter.
 *
 * ## Pourquoi ce fichier existe
 *
 * Le 24/09/2026, Claude-Alain a décidé que toute table dont la licence
 * n'autorise pas la redistribution quitte le dépôt public pour un fichier privé :
 * entre autres les registres de codes bancaires autrichien, belge et
 * saint-marinais, la liste des banques de la Bank of England, les registres EPC
 * des schémas SEPA et de la Verification of Payee, et la liste de sanctions de
 * l'ONU. Mesuré le même jour sur une copie sans elles : 48 tests se sautaient
 * seuls et la suite restait verte sans plus tester aucun de ces chemins.
 *
 * Un test qui passe par l'un de ces chemins apporte donc ses propres données :
 * une copie des bases dans laquelle les vraies lignes de ces six jeux sont
 * SUPPRIMÉES, puis remplacées par des lignes de la même forme, entièrement
 * inventées. Supprimer d'abord, c'est tout l'intérêt : sans cela la suite
 * passerait encore aujourd'hui sur les vraies lignes et ne prouverait rien sur
 * le jour où elles ne seront plus là.
 *
 * Tout le reste des copies est la donnée publique, intacte : le reste de
 * l'enrichissement (annuaire BIC, carte composite, registres allemand et suisse,
 * GAFI) se comporte exactement comme en production.
 *
 * ## Les données inventées
 *
 * Chaque code, nom, BIC et LEI ci-dessous est inventé. Les codes bancaires ont
 * été vérifiés le 25/09/2026 contre les vrais registres et la carte composite
 * (src/db/bic_data.json), les BIC contre l'annuaire BIC : aucun n'est attribué
 * à qui que ce soit. Les LEI portent des chiffres de contrôle ISO 17442 valides
 * sur un préfixe `XMPL` qu'aucun émetteur n'utilise.
 *
 * ## Comment un test s'en sert
 *
 * Les chemins des bases sont lus UNE fois, au premier import de `src/lib/db.ts`
 * et de `src/lib/compliance-db.ts`. Le jeu d'essai doit donc être installé
 * avant tout import de ces modules, ce à quoi sert `vi.hoisted` :
 *
 *   const { fixture } = await vi.hoisted(async () => {
 *     const m = await import('../test-support/restricted-fixtures.js');
 *     return { fixture: m.installRestrictedFixture() };
 *   });
 *   afterAll(() => fixture.restore());
 *
 * Volontairement sans aucun import de vitest : scripts/check-runtime-deps.ts
 * lit tout fichier non-test de src/ comme du code d'exécution, et vitest est une
 * dépendance de développement. Exclu de la construction par tsconfig.build.json.
 */
import { constants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type DatabaseType from 'better-sqlite3';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

/** Les six jeux sous licence restrictive que le jeu d'essai remplace. */
export type RestrictedDataset = 'AT' | 'BE' | 'SM' | 'PRA' | 'EPC' | 'UN';

export const RESTRICTED_DATASETS: readonly RestrictedDataset[] = [
  'AT',
  'BE',
  'SM',
  'PRA',
  'EPC',
  'UN',
];

// ---------------------------------------------------------------------------
// Arithmétique IBAN, pour qu'aucun test ne porte une clé calculée à la main
// ---------------------------------------------------------------------------

/** ISO 7064 mod 97-10 sur une chaîne alphanumérique, lettres comptées de 10 à 35. */
function mod97(s: string): number {
  let r = 0;
  for (const ch of s) {
    const v = parseInt(ch, 36);
    r = v >= 10 ? (r * 100 + v) % 97 : (r * 10 + v) % 97;
  }
  return r;
}

/** Un IBAN valide pour un BBAN, clé calculée. */
export function ibanFor(country: string, bban: string): string {
  const check = 98 - mod97(`${bban}${country}00`);
  return `${country}${String(check).padStart(2, '0')}${bban}`;
}

/**
 * Un BBAN belge avec sa clé nationale : les dix premiers chiffres modulo 97,
 * 97 quand le reste vaut 0. Le validateur d'IBAN la contrôle.
 */
export function belgianBban(bankCode: string, account7: string): string {
  const first10 = `${bankCode}${account7}`;
  const r = Number(BigInt(first10) % 97n);
  return `${first10}${String(r === 0 ? 97 : r).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Les registres inventés
// ---------------------------------------------------------------------------

/** Une ligne de `national_bank_codes`, sous la forme qu'écrit scripts/seed-national.ts. */
interface NationalRow {
  code: string;
  name: string;
  bic: string | null;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
  source: string | null;
  as_of: string | null;
}

/**
 * Autriche. L'OeNB publie l'adresse du siège et le LEI, des BIC à 11 caractères,
 * et ne demande aucune ligne de crédit propre (source et as_of nuls).
 *
 * `XMPLATW2` est partagé exprès : le siège d'un institut central inventé sur
 * 19983, et un membre local sur 19982 dont le BIC porte un code d'agence. C'est
 * la forme des réseaux coopératifs autrichiens, où la racine de huit caractères
 * désigne une AUTRE entité juridique.
 */
const AT_ROWS: NationalRow[] = [
  {
    code: '19981',
    name: 'Beispielbank Alpha AG',
    bic: 'XMPLATW1XXX',
    street: 'Musterweg 1',
    post_code: '1010',
    town: 'Wien',
    lei: 'XMPLAT000000000A0197',
    source: null,
    as_of: null,
  },
  {
    code: '19982',
    name: 'Beispielkasse Musterdorf eGen',
    bic: 'XMPLATW2MUS',
    street: 'Dorfplatz 7',
    post_code: '3300',
    town: 'Musterdorf',
    lei: 'XMPLAT000000000A0294',
    source: null,
    as_of: null,
  },
  {
    code: '19983',
    name: 'Beispiel-Zentralinstitut AG',
    bic: 'XMPLATW2XXX',
    street: 'Zentralgasse 3',
    post_code: '1010',
    town: 'Wien',
    lei: 'XMPLAT000000000A0391',
    source: null,
    as_of: null,
  },
  {
    // Stocké complété de zéros, comme le seeder complète ce que l'OeNB écrit sans.
    code: '00980',
    name: 'Beispiel-Notenbank',
    bic: 'XMPLATW3XXX',
    street: 'Notenplatz 1',
    post_code: '1090',
    town: 'Wien',
    lei: null,
    source: null,
    as_of: null,
  },
];

/** Belgique. La BNB ne publie que des noms, des BIC à 8 caractères, et parfois aucun BIC. */
const BE_ROWS: NationalRow[] = [
  {
    code: '990',
    name: 'Banque Exemple Alpha SA',
    bic: 'XMPLBEB1',
    street: null,
    post_code: null,
    town: null,
    lei: null,
    source: null,
    as_of: null,
  },
  {
    code: '991',
    name: 'Exemple Monnaie Électronique SA',
    bic: 'XMPLBEB2',
    street: null,
    post_code: null,
    town: null,
    lei: null,
    source: null,
    as_of: null,
  },
  {
    code: '992',
    name: 'Banque Exemple Sans BIC SA',
    bic: null,
    street: null,
    post_code: null,
    town: null,
    lei: null,
    source: null,
    as_of: null,
  },
];

/** Le crédit que portent les lignes saint-marinaises, tel que l'écrit scripts/seed-national.ts. */
export const SM_SOURCE = 'Central Bank of the Republic of San Marino, operating banks';
/** Le jour où la page inventée a été « lue » : volontairement pas une vraie date de lecture. */
export const SM_READ_ON = '2026-01-15';

/** Saint-Marin. Une liste de banques en activité avec leur siège, sans LEI. */
const SM_ROWS: NationalRow[] = [
  {
    code: '09991',
    name: 'Banca di Esempio Sammarinese S.p.A.',
    bic: 'XMPLSMSM',
    street: "Via dell'Esempio, 1",
    post_code: '47890',
    town: 'San Marino',
    lei: null,
    source: SM_SOURCE,
    as_of: SM_READ_ON,
  },
];

/** Mois de la liste Bank of England inventée. Aucune vraie liste n'a été publiée pour ce mois-là. */
export const PRA_LIST_MONTH = '2026-01';

interface PraRow {
  frn: string;
  firm_name: string;
  lei: string;
  section: 'uk_incorporated' | 'non_uk_branch' | 'gibraltar_branch';
  lei_basis: 'lei' | 'head_office_lei';
}

const PRA_ROWS: PraRow[] = [
  {
    frn: '900001',
    firm_name: 'Example Bank Alpha plc',
    lei: 'XMPLGB000000000P0159',
    section: 'uk_incorporated',
    lei_basis: 'lei',
  },
  {
    // Une succursale britannique listée sous le LEI de sa maison mère, comme le fait la section des succursales.
    frn: '900002',
    firm_name: 'Beispielbank Beta AG, London Branch',
    lei: 'XMPLDE000000000P0235',
    section: 'non_uk_branch',
    lei_basis: 'head_office_lei',
  },
  {
    frn: '900003',
    firm_name: 'Example Bank Gamma (Gibraltar) Limited',
    lei: 'XMPLGI000000000P0329',
    section: 'gibraltar_branch',
    lei_basis: 'lei',
  },
];

/**
 * Les lignes d'annuaire BIC dont les données inventées ont besoin pour être
 * atteintes de bout en bout : la banque britannique que nomme la liste PRA (pour
 * qu'un IBAN GB se résolve en un BIC portant son LEI), et une ligne de type
 * GLEIF pour la banque autrichienne (pour distinguer le LEI du registre de celui
 * de l'annuaire).
 */
const DIRECTORY_ROWS = [
  {
    bic8: 'XMPLGB2L',
    bic11: 'XMPLGB2LXXX',
    institution: 'EXAMPLE BANK ALPHA PLC',
    country_code: 'GB',
    country_name: 'United Kingdom',
    city: 'London',
    lei: 'XMPLGB000000000P0159',
  },
  {
    bic8: 'XMPLATW1',
    bic11: 'XMPLATW1XXX',
    institution: 'BEISPIELBANK ALPHA AG',
    country_code: 'AT',
    country_name: 'Austria',
    city: 'Wien',
    lei: 'XMPLAT000000000G0143',
  },
];

/** Inscriptions EPC inventées, indexées sur le BIC8 des banques inventées. */
const SEPA_ROWS: Array<[bic8: string, scheme: 'SCT' | 'SDD' | 'SCT_INST']> = [
  ['XMPLATW1', 'SCT'],
  ['XMPLATW1', 'SDD'],
  ['XMPLATW1', 'SCT_INST'],
  ['XMPLATW2', 'SCT'],
  ['XMPLATW2', 'SCT_INST'],
  ['XMPLBEB1', 'SCT'],
];

/** Inscriptions VoP inventées : une prête, une en attente, et XMPLATW2 absente. */
const VOP_ROWS: Array<[bic8: string, status: 'active' | 'pending']> = [
  ['XMPLATW1', 'active'],
  ['XMPLBEB1', 'pending'],
];

/**
 * Inscriptions ONU inventées. `ZZUNIRTH` n'est que sur la liste de l'ONU ;
 * `ZZUNKPPY` y est aussi et sur la liste OFAC, comme toutes les vraies lignes
 * ONU aujourd'hui.
 */
const UN_ROWS: Array<[bic8: string, country: string]> = [
  ['ZZUNIRTH', 'IR'],
  ['ZZUNKPPY', 'KP'],
];
const EXTRA_OFAC_ROWS: Array<[bic8: string, country: string]> = [['ZZUNKPPY', 'KP']];

/** Ce que les tests peuvent nommer, pour qu'aucun ne retape un code ou une clé. */
export const FIXTURE = {
  AT: {
    bank: AT_ROWS[0]!,
    member: AT_ROWS[1]!,
    central: AT_ROWS[2]!,
    padded: AT_ROWS[3]!,
    /** Un code autrichien qu'aucune ligne inventée ne porte : le registre le refuse. */
    unallocatedCode: '19989',
    iban: (code: string, account = '00012345678'): string => ibanFor('AT', `${code}${account}`),
  },
  BE: {
    bank: BE_ROWS[0]!,
    emi: BE_ROWS[1]!,
    noBic: BE_ROWS[2]!,
    unallocatedCode: '999',
    iban: (code: string, account7 = '1234567'): string =>
      ibanFor('BE', belgianBban(code, account7)),
  },
  SM: {
    bank: SM_ROWS[0]!,
    /** Un ABI inventé que la page inventée ne liste pas non plus. */
    unlistedCode: '09999',
    iban: (code: string, cin = 'U'): string => ibanFor('SM', `${cin}${code}09800000000270100`),
  },
  PRA: {
    month: PRA_LIST_MONTH,
    ukIncorporated: PRA_ROWS[0]!,
    nonUkBranch: PRA_ROWS[1]!,
    gibraltar: PRA_ROWS[2]!,
    /** Un IBAN GB dont le code banque se résout en XMPLGB2L, la ligne d'annuaire qui porte le LEI de la firme britannique. */
    gbIban: ibanFor('GB', 'XMPL20000012345678'),
  },
  directory: {
    gb: DIRECTORY_ROWS[0]!,
    at: DIRECTORY_ROWS[1]!,
  },
  EPC: { sepa: SEPA_ROWS, vop: VOP_ROWS },
  UN: {
    /** Sur la seule liste ONU inventée. */
    onlyUn: 'ZZUNIRTH',
    /** Sur la liste ONU inventée et sur une ligne OFAC inventée. */
    unAndOfac: 'ZZUNKPPY',
  },
} as const;

// ---------------------------------------------------------------------------
// L'installation
// ---------------------------------------------------------------------------

export interface RestrictedFixtureOptions {
  /**
   * Jeux à laisser de côté au lieu de les remplacer, pour les tests qui prouvent
   * que l'API dit « non consulté » quand l'un manque. `empty` garde la table
   * sans lignes ; `absent` la supprime.
   *
   * AT, BE et SM partagent `national_bank_codes` avec le registre slovaque, qui
   * est public : pour eux `absent` ne peut pas supprimer la table, il retire les
   * lignes du pays, ce qui est la forme qu'auront ces pays dans la base publique.
   */
  missing?: { datasets: readonly RestrictedDataset[]; as: 'empty' | 'absent' };
}

export interface RestrictedFixture {
  /** Le dossier qui contient les deux copies. */
  dir: string;
  bicPath: string;
  compliancePath: string;
  /** Les jeux qui portent des lignes inventées dans cette installation. */
  installed: readonly RestrictedDataset[];
  /**
   * Ferme les connexions ouvertes par ce fichier, rend les chemins précédents et
   * supprime les copies. Fermer d'abord : une connexion laissée ouverte sur un
   * fichier supprimé, c'est ainsi qu'une suite suivante hériterait de cette base.
   */
  restore(): Promise<void>;
}

function openDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path);
}

function tableExists(db: DatabaseType.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** Même définition que dans scripts/seed-national.ts. */
const NATIONAL_DDL = `
  CREATE TABLE IF NOT EXISTS national_bank_codes (
    country   TEXT NOT NULL,
    code      TEXT NOT NULL,
    name      TEXT NOT NULL,
    bic       TEXT,
    street    TEXT,
    post_code TEXT,
    town      TEXT,
    lei       TEXT,
    source    TEXT,
    as_of     TEXT,
    PRIMARY KEY (country, code)
  )`;

/** Même définition que createPraBanksTable() dans scripts/seed-pra-banks.ts. */
const PRA_DDL = `
  CREATE TABLE IF NOT EXISTS pra_banks (
    frn        TEXT NOT NULL,
    firm_name  TEXT NOT NULL,
    lei        TEXT,
    section    TEXT NOT NULL,
    lei_basis  TEXT NOT NULL,
    list_month TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'Bank of England',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (frn, section)
  )`;

/** Même définition que createSchema() dans scripts/refresh-compliance.ts. */
const COMPLIANCE_DDL: Record<
  'sanctioned_entities' | 'sepa_participants' | 'vop_participants',
  string
> = {
  sanctioned_entities: `
      CREATE TABLE IF NOT EXISTS sanctioned_entities (
        bic8        TEXT NOT NULL,
        entity_name TEXT,
        source_list TEXT NOT NULL,
        country_code TEXT,
        directory_match INTEGER NOT NULL DEFAULT 1,
        UNIQUE(bic8, source_list)
      )`,
  sepa_participants: `
      CREATE TABLE IF NOT EXISTS sepa_participants (
        bic8   TEXT NOT NULL,
        scheme TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        PRIMARY KEY (bic8, scheme)
      )`,
  vop_participants: `
      CREATE TABLE IF NOT EXISTS vop_participants (
        bic8   TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active'
      )`,
};

function writeBicCopy(
  path: string,
  install: ReadonlySet<RestrictedDataset>,
  missing: RestrictedFixtureOptions['missing'],
): void {
  const db = openDb(path);
  try {
    db.exec(NATIONAL_DDL);
    // Les vraies lignes partent d'abord, quoi qu'il arrive ensuite.
    db.prepare("DELETE FROM national_bank_codes WHERE country IN ('AT', 'BE', 'SM')").run();
    const insertNational = db.prepare(
      `INSERT INTO national_bank_codes
         (country, code, name, bic, street, post_code, town, lei, source, as_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const registers: Array<[RestrictedDataset, NationalRow[]]> = [
      ['AT', AT_ROWS],
      ['BE', BE_ROWS],
      ['SM', SM_ROWS],
    ];
    for (const [cc, rows] of registers) {
      if (!install.has(cc)) continue;
      for (const r of rows) {
        insertNational.run(
          cc,
          r.code,
          r.name,
          r.bic,
          r.street,
          r.post_code,
          r.town,
          r.lei,
          r.source,
          r.as_of,
        );
      }
    }

    if (tableExists(db, 'pra_banks')) db.prepare('DELETE FROM pra_banks').run();
    if (missing?.as === 'absent' && missing.datasets.includes('PRA')) {
      db.exec('DROP TABLE IF EXISTS pra_banks');
    } else {
      db.exec(PRA_DDL);
      db.exec('CREATE INDEX IF NOT EXISTS idx_pra_banks_lei ON pra_banks(lei)');
    }
    if (install.has('PRA')) {
      const insertPra = db.prepare(
        `INSERT INTO pra_banks (frn, firm_name, lei, section, lei_basis, list_month)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of PRA_ROWS) {
        insertPra.run(r.frn, r.firm_name, r.lei, r.section, r.lei_basis, PRA_LIST_MONTH);
      }
    }

    const insertDirectory = db.prepare(
      `INSERT OR REPLACE INTO bic_entries
         (bic8, bic11, institution, country_code, country_name, city, branch_code, lei,
          lei_status, is_test_bic, source)
       VALUES (?, ?, ?, ?, ?, ?, 'XXX', ?, 'ISSUED', 0, 'gleif')`,
    );
    for (const r of DIRECTORY_ROWS) {
      insertDirectory.run(
        r.bic8,
        r.bic11,
        r.institution,
        r.country_code,
        r.country_name,
        r.city,
        r.lei,
      );
    }
  } finally {
    db.close();
  }
}

function writeComplianceCopy(
  path: string,
  install: ReadonlySet<RestrictedDataset>,
  missing: RestrictedFixtureOptions['missing'],
): void {
  const db = openDb(path);
  try {
    const absent = (d: RestrictedDataset) =>
      missing?.as === 'absent' && missing.datasets.includes(d);

    // EPC : les deux registres, un seul jeu.
    for (const table of ['sepa_participants', 'vop_participants'] as const) {
      if (tableExists(db, table)) db.prepare(`DELETE FROM ${table}`).run();
      if (absent('EPC')) db.exec(`DROP TABLE IF EXISTS ${table}`);
      else db.exec(COMPLIANCE_DDL[table]);
    }
    if (install.has('EPC')) {
      const insertSepa = db.prepare(
        "INSERT INTO sepa_participants (bic8, scheme, status) VALUES (?, ?, 'active')",
      );
      for (const [bic8, scheme] of SEPA_ROWS) insertSepa.run(bic8, scheme);
      const insertVop = db.prepare('INSERT INTO vop_participants (bic8, status) VALUES (?, ?)');
      for (const [bic8, status] of VOP_ROWS) insertVop.run(bic8, status);
    }

    // La liste de l'ONU partage sa table avec les listes publiques : elle ne peut
    // qu'être vidée, jamais supprimée seule.
    db.exec(COMPLIANCE_DDL.sanctioned_entities);
    db.prepare("DELETE FROM sanctioned_entities WHERE source_list = 'UN'").run();
    if (install.has('UN')) {
      const insertEntity = db.prepare(
        `INSERT OR REPLACE INTO sanctioned_entities
           (bic8, entity_name, source_list, country_code, directory_match)
         VALUES (?, 'Invented listing (test fixture)', ?, ?, 0)`,
      );
      for (const [bic8, cc] of UN_ROWS) insertEntity.run(bic8, 'UN', cc);
      for (const [bic8, cc] of EXTRA_OFAC_ROWS) insertEntity.run(bic8, 'OFAC', cc);
    }
  } finally {
    db.close();
  }
}

/**
 * Copie les bases, remplace les six jeux sous licence restrictive par des lignes
 * inventées, et fait pointer BIC_DB_PATH et COMPLIANCE_DB_PATH sur les copies.
 *
 * Copie la base que le processus ouvrirait sinon (le chemin de l'environnement
 * s'il y en a un, data/ sinon) : lancer la suite sur une base allégée mesure
 * donc exactement ce qu'il faut. La copie est un clone sur APFS, une copie
 * ordinaire ailleurs.
 */
export function installRestrictedFixture(
  options: RestrictedFixtureOptions = {},
): RestrictedFixture {
  const leftOut = new Set(options.missing?.datasets ?? []);
  const installed = RESTRICTED_DATASETS.filter((d) => !leftOut.has(d));
  const install = new Set(installed);

  const sourceBic = process.env.BIC_DB_PATH ?? resolve(HERE, '../../data/bic.sqlite');
  const sourceCompliance =
    process.env.COMPLIANCE_DB_PATH ?? resolve(HERE, '../../data/compliance.sqlite');

  const dir = mkdtempSync(join(tmpdir(), 'ibf-restricted-'));
  const bicPath = join(dir, 'bic.sqlite');
  const compliancePath = join(dir, 'compliance.sqlite');
  copyFileSync(sourceBic, bicPath, constants.COPYFILE_FICLONE);
  copyFileSync(sourceCompliance, compliancePath, constants.COPYFILE_FICLONE);

  writeBicCopy(bicPath, install, options.missing);
  writeComplianceCopy(compliancePath, install, options.missing);

  const previous = {
    bic: process.env.BIC_DB_PATH,
    compliance: process.env.COMPLIANCE_DB_PATH,
  };
  process.env.BIC_DB_PATH = bicPath;
  process.env.COMPLIANCE_DB_PATH = compliancePath;

  return {
    dir,
    bicPath,
    compliancePath,
    installed,
    async restore(): Promise<void> {
      const { closeAll } = await import('../lib/db.js');
      closeAll();
      if (previous.bic === undefined) delete process.env.BIC_DB_PATH;
      else process.env.BIC_DB_PATH = previous.bic;
      if (previous.compliance === undefined) delete process.env.COMPLIANCE_DB_PATH;
      else process.env.COMPLIANCE_DB_PATH = previous.compliance;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
