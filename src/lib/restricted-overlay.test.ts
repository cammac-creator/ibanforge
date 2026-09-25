import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import {
  RESTRICTED_FAMILY,
  RESTRICTED_TABLES,
  membersOf,
  restrictedBicSources,
  restrictedRegisterCountries,
  seedFamilyFromEnv,
} from './restricted-family.js';
import {
  type MemberReport,
  buildMergedDatabase,
  extractOverlay,
  inspectOverlay,
  mergedPrefix,
  nextMergedPath,
  removeStaleMerged,
  sha256File,
  stripFamily,
} from './restricted-overlay.js';
import {
  FIXTURE,
  installRestrictedFixture,
  type RestrictedFixture,
} from '../test-support/restricted-fixtures.js';
import {
  completeRestrictedFamily,
  type InventedFamily,
} from '../test-support/restricted-overlay-fixtures.js';

/**
 * Les contrôles et la fusion de la surcouche privée, cas par cas, sur une
 * famille entièrement inventée. La preuve d'ensemble (base publique + surcouche =
 * base complète) est dans restricted-overlay-equivalence.test.ts.
 */

const require = createRequire(import.meta.url);

function openDb(path: string, readonly = false): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path, { readonly });
}

describe('la famille « sous conditions », une seule constante', () => {
  it('nomme chaque membre une fois, dans une table déclarée', () => {
    const ids = RESTRICTED_FAMILY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of RESTRICTED_FAMILY)
      expect(
        RESTRICTED_TABLES[m.kind].map((t) => t.name),
        m.id,
      ).toContain(m.table);
    expect(membersOf('bic').map((m) => m.id)).toEqual([
      'eba_step2',
      'nbp',
      'oenb',
      'register_at',
      'register_be',
      'register_sm',
      'pra',
    ]);
    expect(membersOf('compliance').map((m) => m.id)).toEqual(['un', 'epc_sepa', 'epc_vop']);
  });

  it('laisse la Slovaquie et la Tchéquie publiques', () => {
    expect([...restrictedRegisterCountries()].sort()).toEqual(['AT', 'BE', 'SM']);
    expect([...restrictedBicSources()].sort()).toEqual(['eba_step2', 'nbp', 'oenb']);
  });

  it('SEED_FAMILY : rien = tout, « restricted » = la famille, le reste est refusé', () => {
    const saved = process.env.SEED_FAMILY;
    try {
      delete process.env.SEED_FAMILY;
      expect(seedFamilyFromEnv()).toBe('all');
      process.env.SEED_FAMILY = 'restricted';
      expect(seedFamilyFromEnv()).toBe('restricted');
      process.env.SEED_FAMILY = 'restreint';
      expect(() => seedFamilyFromEnv()).toThrow(/SEED_FAMILY inconnu/);
    } finally {
      if (saved === undefined) delete process.env.SEED_FAMILY;
      else process.env.SEED_FAMILY = saved;
    }
  });
});

