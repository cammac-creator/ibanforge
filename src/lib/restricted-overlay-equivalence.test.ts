import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { constants, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type DatabaseType from 'better-sqlite3';
import { Hono } from 'hono';
import { OVERLAY_ENV, RESTRICTED_TABLES, membersOf } from './restricted-family.js';
import { extractOverlay, stripFamily } from './restricted-overlay.js';
import {
  FIXTURE,
  belgianBban,
  ibanFor,
  installRestrictedFixture,
  type RestrictedFixture,
} from '../test-support/restricted-fixtures.js';
import { completeRestrictedFamily } from '../test-support/restricted-overlay-fixtures.js';

/**
 * La preuve centrale de l'étape 3 : base publique + surcouche = base complète.
 *
 * ## Ce qui est comparé
 *
 * On part d'une base « complète » (public + famille sous conditions). On en
 * extrait la surcouche privée, on en retire la famille (la base publique de
 * demain, tables EPC SUPPRIMÉES côté conformité), puis on laisse l'API la
 * fusionner comme en production, par les variables. Les mêmes requêtes
 * (validation, conformité par IBAN et par BIC, recherche BIC, lot, démo) sont
 * posées aux deux montages, chacun dans un graphe de modules neuf (les chemins
 * des bases sont lus une fois, à l'import) ; les réponses doivent être
 * IDENTIQUES, une fois retirés `processing_ms` et `served_at`. Les tables aussi,
 * ligne pour ligne, et l'ordre des lignes d'un même BIC8.
 *
 * ## Deux modes
 *
 * - Par défaut (CI, dépôt public) : la famille est ENTIÈREMENT inventée
 *   (restricted-fixtures.ts, complété jusqu'aux planchers par
 *   restricted-overlay-fixtures.ts). Aucune vraie ligne sous conditions.
 * - `OVERLAY_EQUIVALENCE_REAL=1`, en local seulement : la même comparaison sur
 *   les bases livrées, cas choisis dans les données au moment du test (aucun
 *   code réel écrit ici). Le résultat se rapporte en comptes, jamais en lignes.
 */

const REAL = process.env.OVERLAY_EQUIVALENCE_REAL === '1';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV = { 'X-Dev-Skip': 'true' };

function openDb(path: string, readonly = true): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path, { readonly });
}

