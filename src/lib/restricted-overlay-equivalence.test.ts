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

/** Les membres venus après la première surcouche, qu'aucune vraie base ne porte. */
const LATE = new Set(['bic.map_pl', 'bic.map_fi', 'bic.map_lu', 'bic.register_fi']);
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
        // Les membres venus après la première surcouche (lignes inventées de
        // restricted-overlay-fixtures.ts) : une clé polonaise et une clé
        // luxembourgeoise de la carte, un code de la liste finlandaise.
        ibanFor('PL', '999000000000000000000001'),
        ibanFor('LU', '8000000123456789'),
        ibanFor('FI', '90000000000123'),
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
          `SELECT DISTINCT b.bic11 FROM bic_entries b JOIN pra_banks p ON p.lei = b.lei
           WHERE b.country_code = 'GB' ORDER BY b.bic11 LIMIT 2`,
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

/** Ce que les réponses montrent de chaque membre, compté (jamais de valeur). */
function coverage(responses: Map<string, unknown>): Record<string, number> {
  const count = {
    at_register: 0,
    be_register: 0,
    sm_register: 0,
    epc_register: 0,
    un_matched: 0,
    gb_pra: 0,
    family_bic_found: 0,
    curated_map: 0,
    fi_register: 0,
  };
  for (const [key, value] of responses) {
    const body = (value as { body: Record<string, any> }).body; // eslint-disable-line @typescript-eslint/no-explicit-any
    const check = body.bank_code_check;
    if (key.startsWith('validate ') && check?.status === 'verified') {
      if (/Oesterreichische Nationalbank/.test(check.register)) count.at_register++;
      if (/Banque nationale de Belgique/.test(check.register)) count.be_register++;
      if (/San Marino/.test(check.register)) count.sm_register++;
      if (/Finance Finland/.test(check.register)) count.fi_register++;
      if (
        /composite bank-code map/.test(check.register) &&
        ['PL', 'LU'].includes(body.country?.code)
      )
        count.curated_map++;
    }
    if (key.startsWith('validate ') && body.sepa?.basis === 'epc_register') count.epc_register++;
    if (key.startsWith('compliance') && body.compliance?.sanctions?.matched_lists?.includes('UN'))
      count.un_matched++;
    if (key.startsWith('bic ') && body.country?.code === 'GB' && body.pra_authorisation)
      count.gb_pra++;
    if (key.startsWith('bic ') && body.found && ['eba_step2', 'nbp', 'oenb'].includes(body.source))
      count.family_bic_found++;
  }
  return count;
}

/**
 * Une base publique PLUS RÉCENTE que la surcouche, comme après un passage du
 * robot public : lignes datées changées (bic_entries, SM, PRA, `last_refresh`
 * de la conformité) et une modification non datée (AT). BE reste identique.
 * Générique : les mêmes gestes sur la famille inventée et sur les vraies bases.
 */
