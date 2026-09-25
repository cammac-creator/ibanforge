import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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
      expect(report.meta).toMatchObject({ schema: '1', kind, generator: 'test' });
      expect(report.meta?.source_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(report.meta?.source_refresh).toBeTruthy();
      expect(report.sha256).toBe(sha256File(overlay[kind]));
    }
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
      .all() as Array<{ member: string; rows: number; as_of: string | null; label: string }>;
    db.close();
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

  it('remplace les lignes que la base publique porte encore, et dit si elles étaient identiques', () => {
    const same = buildMergedDatabase({
      kind: 'bic',
      publicPath: fixture.bicPath,
      overlayPath: overlay.bic,
      outputPath: join(dir, 'jumelle.sqlite'),
    });
    expect(same.members.every((m) => m.identical_to_public === true)).toBe(true);

    const older = copy(fixture.bicPath);
    const db = openDb(older);
    db.prepare(
      "UPDATE national_bank_codes SET name = 'ANCIEN NOM' WHERE country = 'AT' AND code = ?",
    ).run(FIXTURE.AT.bank.code);
    db.close();
    const merged = buildMergedDatabase({
      kind: 'bic',
      publicPath: older,
      overlayPath: overlay.bic,
      outputPath: join(dir, 'remplacee.sqlite'),
    });
    expect(merged.members.find((m) => m.id === 'register_at')?.identical_to_public).toBe(false);
    expect(merged.members.find((m) => m.id === 'register_be')?.identical_to_public).toBe(true);
    const out = openDb(merged.path!, true);
    // La surcouche fait foi pour sa famille.
    expect(
      (
        out
          .prepare("SELECT name FROM national_bank_codes WHERE country = 'AT' AND code = ?")
          .get(FIXTURE.AT.bank.code) as { name: string }
      ).name,
    ).toBe(FIXTURE.AT.bank.name);
    out.close();
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
