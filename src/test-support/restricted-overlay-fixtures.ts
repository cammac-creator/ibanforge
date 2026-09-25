/**
 * Une famille « sous conditions » entièrement inventée ET assez grande pour
 * passer les planchers du chargeur de surcouche.
 *
 * `restricted-fixtures.ts` (PR 249) remplace les vrais registres AT, BE, SM, la
 * liste PRA, les registres EPC et la liste ONU par une poignée de lignes
 * inventées : assez pour éprouver chaque chemin de l'API, pas assez pour une
 * surcouche, dont chaque membre refuse de descendre sous son plancher (700 codes
 * autrichiens, 3 000 inscriptions SEPA…, src/lib/restricted-family.ts). Ce
 * fichier complète la même copie :
 *
 * - il RETIRE les vraies lignes EBA STEP2, NBP et OeNB de `bic_entries`, que
 *   `restricted-fixtures.ts` ne touche pas, et les remplace par des BIC inventés ;
 * - il ajoute des lignes de remplissage, inventées elles aussi, jusqu'aux
 *   planchers ;
 * - il accroche une ligne EBA STEP2 inventée sous le BIC8 d'une ligne publique
 *   inventée (`XMPLATW1`), pour que l'ordre des lignes d'un même BIC8, public
 *   puis famille, soit éprouvé.
 *
 * Aucune valeur ici ne vient d'une vraie source : préfixes `XMP…`, codes hors
 * des codes nommés par `FIXTURE`, noms « Remplissage ». Sans import de vitest
 * (voir l'en-tête de restricted-fixtures.ts), exclu de la construction.
 */
import { createRequire } from 'node:module';
import type DatabaseType from 'better-sqlite3';
import { RESTRICTED_FAMILY, RESTRICTED_TABLES } from '../lib/restricted-family.js';
import { FIXTURE } from './restricted-fixtures.js';

const require = createRequire(import.meta.url);

function openDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path);
}

function floorOf(id: string): number {
  const member = RESTRICTED_FAMILY.find((m) => m.id === id);
  if (!member) throw new Error(`Membre inconnu : ${id}`);
  return member.minRows;
}

/** Quatre caractères alphanumériques pour un compteur, en majuscules. */
function tag(n: number): string {
  return n.toString(36).toUpperCase().padStart(4, '0');
}

export interface InventedFamily {
  /** BIC11 inventés, un par source de `bic_entries` retirée du dépôt public. */
  eba: string[];
  nbp: string[];
  oenb: string[];
  /** Un BIC8 dont une ligne est publique et une autre vient d'EBA STEP2. */
  mixedBic8: string;
}

/**
 * Complète, EN PLACE, les copies installées par `installRestrictedFixture()`
 * jusqu'aux planchers de chaque membre. À n'appeler que sur ces copies.
 */