/** Retire récursivement ce qui change d'un appel à l'autre. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'processing_ms' || k === 'served_at') continue;
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

interface Cases {
  ibans: string[];
  bics: string[];
}

/** Les cas, choisis dans la base complète : la famille d'abord, puis des exemples publics. */
function pickCases(fullBic: string, fullCompliance: string): Cases {
  const bic = openDb(fullBic);
  const compliance = openDb(fullCompliance);
  try {
    const codes = (cc: string, n: number): string[] =>
      (
        bic
          .prepare(
            `SELECT code FROM national_bank_codes WHERE country = ?
             ORDER BY bic IS NULL, code LIMIT ?`,
          )
          .all(cc, n) as Array<{ code: string }>
      ).map((r) => r.code);
    const at = codes('AT', 6).map((c) => ibanFor('AT', `${c}00012345678`));
    const be = codes('BE', 5).map((c) => ibanFor('BE', belgianBban(c, '1234567')));
    const sm = codes('SM', 4).map((c) => FIXTURE.SM.iban(c));
    const ibans = [
      ...at,
      ...be,
      ...sm,
      // Banques publiques de bout en bout, dont des banques SEPA inscrites à l'EPC.
      'DE89370400440532013000',
      'FR1420041010050500013M02606',
      'NL91ABNA0417164300',
      'ES9121000418450200051332',
      'IT60X0542811101000000123456',
      'CH9300762011623852957',
      'GB29NWBK60161331926819',
      'LT121000011101001000',
      'PL61109010140000071219812874',
      'BY13NBRB3600900000002Z00AB00',
    ];
    if (!REAL) {
      ibans.push(
        FIXTURE.AT.iban(FIXTURE.AT.unallocatedCode),
        FIXTURE.BE.iban(FIXTURE.BE.unallocatedCode),
        FIXTURE.SM.iban(FIXTURE.SM.unlistedCode),
        FIXTURE.PRA.gbIban,
      );
    }
    const family = membersOf('bic')
      .filter((m) => m.table === 'bic_entries' && m.where)
      .map((m) => m.where!.value);
    const placeholders = family.map(() => '?').join(', ');
    const bySource = (source: string, n: number): string[] =>
      (
        bic
          .prepare('SELECT bic11 FROM bic_entries WHERE source = ? ORDER BY id LIMIT ?')
          .all(source, n) as Array<{ bic11: string }>
      ).map((r) => r.bic11);
    const mixed = (
      bic
        .prepare(
          `SELECT bic8 FROM bic_entries GROUP BY bic8
           HAVING SUM(source IN (${placeholders})) > 0 AND SUM(source NOT IN (${placeholders})) > 0
           ORDER BY bic8 LIMIT 2`,
        )
        .all(...family, ...family) as Array<{ bic8: string }>
    ).map((r) => r.bic8);
    const praBics = (
      bic
        .prepare(
          `SELECT b.bic11 FROM bic_entries b JOIN pra_banks p ON p.lei = b.lei
           ORDER BY b.bic11 LIMIT 2`,
        )
        .all() as Array<{ bic11: string }>
    ).map((r) => r.bic11);
    const registerBics = (
      bic
        .prepare(
          `SELECT bic FROM national_bank_codes WHERE country IN ('AT', 'BE', 'SM') AND bic IS NOT NULL
           ORDER BY country, code LIMIT 3`,
        )
        .all() as Array<{ bic: string }>
    ).map((r) => r.bic);
    const unBics = (
      compliance
        .prepare(
          "SELECT DISTINCT bic8 FROM sanctioned_entities WHERE source_list = 'UN' ORDER BY bic8 LIMIT 3",
        )
        .all() as Array<{ bic8: string }>
    ).map((r) => r.bic8);
    const epcBics = (
      compliance
        .prepare(
          `SELECT s.bic8 FROM sepa_participants s JOIN vop_participants v ON v.bic8 = s.bic8
           GROUP BY s.bic8 ORDER BY s.bic8 LIMIT 2`,
        )
        .all() as Array<{ bic8: string }>
    ).map((r) => r.bic8);
    const bics = [
      ...bySource('eba_step2', 3),
      ...bySource('nbp', 2),
      ...bySource('oenb', 1),
      ...mixed,
      ...praBics,
      ...registerBics,
      ...unBics,
      ...epcBics,
      'DEUTDEFFXXX',
      'UBSWCHZH80A',
    ];
    return { ibans: [...new Set(ibans)], bics: [...new Set(bics)] };
  } finally {
    bic.close();
    compliance.close();
  }
}

async function loadGraph() {
  vi.resetModules();
  return {
    db: await import('./db.js'),
    runtime: await import('./restricted-overlay-runtime.js'),
    routes: [
      (await import('../routes/iban-validate.js')).ibanValidate,
      (await import('../routes/iban-compliance.js')).ibanCompliance,
      (await import('../routes/iban-batch.js')).ibanBatch,
      (await import('../routes/bic-lookup.js')).bicLookup,
      (await import('../routes/demo.js')).demo,
    ],
  };
}