function makePublicNewer(bicPath: string, compliancePath: string): void {
  const bic = openDb(bicPath, false);
  bic.exec(`
    UPDATE bic_entries SET updated_at = '2099-01-01 00:00:00', city = COALESCE(city, '') || ' (maj)'
      WHERE source IN ('eba_step2', 'nbp', 'oenb');
    UPDATE national_bank_codes SET name = name || ' (maj)' WHERE country = 'AT';
    UPDATE national_bank_codes SET as_of = '2099-01-01', name = name || ' (maj)' WHERE country = 'SM';
    UPDATE pra_banks SET list_month = '2099-01';
  `);
  bic.close();
  const compliance = openDb(compliancePath, false);
  compliance.exec(`
    UPDATE metadata SET value = '2099-01-01T00:00:00.000Z' WHERE key = 'last_refresh';
    UPDATE vop_participants SET status = CASE status WHEN 'active' THEN 'pending' ELSE 'active' END
      WHERE rowid % 2 = 0;
    DELETE FROM sepa_participants WHERE rowid % 3 = 0;
    DELETE FROM sanctioned_entities
      WHERE rowid = (SELECT MIN(rowid) FROM sanctioned_entities WHERE source_list = 'UN');
  `);
  compliance.close();
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
  /** Cas (c) : base publique encore complète + surcouche. */
  let withFullPublic: Map<string, unknown>;
  let fullPublicDecisions: Record<string, string>;
  /** Cas (d) : base publique plus récente, seule puis avec la surcouche. */
  let newerAlone: Map<string, unknown>;
  let newerWithOverlay: Map<string, unknown>;
  let newerDecisions: Record<string, string>;
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

    /** Un montage : bases servies, surcouche ou non, réponses collectées. */
    const montage = async (bases: { bic: string; compliance: string }, withOverlay: boolean) => {
      setEnv({
        BIC_DB_PATH: bases.bic,
        COMPLIANCE_DB_PATH: bases.compliance,
        [OVERLAY_ENV.bic]: withOverlay ? overlay.bic : undefined,
        [OVERLAY_ENV.compliance]: withOverlay ? overlay.compliance : undefined,
      });
      const graph = await loadGraph();
      const responses = await collect(cases, graph.routes);
      const status = graph.runtime.restrictedOverlayStatus();
      graph.db.closeAll();
      const decisions = Object.fromEntries(
        status.flatMap((st) =>
          st.members.map((m) => [`${st.kind}.${m.id}`, `${m.state}:${m.decision ?? m.reason}`]),
        ),
      );
      return { responses, status, decisions };
    };

    // Montage 1 : la base complète, sans surcouche.
    before = (await montage(full, false)).responses;

    // Montage 2 : la base publique de demain, et la surcouche par ses variables (cas a).
    const stripped = await montage(publicBase, true);
    after = stripped.responses;
    states = stripped.status.map((st) => `${st.kind}:${st.state}`);
    // Copies des fichiers servis : le montage suivant, sur la même surcouche,
    // efface les fichiers fusionnés qu'il ne sert pas.
    merged = {
      bic: join(dir, 'served-bic.sqlite'),
      compliance: join(dir, 'served-compliance.sqlite'),
    };
    copyFileSync(stripped.status.find((st) => st.kind === 'bic')!.served_path, merged.bic);
    copyFileSync(
      stripped.status.find((st) => st.kind === 'compliance')!.served_path,
      merged.compliance,
    );
    // Un membre absent du fichier (en vraies bases, les membres tardifs : aucune
    // base publique ne porte leurs tables) n'a pas de jumeau à comparer.
    twins = stripped.status.flatMap((st) =>
      st.members
        .filter((m) => m.state !== 'absent')
        .map((m): [string, boolean | null | undefined] => [
          `${st.kind}.${m.id}`,
          m.identical_to_public,
        ]),
    );

    // Montage 3 : la base publique d'aujourd'hui, encore complète, + la surcouche
    // extraite d'elle (cas c : le premier dépôt).
    const fullCopy = {
      bic: join(dir, 'full-copy-bic.sqlite'),
      compliance: join(dir, 'full-copy-compliance.sqlite'),
    };
    copyFileSync(full.bic, fullCopy.bic);
    copyFileSync(full.compliance, fullCopy.compliance);
    const twinRun = await montage(fullCopy, true);
    withFullPublic = twinRun.responses;
    fullPublicDecisions = twinRun.decisions;

    // Montages 4 et 5 : une base publique plus récente que la surcouche (cas d),
    // seule puis avec la surcouche.
    const newer = {
      bic: join(dir, 'newer-bic.sqlite'),
      compliance: join(dir, 'newer-compliance.sqlite'),
    };
    copyFileSync(full.bic, newer.bic);
    copyFileSync(full.compliance, newer.compliance);
    makePublicNewer(newer.bic, newer.compliance);
    newerAlone = (await montage(newer, false)).responses;
    const newerRun = await montage(newer, true);
    newerWithOverlay = newerRun.responses;
    newerDecisions = newerRun.decisions;
  }, 300_000);

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
    expect(twins.length).toBe(REAL ? 10 : 14);
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
    // Des comptes seulement, jamais une valeur : la ligne sert la description de la PR.
    console.log(
      `[équivalence${REAL ? ', vraies bases' : ', famille inventée'}] ${identical} réponses identiques sur ${before.size} ` +
        `(${cases.ibans.length} IBAN, ${cases.bics.length} BIC, lot et démo) ; ` +
        `par catégorie : ${JSON.stringify(coverage(after))}`,
    );
    expect(identical).toBe(before.size);
  });

  it('compare vraiment chaque membre : chaque catégorie est dans les réponses', () => {
    // Une comparaison « identique » sur des réponses qui ne touchent pas la
    // famille ne prouverait rien : chaque catégorie doit y être, servie depuis
    // la surcouche.
    const c = coverage(after);
    expect(c.at_register, 'IBAN autrichien au verdict du registre').toBeGreaterThanOrEqual(1);
    expect(c.be_register, 'IBAN belge au verdict du registre').toBeGreaterThanOrEqual(1);
    expect(c.sm_register, 'IBAN saint-marinais trouvé au registre').toBeGreaterThanOrEqual(1);
    expect(c.epc_register, 'banque SEPA servie depuis le registre EPC').toBeGreaterThanOrEqual(1);
    expect(c.un_matched, "BIC nommé par la liste de l'ONU").toBeGreaterThanOrEqual(1);
    expect(c.gb_pra, 'BIC britannique avec son bloc PRA').toBeGreaterThanOrEqual(1);
    expect(c.family_bic_found, 'BIC EBA STEP2, NBP ou OeNB trouvé').toBeGreaterThanOrEqual(3);
    if (!REAL)
      expect(c.fi_register, 'code finlandais au verdict de la liste').toBeGreaterThanOrEqual(1);
  });

  it('les clés PL et LU de la surcouche ne servent pas tant que la carte publique porte ces pays', () => {
    // La règle de fraîcheur, pays par pays (addCuratedRows, src/lib/bic-lookup.ts) :
    // src/db/bic_data.json porte encore la Pologne et le Luxembourg, ses clés ne
    // sont pas datées, il est gardé ; les clés inventées de la surcouche n'y
    // répondent pas, ni avec la surcouche ni sans elle.
    if (REAL) return;
    for (const iban of [
      ibanFor('PL', '999000000000000000000001'),
      ibanFor('LU', '8000000123456789'),
    ]) {
      for (const responses of [after, before]) {
        const body = (responses.get(`validate ${iban}`) as { body: Record<string, any> }).body; // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(body.bic?.code ?? null, iban).toBeNull();
        expect(body.bank_code_check?.status, iban).not.toBe('verified');
      }
    }
    expect(coverage(after).curated_map).toBe(coverage(before).curated_map);
  });

  it('cas (c) : base publique encore complète + surcouche extraite d’elle, mêmes réponses', () => {
    for (const [id, decision] of Object.entries(fullPublicDecisions))
      expect(decision, id).toBe(REAL && LATE.has(id) ? 'absent:not_in_file' : 'applied:identical');
    let identical = 0;
    for (const [key, value] of before) {
      expect(withFullPublic.get(key), key).toEqual(value);
      identical++;
    }
    console.log(
      `[équivalence${REAL ? ', vraies bases' : ', famille inventée'}] cas (c) : ${identical} réponses identiques sur ${before.size}`,
    );
  });

  it('cas (d) : base publique plus récente, ce sont SES réponses qui sont servies', () => {
    expect(newerDecisions).toEqual({
      'bic.eba_step2': 'kept_public:public_newer_or_undated',
      'bic.nbp': 'kept_public:public_newer_or_undated',
      'bic.oenb': 'kept_public:public_newer_or_undated',
      'bic.register_at': 'kept_public:public_newer_or_undated',
      'bic.register_be': 'applied:identical',
      'bic.register_sm': 'kept_public:public_newer_or_undated',
      'bic.pra': 'kept_public:public_newer_or_undated',
      'compliance.un': 'kept_public:public_newer_or_undated',
      'compliance.epc_sepa': 'kept_public:public_newer_or_undated',
      'compliance.epc_vop': 'kept_public:public_newer_or_undated',
      ...Object.fromEntries(
        [...LATE].map((id) => [id, REAL ? 'absent:not_in_file' : 'applied:identical']),
      ),
    });
    // Le montage doit mordre : la base plus récente répond autrement que la complète.
    const moved = [...before.keys()].filter(
      (k) => JSON.stringify(newerAlone.get(k)) !== JSON.stringify(before.get(k)),
    );
    expect(moved.length).toBeGreaterThanOrEqual(10);
    let identical = 0;
    for (const [key, value] of newerAlone) {
      expect(newerWithOverlay.get(key), key).toEqual(value);
      identical++;
    }
    console.log(
      `[équivalence${REAL ? ', vraies bases' : ', famille inventée'}] cas (d) : ${identical} réponses identiques à la base publique seule sur ${newerAlone.size} (${moved.length} différentes de la base d'avant)`,
    );
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