export function completeRestrictedFamily(bicPath: string, compliancePath: string): InventedFamily {
  const bic = openDb(bicPath);
  const family: InventedFamily = { eba: [], nbp: [], oenb: [], mixedBic8: 'XMPLATW1' };
  try {
    bic.transaction(() => {
      bic.prepare("DELETE FROM bic_entries WHERE source IN ('eba_step2', 'nbp', 'oenb')").run();
      const insert = bic.prepare(
        `INSERT INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, branch_code, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01 00:00:00')`,
      );
      // L'ordre d'insertion de la reconstruction mensuelle : OeNB, NBP, EBA STEP2.
      family.oenb.push('XMPOATW1XXX');
      insert.run(
        'XMPOATW1',
        'XMPOATW1XXX',
        'Remplissage OeNB',
        'AT',
        'Austria',
        'Wien',
        'XXX',
        'oenb',
      );
      for (let i = 0; i < floorOf('nbp') + 2; i++) {
        const bic8 = `XMPNPL${tag(i).slice(2)}`;
        family.nbp.push(`${bic8}XXX`);
        insert.run(
          bic8,
          `${bic8}XXX`,
          `Remplissage NBP ${i}`,
          'PL',
          'Poland',
          'Warszawa',
          'XXX',
          'nbp',
        );
      }
      for (let i = 0; i < floorOf('eba_step2') + 10; i++) {
        const bic8 = `XMPEFR${tag(i).slice(2)}`;
        family.eba.push(`${bic8}XXX`);
        insert.run(
          bic8,
          `${bic8}XXX`,
          `Remplissage EBA ${i}`,
          'FR',
          'France',
          '',
          'XXX',
          'eba_step2',
        );
      }
      // Sous un BIC8 dont la ligne de siège est publique (annuaire inventé de
      // restricted-fixtures.ts) : la recherche par BIC8 doit rendre la ligne
      // publique puis celle-ci, dans cet ordre, avant comme après la fusion.
      insert.run(
        FIXTURE.directory.at.bic8,
        `${FIXTURE.directory.at.bic8}EBA`,
        'BEISPIELBANK ALPHA AG, ZWEIGSTELLE',
        'AT',
        'Austria',
        '',
        'EBA',
        'eba_step2',
      );
      family.eba.push(`${FIXTURE.directory.at.bic8}EBA`);

      const national = bic.prepare(
        `INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of)
         VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      );
      const have = (cc: string): Set<string> =>
        new Set(
          (
            bic.prepare('SELECT code FROM national_bank_codes WHERE country = ?').all(cc) as Array<{
              code: string;
            }>
          ).map((r) => r.code),
        );
      const pad = (
        cc: string,
        floor: number,
        codes: Iterable<string>,
        source: string | null,
        asOf: string | null,
      ): void => {
        const existing = have(cc);
        let count = existing.size;
        for (const code of codes) {
          if (count >= floor + 5) break;
          if (existing.has(code)) continue;
          national.run(cc, code, `Remplissage ${cc} ${code}`, source, asOf);
          count++;
        }
      };
      // Autriche : 80000 à 80999, loin des codes nommés par FIXTURE (1998x, 00980).
      pad(
        'AT',
        floorOf('register_at'),
        Array.from({ length: 1000 }, (_, i) => String(80000 + i)),
        null,
        null,
      );
      // Belgique : trois chiffres, sans 99x (les codes nommés par FIXTURE, et 999 « non attribué »).
      pad(
        'BE',
        floorOf('register_be'),
        Array.from({ length: 990 }, (_, i) => String(i).padStart(3, '0')),
        null,
        null,
      );
      // Saint-Marin : 0999x sans 09999 (« non listé » pour FIXTURE).
      pad(
        'SM',
        floorOf('register_sm'),
        ['09992', '09993', '09994', '09995'],
        'Remplissage',
        '2026-01-15',
      );

      const pra = bic.prepare(
        `INSERT INTO pra_banks (frn, firm_name, lei, section, lei_basis, list_month, source)
         VALUES (?, ?, NULL, 'uk_incorporated', 'lei', ?, 'Bank of England')`,
      );
      const praCount = (bic.prepare('SELECT COUNT(*) AS n FROM pra_banks').get() as { n: number })
        .n;
      for (let i = praCount; i < floorOf('pra') + 5; i++)
        pra.run(`XMPF${tag(i)}`, `Remplissage PRA ${i}`, FIXTURE.PRA.month);

      // Les membres venus après la première surcouche (clés PL, FI, LU de la carte
      // composite, liste finlandaise) : tables créées depuis la constante, lignes
      // inventées jusqu'aux planchers. BIC `XMP…`, noms « Remplissage ».
      for (const spec of RESTRICTED_TABLES.bic.filter(
        (t) => t.name === 'curated_bank_codes' || t.name === 'fi_monetary_codes',
      )) {
        const exists = bic
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(spec.name);
        if (!exists) for (const sql of spec.ddl) bic.prepare(sql).run();
      }
      const curated = bic.prepare(
        `INSERT OR IGNORE INTO curated_bank_codes (country, code, bic, source, as_of)
         VALUES (?, ?, ?, 'Remplissage', '2026-01-01')`,
      );
      // Pologne : huit chiffres, 999xxxxx ; Finlande et Luxembourg : trois chiffres.
      for (let i = 0; i < floorOf('map_pl') + 5; i++)
        curated.run('PL', String(99900000 + i), `XMPPPL${tag(i % 1296).slice(2)}XXX`);
      for (let i = 0; i < floorOf('map_fi') + 5; i++)
        curated.run('FI', String(500 + i).padStart(3, '0'), 'XMPMFIH1');
      for (let i = 0; i < floorOf('map_lu') + 5; i++)
        curated.run('LU', String(800 + i).padStart(3, '0'), 'XMPMLULL');
      const fiList = bic.prepare(
        `INSERT OR IGNORE INTO fi_monetary_codes (code, bic, institution, source, as_of)
         VALUES (?, 'XMPRFIH1', ?, 'Remplissage', '2026-01-15')`,
      );
      for (let i = 0; i < floorOf('register_fi') + 5; i++)
        fiList.run(String(9000 + i), `Remplissage FI ${i}`);
    })();
  } finally {
    bic.close();
  }

  const compliance = openDb(compliancePath);
  try {
    compliance.transaction(() => {
      const sepa = compliance.prepare(
        "INSERT INTO sepa_participants (bic8, scheme, status) VALUES (?, 'SCT', 'active')",
      );
      const sepaCount = (
        compliance.prepare('SELECT COUNT(*) AS n FROM sepa_participants').get() as { n: number }
      ).n;
      for (let i = sepaCount; i < floorOf('epc_sepa') + 10; i++) sepa.run(`XMPS${tag(i)}`);
      const vop = compliance.prepare(
        "INSERT INTO vop_participants (bic8, status) VALUES (?, 'active')",
      );
      const vopCount = (
        compliance.prepare('SELECT COUNT(*) AS n FROM vop_participants').get() as { n: number }
      ).n;
      for (let i = vopCount; i < floorOf('epc_vop') + 10; i++) vop.run(`XMPV${tag(i)}`);
    })();
  } finally {
    compliance.close();
  }
  return family;
}