async function collect(cases: Cases, routes: unknown[]): Promise<Map<string, unknown>> {
  const app = new Hono();
  // Chaque route a son propre type d'environnement Hono ; montées ensemble, sans plus.
  for (const r of routes) app.route('/', r as Hono);
  const out = new Map<string, unknown>();
  const post = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { ...DEV, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const call = async (key: string, path: string, init: RequestInit): Promise<void> => {
    const res = await app.request(path, init);
    out.set(key, { status: res.status, body: normalize(await res.json()) });
  };
  for (const iban of cases.ibans) {
    await call(`validate ${iban}`, '/v1/iban/validate', post({ iban }));
    await call(`compliance ${iban}`, '/v1/iban/compliance', post({ iban }));
  }
  for (const bic of cases.bics) {
    await call(`bic ${bic}`, `/v1/bic/${bic}`, { headers: DEV });
    await call(`compliance-bic ${bic}`, '/v1/iban/compliance', post({ bic }));
  }
  await call('batch', '/v1/iban/batch', post({ ibans: cases.ibans.slice(0, 100) }));
  await call('demo', '/v1/demo', { headers: DEV });
  return out;
}

function setEnv(values: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Le contenu d'une table, sans l'alias du rowid, dans l'ordre des lignes ou trié. */
function tableRows(path: string, table: string, ordered: boolean, alias?: string): string[] {
  const db = openDb(path);
  try {
    const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>)
      .map((c) => c.name)
      .filter((c) => c !== alias);
    const rows = db
      .prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" ORDER BY rowid`)
      .raw(true)
      .all() as unknown[][];
    const lines = rows.map((r) => JSON.stringify(r));
    return ordered ? lines : lines.sort();
  } finally {
    db.close();
  }
}

function tableNames(path: string): string[] {
  const db = openDb(path);
  try {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
  } finally {
    db.close();
  }
}

describe(`base publique + surcouche = base complète (${REAL ? 'VRAIES bases, local' : 'famille inventée'})`, () => {
  let fixture: RestrictedFixture | undefined;
  let dir: string;
  let full: { bic: string; compliance: string };
  let overlay: { bic: string; compliance: string };
  let publicBase: { bic: string; compliance: string };
  let cases: Cases;
  let before: Map<string, unknown>;
  let after: Map<string, unknown>;
  let merged: { bic: string; compliance: string };
  let states: string[];
  let twins: Array<[string, boolean | null | undefined]>;
  const saved = {
    BIC_DB_PATH: process.env.BIC_DB_PATH,
    COMPLIANCE_DB_PATH: process.env.COMPLIANCE_DB_PATH,
    [OVERLAY_ENV.bic]: process.env[OVERLAY_ENV.bic],
    [OVERLAY_ENV.compliance]: process.env[OVERLAY_ENV.compliance],
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ibf-overlay-eq-'));
    if (REAL) {
      full = { bic: join(dir, 'full-bic.sqlite'), compliance: join(dir, 'full-compliance.sqlite') };
      copyFileSync(join(ROOT, 'data/bic.sqlite'), full.bic, constants.COPYFILE_FICLONE);
      copyFileSync(
        join(ROOT, 'data/compliance.sqlite'),
        full.compliance,
        constants.COPYFILE_FICLONE,
      );
    } else {
      fixture = installRestrictedFixture();
      completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
      full = { bic: fixture.bicPath, compliance: fixture.compliancePath };
    }
    const overlayDir = join(dir, 'prive');
    mkdirSync(overlayDir);
    overlay = {
      bic: extractOverlay({
        kind: 'bic',
        sourcePath: full.bic,
        outPath: join(overlayDir, 'restricted-bic.sqlite'),
        generator: 'test',
      }).path,
      compliance: extractOverlay({
        kind: 'compliance',
        sourcePath: full.compliance,
        outPath: join(overlayDir, 'restricted-compliance.sqlite'),
        generator: 'test',
      }).path,
    };
    publicBase = {
      bic: join(dir, 'public-bic.sqlite'),
      compliance: join(dir, 'public-compliance.sqlite'),
    };
    copyFileSync(full.bic, publicBase.bic);
    copyFileSync(full.compliance, publicBase.compliance);
    stripFamily(publicBase.bic, 'bic');
    // Côté conformité, les tables EPC SUPPRIMÉES : la fusion doit les recréer.
    stripFamily(publicBase.compliance, 'compliance', { dropTables: true });
    cases = pickCases(full.bic, full.compliance);

    // Montage 1 : la base complète, sans surcouche.
    setEnv({
      BIC_DB_PATH: full.bic,
      COMPLIANCE_DB_PATH: full.compliance,
      [OVERLAY_ENV.bic]: undefined,
      [OVERLAY_ENV.compliance]: undefined,
    });
    let graph = await loadGraph();
    before = await collect(cases, graph.routes);
    graph.db.closeAll();

    // Montage 2 : la base publique, et la surcouche par ses variables.
    setEnv({
      BIC_DB_PATH: publicBase.bic,
      COMPLIANCE_DB_PATH: publicBase.compliance,
      [OVERLAY_ENV.bic]: overlay.bic,
      [OVERLAY_ENV.compliance]: overlay.compliance,
    });
    graph = await loadGraph();
    after = await collect(cases, graph.routes);
    const status = graph.runtime.restrictedOverlayStatus();
    states = status.map((s) => `${s.kind}:${s.state}`);
    merged = {
      bic: status.find((s) => s.kind === 'bic')!.served_path,
      compliance: status.find((s) => s.kind === 'compliance')!.served_path,
    };
    twins = status.flatMap((s) =>
      s.members.map((m): [string, boolean | null | undefined] => [
        `${s.kind}.${m.id}`,
        m.identical_to_public,
      ]),
    );
    graph.db.closeAll();
  }, 180_000);

  afterAll(async () => {
    setEnv(saved);
    if (fixture) await fixture.restore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sert la surcouche entière sur les deux bases', () => {
    expect(states.sort()).toEqual(['bic:applied', 'compliance:applied']);
    expect(merged.bic).not.toBe(publicBase.bic);
    expect(merged.compliance).not.toBe(publicBase.compliance);
  });

  it('insère chaque membre depuis la surcouche, la base publique ne portant plus rien', () => {
    // identical_to_public: null = la base publique n'avait aucune ligne du membre.
    expect(twins.length).toBe(10);
    for (const [id, twin] of twins) expect(twin, id).toBeNull();
  });

  it('choisit assez de cas, dont chaque membre de la famille', () => {
    expect(cases.ibans.length).toBeGreaterThanOrEqual(25);
    expect(cases.bics.length).toBeGreaterThanOrEqual(8);
  });

  it('rend des réponses identiques, une fois retirés processing_ms et served_at', () => {
    expect([...after.keys()]).toEqual([...before.keys()]);
    let identical = 0;
    for (const [key, value] of before) {
      expect(after.get(key), key).toEqual(value);
      identical++;
    }
    if (REAL)
      console.log(
        `[équivalence] ${identical} réponses identiques sur ${before.size} ` +
          `(${cases.ibans.length} IBAN, ${cases.bics.length} BIC, lot et démo)`,
      );
    expect(identical).toBe(before.size);
  });

  it('reconstruit les mêmes tables, ligne pour ligne, et le même ordre dans bic_entries', () => {
    for (const kind of ['bic', 'compliance'] as const) {
      const f = full[kind];
      const m = merged[kind];
      expect(tableNames(m), kind).toEqual(tableNames(f));
      const names = tableNames(f).filter((n) => !n.startsWith('idx_'));
      for (const table of names) {
        const spec = RESTRICTED_TABLES[kind].find((t) => t.name === table);
        const db = openDb(f);
        const isTable = !!db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        db.close();
        if (!isTable) continue;
        // bic_entries : l'ordre des lignes (donc des BIC8 partagés) doit tenir,
        // pas les numéros ; ailleurs, le contenu (lu par clé primaire).
        const ordered = spec?.rowidAlias !== undefined;
        expect(tableRows(m, table, ordered, spec?.rowidAlias), `${kind}.${table}`).toEqual(
          tableRows(f, table, ordered, spec?.rowidAlias),
        );
      }
    }
  });
});