describe('surcouche : extraction, contrôle, fusion', () => {
  let fixture: RestrictedFixture;
  let family: InventedFamily;
  let dir: string;
  let overlay: { bic: string; compliance: string };
  let publicBase: { bic: string; compliance: string };
  let n = 0;
  /** Une copie neuve d'un fichier, dans le dossier de travail. */
  const copy = (source: string, name = `copie-${n++}.sqlite`): string => {
    const target = join(dir, name);
    copyFileSync(source, target);
    return target;
  };

  beforeAll(() => {
    fixture = installRestrictedFixture();
    family = completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    dir = join(fixture.dir, 'travail');
    mkdirSync(dir);
    overlay = {
      bic: extractOverlay({
        kind: 'bic',
        sourcePath: fixture.bicPath,
        outPath: join(dir, 'restricted-bic.sqlite'),
        generator: 'test',
      }).path,
      compliance: extractOverlay({
        kind: 'compliance',
        sourcePath: fixture.compliancePath,
        outPath: join(dir, 'restricted-compliance.sqlite'),
        generator: 'test',
      }).path,
    };
    publicBase = { bic: copy(fixture.bicPath), compliance: copy(fixture.compliancePath) };
    stripFamily(publicBase.bic, 'bic');
    stripFamily(publicBase.compliance, 'compliance');
  }, 120_000);

  afterAll(() => fixture.restore());

  it("l'extraction porte exactement la famille, avec ses métadonnées", () => {
    for (const kind of ['bic', 'compliance'] as const) {
      const report = inspectOverlay(overlay[kind], kind);
      expect(report.ok, kind).toBe(true);
      expect(
        report.members.every((m) => m.state === 'applied'),
        kind,
      ).toBe(true);
      expect(report.meta).toMatchObject({ schema: '2', kind, generator: 'test' });
      expect(report.meta?.source_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(report.sha256).toBe(sha256File(overlay[kind]));
    }
    // Les dates de la base lue, nommées pour ce qu'elles sont (R11).
    expect(inspectOverlay(overlay.compliance, 'compliance').meta?.source_last_refresh).toBeTruthy();
    expect(inspectOverlay(overlay.bic, 'bic').meta?.source_bic_entries_updated_at).toBeTruthy();
    expect(inspectOverlay(overlay.bic, 'bic').meta?.source_refresh).toBeUndefined();
    const db = openDb(overlay.bic, true);
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    const members = db
      .prepare('SELECT member, rows, loaded_at, as_of, label FROM overlay_members ORDER BY member')
      .all() as Array<{
      member: string;
      rows: number;
      loaded_at: string | null;
      as_of: string | null;
      label: string;
    }>;
    db.close();
    // Un registre national n'a pas de date de chargement : jamais celle d'une
    // autre table (R11). SM porte sa date de lecture en `as_of`.
    for (const id of ['register_at', 'register_be', 'register_sm'])
      expect(members.find((m) => m.member === id)?.loaded_at, id).toBeNull();
    expect(members.find((m) => m.member === 'register_sm')?.as_of).toBeTruthy();
    expect(members.find((m) => m.member === 'eba_step2')?.loaded_at).toBeTruthy();
    // Aucune table publique : ni l'annuaire suisse, ni les registres DE, BG, BCE.
    expect(tables).toEqual([
      'bic_entries',
      'national_bank_codes',
      'overlay_members',
      'overlay_meta',
      'pra_banks',
      'sqlite_sequence',
    ]);
    expect(members.map((m) => m.member).sort()).toEqual(
      membersOf('bic')
        .map((m) => m.id)
        .sort(),
    );
    expect(members.find((m) => m.member === 'pra')?.as_of).toBe(FIXTURE.PRA.month);
    expect(members.every((m) => m.label.length > 0)).toBe(true);
  });

  it("refuse d'extraire un membre sous son plancher", () => {
    expect(() =>
      extractOverlay({
        kind: 'bic',
        sourcePath: publicBase.bic,
        outPath: join(dir, 'vide.sqlite'),
        generator: 'test',
      }),
    ).toThrow(/plancher/);
    expect(existsSync(join(dir, 'vide.sqlite'))).toBe(false);
  });

  it('refuse une baisse de plus de 10 % sans autorisation explicite', () => {
    // La surcouche précédente portait 150 inscriptions VoP de plus : la nouvelle,
    // au-dessus de son plancher, en a perdu plus de 10 %.
    const out = join(dir, 'baisse.sqlite');
    const bigger = copy(fixture.compliancePath);
    const db = openDb(bigger);
    const insert = db.prepare("INSERT INTO vop_participants (bic8, status) VALUES (?, 'active')");
    for (let i = 0; i < 150; i++) insert.run(`XMPW${String(i).padStart(4, '0')}`);
    db.close();
    extractOverlay({ kind: 'compliance', sourcePath: bigger, outPath: out, generator: 'test' });
    expect(() =>
      extractOverlay({
        kind: 'compliance',
        sourcePath: fixture.compliancePath,
        outPath: out,
        generator: 'test',
      }),
    ).toThrow(/epc_vop.*baisse de plus de 10 %/);
    expect(
      extractOverlay({
        kind: 'compliance',
        sourcePath: fixture.compliancePath,
        outPath: out,
        generator: 'test',
        allowShrink: true,
      }).members.find((m) => m.id === 'epc_vop')?.rows,
    ).toBeLessThan(1150);
  });

  it('ne garde pas les petits membres par un pourcentage : leurs planchers suffisent', () => {
    // Une inscription ONU sur deux qui disparaît (50 %) est un mois ordinaire.
    const out = join(dir, 'petit.sqlite');
    extractOverlay({
      kind: 'compliance',
      sourcePath: fixture.compliancePath,
      outPath: out,
      generator: 'test',
    });
    const smaller = copy(fixture.compliancePath);
    const db = openDb(smaller);
    db.prepare("DELETE FROM sanctioned_entities WHERE bic8 = ? AND source_list = 'UN'").run(
      FIXTURE.UN.onlyUn,
    );
    db.close();
    expect(
      extractOverlay({
        kind: 'compliance',
        sourcePath: smaller,
        outPath: out,
        generator: 'test',
      }).members.find((m) => m.id === 'un')?.rows,
    ).toBe(1);
  });

  it('refuse le fichier entier quand il porte une ligne hors de la famille', () => {
    const tampered = copy(overlay.bic);
    const db = openDb(tampered);
    db.prepare(
      "INSERT INTO bic_entries (bic8, bic11, country_code, source) VALUES ('XMPGDEFF', 'XMPGDEFFXXX', 'DE', 'gleif')",
    ).run();
    db.close();
    const report = inspectOverlay(tampered, 'bic');
    expect(report.ok).toBe(false);
    expect(report.error).toBe('overlay_rows_outside_family:bic_entries');
  });

  it('refuse un membre au contenu altéré, et sert les autres', () => {
    const tampered = copy(overlay.compliance);
    const db = openDb(tampered);
    db.prepare("UPDATE vop_participants SET status = 'pending' WHERE bic8 = 'XMPLATW1'").run();
    db.close();
    const report = inspectOverlay(tampered, 'compliance');
    expect(report.ok).toBe(true);
    expect(report.members.map((m) => [m.id, m.state, m.reason])).toEqual([
      ['un', 'applied', undefined],
      ['epc_sepa', 'applied', undefined],
      ['epc_vop', 'refused', 'content_hash_mismatch'],
    ]);
    const merged = buildMergedDatabase({
      kind: 'compliance',
      publicPath: publicBase.compliance,
      overlayPath: tampered,
      outputPath: join(dir, 'partielle.sqlite'),
    });
    expect(merged.state).toBe('partial');
    const out = openDb(merged.path!, true);
    expect(
      (out.prepare('SELECT COUNT(*) AS n FROM vop_participants').get() as { n: number }).n,
    ).toBe(0);
    out.close();
  });

  it('refuse une autre base, un fichier illisible, une table inconnue', () => {
    expect(inspectOverlay(overlay.compliance, 'bic').error).toBe('overlay_wrong_kind');
    const garbage = join(dir, 'illisible.sqlite');
    writeFileSync(garbage, Buffer.alloc(8192, 7));
    expect(inspectOverlay(garbage, 'bic').ok).toBe(false);
    expect(inspectOverlay(join(dir, 'absente.sqlite'), 'bic').error).toBe('overlay_file_missing');
    const extra = copy(overlay.compliance);
    const db = openDb(extra);
    db.exec('CREATE TABLE ch_clearing (iid TEXT)');
    db.close();
    expect(inspectOverlay(extra, 'compliance').error).toBe('overlay_unknown_tables:ch_clearing');
  });

  it('un BIC11 déjà public garde la ligne publique, comme le seeder', () => {
    const pub = copy(publicBase.bic);
    const db = openDb(pub);
    db.prepare(
      "INSERT INTO bic_entries (bic8, bic11, institution, country_code, source) VALUES (?, ?, 'PUBLIQUE', 'FR', 'gleif')",
    ).run(family.eba[1].slice(0, 8), family.eba[1]);
    db.close();
    const merged = buildMergedDatabase({
      kind: 'bic',
      publicPath: pub,
      overlayPath: overlay.bic,
      outputPath: join(dir, 'conflit.sqlite'),
    });
    expect(merged.state).toBe('applied');
    const eba = merged.members.find((m) => m.id === 'eba_step2')!;
    expect(eba.inserted).toBe(eba.rows - 1);
    const out = openDb(merged.path!, true);
    expect(
      out.prepare('SELECT source, institution FROM bic_entries WHERE bic11 = ?').get(family.eba[1]),
    ).toEqual({ source: 'gleif', institution: 'PUBLIQUE' });
    out.close();
  });

  it('refuse un membre dont la table publique a un autre schéma', () => {
    const pub = copy(publicBase.compliance);
    const db = openDb(pub);
    db.exec('ALTER TABLE vop_participants ADD COLUMN extra TEXT');
    db.close();
    const merged = buildMergedDatabase({
      kind: 'compliance',
      publicPath: pub,
      overlayPath: overlay.compliance,
      outputPath: join(dir, 'schema.sqlite'),
    });
    expect(merged.state).toBe('partial');
    expect(merged.members.find((m) => m.id === 'epc_vop')?.reason).toBe(
      'schema_differs_from_public',
    );
  });

  describe('règle de fusion : la donnée la plus fraîche sert, membre par membre (R10)', () => {
    const merge = (
      kind: 'bic' | 'compliance',
      publicPath: string,
      overlayPath: string,
      name: string,
    ) => buildMergedDatabase({ kind, publicPath, overlayPath, outputPath: join(dir, name) });
    const decisions = (members: MemberReport[]) =>
      Object.fromEntries(members.map((m) => [m.id, `${m.state}:${m.decision ?? m.reason}`]));
    /** Une copie de la base complète, modifiée par `edit`. */
    const edited = (source: string, prefix: string, edit: (db: DatabaseType.Database) => void) => {
      const path = copy(source, `${prefix}-${n++}.sqlite`);
      const db = openDb(path);
      edit(db);
      db.close();
      return path;
    };

    it('(c) contenu identique au public : la surcouche sert', () => {
      const same = merge('bic', fixture.bicPath, overlay.bic, 'jumelle.sqlite');
      expect(same.state).toBe('applied');
      expect(same.members.every((m) => m.decision === 'identical')).toBe(true);
      expect(same.members.every((m) => m.identical_to_public === true)).toBe(true);
    });

    it("(d) public plus récent ou non daté : le public est gardé, et c'est lui qui est servi", () => {
      const newer = edited(fixture.bicPath, 'public-bic', (db) => {
        // AT : aucune date, contenu différent -> le public reste (personne ne date AT).
        db.prepare(
          "UPDATE national_bank_codes SET name = 'NOM PUBLIC PLUS RÉCENT' WHERE country = 'AT' AND code = ?",
        ).run(FIXTURE.AT.bank.code);
        // SM : nouvelle date de lecture.
        db.prepare(
          "UPDATE national_bank_codes SET as_of = '2099-01-01' WHERE country = 'SM'",
        ).run();
        // PRA : mois suivant.
        db.prepare("UPDATE pra_banks SET list_month = '2099-01'").run();
        // bic_entries : le passage mensuel a rechargé une ligne EBA STEP2.
        db.prepare(
          "UPDATE bic_entries SET institution = 'EBA PUBLIC', updated_at = '2099-01-01 00:00:00' WHERE bic11 = ?",
        ).run(family.eba[0]);
      });
      const result = merge('bic', newer, overlay.bic, 'public-plus-recent.sqlite');
      expect(decisions(result.members)).toEqual({
        eba_step2: 'kept_public:public_newer_or_undated',
        nbp: 'kept_public:public_newer_or_undated',
        oenb: 'kept_public:public_newer_or_undated',
        register_at: 'kept_public:public_newer_or_undated',
        register_be: 'applied:identical',
        register_sm: 'kept_public:public_newer_or_undated',
        pra: 'kept_public:public_newer_or_undated',
      });
      expect(result.state).toBe('kept_public');
      const out = openDb(result.path!, true);
      expect(
        out
          .prepare("SELECT name FROM national_bank_codes WHERE country = 'AT' AND code = ?")
          .get(FIXTURE.AT.bank.code),
      ).toEqual({ name: 'NOM PUBLIC PLUS RÉCENT' });
      expect(
        out.prepare('SELECT institution FROM bic_entries WHERE bic11 = ?').get(family.eba[0]),
      ).toEqual({ institution: 'EBA PUBLIC' });
      expect(out.prepare('SELECT DISTINCT list_month AS m FROM pra_banks').all()).toEqual([
        { m: '2099-01' },
      ]);
      out.close();
    });

    it('(b) surcouche strictement plus récente et différente : la surcouche sert', () => {
      const fresher = edited(fixture.bicPath, 'plus-frais', (db) => {
        db.prepare("UPDATE pra_banks SET list_month = '2099-02'").run();
        db.prepare(
          "UPDATE bic_entries SET institution = 'EBA PRIVE', updated_at = '2099-02-01 00:00:00' WHERE bic11 = ?",
        ).run(family.eba[0]);
      });
      const fresherOverlay = extractOverlay({
        kind: 'bic',
        sourcePath: fresher,
        outPath: join(dir, `restricted-plus-frais-${n++}.sqlite`),
        generator: 'test',
      }).path;
      const result = merge('bic', fixture.bicPath, fresherOverlay, 'surcouche-plus-recente.sqlite');
      expect(decisions(result.members)).toMatchObject({
        eba_step2: 'applied:overlay_newer',
        nbp: 'applied:overlay_newer',
        oenb: 'applied:overlay_newer',
        pra: 'applied:overlay_newer',
        register_at: 'applied:identical',
      });
      const out = openDb(result.path!, true);
      expect(
        out.prepare('SELECT institution FROM bic_entries WHERE bic11 = ?').get(family.eba[0]),
      ).toEqual({ institution: 'EBA PRIVE' });
      out.close();
    });

    it("conformité : last_refresh servi jamais plus frais qu'un membre servi en (a) ou (b)", () => {
      const olderRefresh = '2020-01-01T00:00:00.000Z';
      const older = edited(fixture.compliancePath, 'conf-ancienne', (db) => {
        db.prepare("UPDATE metadata SET value = ? WHERE key = 'last_refresh'").run(olderRefresh);
      });
      const olderOverlay = extractOverlay({
        kind: 'compliance',
        sourcePath: older,
        outPath: join(dir, `restricted-conf-ancienne-${n++}.sqlite`),
        generator: 'test',
      }).path;
      // Base publique de demain (sans la famille) : la surcouche ancienne sert (a),
      // et la date servie descend à la sienne.
      const result = merge(
        'compliance',
        publicBase.compliance,
        olderOverlay,
        'compliance-a.sqlite',
      );
      expect(result.state).toBe('applied');
      expect(result.lowered_last_refresh).toBe(olderRefresh);
      const out = openDb(result.path!, true);
      expect(out.prepare("SELECT value FROM metadata WHERE key = 'last_refresh'").get()).toEqual({
        value: olderRefresh,
      });
      out.close();
      // Base publique encore complète, identique : (c), la date publique reste.
      const twin = merge('compliance', fixture.compliancePath, olderOverlay, 'compliance-c.sqlite');
      expect(twin.members.every((m) => m.decision === 'identical')).toBe(true);
      expect(twin.lowered_last_refresh).toBeUndefined();
    });

    it('bic_entries : un membre refusé laisse les trois au public, jamais la moitié', () => {
      const tampered = copy(overlay.bic);
      const db = openDb(tampered);
      db.prepare("UPDATE bic_entries SET institution = 'ALTÉRÉ' WHERE bic11 = ?").run(
        family.nbp[0],
      );
      db.close();
      const result = merge('bic', fixture.bicPath, tampered, 'groupe.sqlite');
      expect(result.state).toBe('partial');
      expect(decisions(result.members)).toMatchObject({
        nbp: 'refused:content_hash_mismatch',
        eba_step2: 'refused:group_member_refused:nbp',
        oenb: 'refused:group_member_refused:nbp',
      });
    });

    it('rien de la surcouche à servir : la base publique est servie telle quelle, sans copie', () => {
      const newer = edited(fixture.compliancePath, 'conf-recente', (db) => {
        db.prepare(
          "UPDATE metadata SET value = '2099-01-01T00:00:00.000Z' WHERE key = 'last_refresh'",
        ).run();
        db.prepare("UPDATE vop_participants SET status = 'pending' WHERE bic8 = 'XMPLATW1'").run();
        db.prepare("DELETE FROM sepa_participants WHERE bic8 = 'XMPLBEB1'").run();
        db.prepare("DELETE FROM sanctioned_entities WHERE bic8 = ? AND source_list = 'UN'").run(
          FIXTURE.UN.onlyUn,
        );
      });
      const result = merge('compliance', newer, overlay.compliance, 'rien.sqlite');
      expect(result.state).toBe('kept_public');
      expect(result.path).toBeUndefined();
      expect(readdirSync(dir).filter((f) => f.startsWith('rien.sqlite'))).toEqual([]);
    });
  });

  it('ne fait jamais exécuter le SQL de la surcouche (R4)', () => {
    // Un fichier forgé : une seconde instruction cachée derrière la définition de
    // vop_participants, que SQLite ignore au chargement du schéma.
    const forged = copy(overlay.compliance);
    const db = openDb(forged);
    const sql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vop_participants'").get() as {
        sql: string;
      }
    ).sql;
    // better-sqlite3 refuse d'écrire le schéma hors du mode non sûr : c'est le
    // geste d'un faussaire, pas d'une corruption ordinaire.
    db.unsafeMode(true);
    db.pragma('writable_schema = ON');
    db.prepare("UPDATE sqlite_master SET sql = ? WHERE name = 'vop_participants'").run(
      `${sql}; DELETE FROM main.sanctioned_entities WHERE source_list = 'OFAC'`,
    );
    db.pragma('writable_schema = OFF');
    db.close();
    const noTables = copy(publicBase.compliance);
    stripFamily(noTables, 'compliance', { dropTables: true });
    const ofacBefore = (() => {
      const d = openDb(noTables, true);
      const n = (
        d
          .prepare("SELECT COUNT(*) AS n FROM sanctioned_entities WHERE source_list = 'OFAC'")
          .get() as {
          n: number;
        }
      ).n;
      d.close();
      return n;
    })();
    expect(ofacBefore).toBeGreaterThan(0);
    const result = buildMergedDatabase({
      kind: 'compliance',
      publicPath: noTables,
      overlayPath: forged,
      outputPath: join(dir, 'forge.sqlite'),
    });
    const out = openDb(result.path!, true);
    expect(
      (
        out
          .prepare("SELECT COUNT(*) AS n FROM sanctioned_entities WHERE source_list = 'OFAC'")
          .get() as {
          n: number;
        }
      ).n,
    ).toBe(ofacBefore);
    // La table recréée l'a été depuis la constante, pas depuis le texte forgé.
    expect(
      (
        out.prepare("SELECT sql FROM sqlite_master WHERE name = 'vop_participants'").get() as {
          sql: string;
        }
      ).sql,
    ).not.toContain('DELETE');
    out.close();

    // Une vue ou un déclencheur dans le fichier le fait refuser.
    const withView = copy(overlay.compliance);
    const v = openDb(withView);
    v.exec('CREATE VIEW v AS SELECT 1');
    v.close();
    expect(inspectOverlay(withView, 'compliance').error).toBe('overlay_unexpected_objects');
  });

  it('les définitions de la constante sont celles des bases livrées', () => {
    for (const [kind, source] of [
      ['bic', fixture.bicPath],
      ['compliance', fixture.compliancePath],
    ] as const) {
      const scratch = join(dir, `ddl-${kind}.sqlite`);
      const d = openDb(scratch);
      for (const spec of RESTRICTED_TABLES[kind]) for (const sql of spec.ddl) d.prepare(sql).run();
      d.close();
      const shape = (path: string, table: string) => {
        const x = openDb(path, true);
        const columns = x.prepare(`PRAGMA table_info("${table}")`).all();
        // Chaque index (clés et contraintes comprises) : son unicité et ses colonnes.
        const indexes = (
          x.prepare(`PRAGMA index_list("${table}")`).all() as Array<{
            name: string;
            unique: number;
            origin: string;
          }>
        )
          .map((i) => ({
            unique: i.unique,
            origin: i.origin,
            columns: (
              x.prepare(`PRAGMA index_info("${i.name}")`).all() as Array<{ name: string }>
            ).map((c) => c.name),
            named: i.origin === 'c' ? i.name : null,
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        x.close();
        return { columns, indexes };
      };
      for (const spec of RESTRICTED_TABLES[kind])
        expect(shape(scratch, spec.name), `${kind}.${spec.name}`).toEqual(shape(source, spec.name));
    }
  });

  it('ne modifie jamais la base publique ni la surcouche, et ne laisse rien derrière un refus', () => {
    const before = [sha256File(publicBase.compliance), sha256File(overlay.compliance)];
    buildMergedDatabase({
      kind: 'compliance',
      publicPath: publicBase.compliance,
      overlayPath: overlay.compliance,
      outputPath: join(dir, 'lecture-seule.sqlite'),
    });
    expect([sha256File(publicBase.compliance), sha256File(overlay.compliance)]).toEqual(before);

    const garbage = join(dir, 'refus.sqlite');
    writeFileSync(garbage, Buffer.from('rien'));
    const refused = buildMergedDatabase({
      kind: 'compliance',
      publicPath: publicBase.compliance,
      overlayPath: garbage,
      outputPath: join(dir, 'jamais.sqlite'),
    });
    expect(refused.state).toBe('refused');
    expect(readdirSync(dir).filter((f) => f.startsWith('jamais.sqlite'))).toEqual([]);
  });

  it('une surcouche en WAL refusée ne laisse aucun compagnon derrière elle (R6)', () => {
    const wal = copy(overlay.compliance);
    const db = openDb(wal);
    db.pragma('journal_mode = WAL');
    db.prepare("UPDATE overlay_meta SET value = '99' WHERE key = 'schema'").run();
    db.close();
    const result = buildMergedDatabase({
      kind: 'compliance',
      publicPath: publicBase.compliance,
      overlayPath: wal,
      outputPath: join(dir, 'wal-refus.sqlite'),
    });
    expect(result.error).toBe('overlay_schema_version');
    expect(readdirSync(dir).filter((f) => f.startsWith('wal-refus.sqlite'))).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    'un échec de copie dit sa cause, jamais « fichier absent » (R7)',
    () => {
      const locked = join(dir, 'verrouille');
      mkdirSync(locked);
      chmodSync(locked, 0o555);
      try {
        const result = buildMergedDatabase({
          kind: 'compliance',
          publicPath: publicBase.compliance,
          overlayPath: overlay.compliance,
          outputPath: join(locked, 'x.sqlite'),
        });
        expect(result.state).toBe('refused');
        expect(result.error).toBe('overlay_copy_failed:EACCES');
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it('efface les fichiers fusionnés périmés, jamais celui qui est servi', () => {
    const base = join(dir, 'restricted-bic.sqlite');
    const kept = nextMergedPath(base);
    const stale = nextMergedPath(base);
    for (const f of [kept, stale, `${stale}.tmp-x`, `${kept}-journal`]) writeFileSync(f, '');
    const removed = removeStaleMerged(base, new Set([kept]));
    expect(removed.sort()).toEqual([stale, `${stale}.tmp-x`].sort());
    const left = readdirSync(dir).filter((f) => f.startsWith(mergedPrefix(base)));
    expect(left.sort()).toEqual(
      [kept, `${kept}-journal`].map((f) => f.slice(dir.length + 1)).sort(),
    );
  });
});
