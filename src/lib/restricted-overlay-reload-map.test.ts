import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { Hono } from 'hono';
import { OVERLAY_ENV } from './restricted-family.js';
import { extractOverlay, stripFamily } from './restricted-overlay.js';
import {
  ibanFor,
  installRestrictedFixture,
  type RestrictedFixture,
} from '../test-support/restricted-fixtures.js';
import { completeRestrictedFamily } from '../test-support/restricted-overlay-fixtures.js';

/**
 * Le chemin du rechargement de la carte composite (relecture de la PR 267,
 * point 3). Depuis la PR 267, `resetStatements` (src/lib/bic-lookup.ts) oublie
 * la carte et le choix de la liste finlandaise à chaque fermeture de la base BIC,
 * donc à chaque rechargement de la surcouche : les élagages de la carte sont
 * refaits sur la base servie, ce que main ne faisait qu'au démarrage.
 *
 * La preuve des 764 réponses ne passe que par des démarrages. Ici : les réponses
 * après un rechargement sont celles d'un processus neuf démarré sur la même
 * surcouche, et le rechargement change bien la carte (un BIC qui apparaît).
 *
 * Tout est inventé (restricted-fixtures.ts, complété jusqu'aux planchers), sauf
 * une clé finlandaise de src/db/bic_data.json choisie à l'exécution, s'il en
 * porte encore : jamais écrite ici.
 */

const require = createRequire(import.meta.url);
const DEV = { 'X-Dev-Skip': 'true' };
const VOLATILE = new Set(['processing_ms', 'served_at', 'request_id']);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function openDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(([k]) => !VOLATILE.has(k))
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}

/** Dépôt comme en production : un fichier voisin, puis un renommage atomique. */
function deposit(source: string, target: string): void {
  const staged = `${target}.depot`;
  copyFileSync(source, staged);
  renameSync(staged, target);
}

async function loadGraph() {
  vi.resetModules();
  return {
    db: await import('./db.js'),
    runtime: await import('./restricted-overlay-runtime.js'),
    validate: (await import('../routes/iban-validate.js')).ibanValidate,
  };
}

describe('rechargement de la surcouche : la carte composite suit la base servie', () => {
  let fixture: RestrictedFixture;
  let live: { bic: string; compliance: string };
  let v2Bic: string;
  let cases: string[];
  const saved = {
    BIC_DB_PATH: process.env.BIC_DB_PATH,
    COMPLIANCE_DB_PATH: process.env.COMPLIANCE_DB_PATH,
    [OVERLAY_ENV.bic]: process.env[OVERLAY_ENV.bic],
    [OVERLAY_ENV.compliance]: process.env[OVERLAY_ENV.compliance],
  };

  const answers = async (graph: Awaited<ReturnType<typeof loadGraph>>): Promise<Json> => {
    const app = new Hono();
    app.route('/', graph.validate as unknown as Hono);
    const out: Json = {};
    for (const iban of cases) {
      const res = await app.request('/v1/iban/validate', {
        method: 'POST',
        headers: { ...DEV, 'Content-Type': 'application/json' },
        body: JSON.stringify({ iban }),
      });
      out[iban] = { status: res.status, body: normalize(await res.json()) };
    }
    return out;
  };

  beforeAll(() => {
    fixture = installRestrictedFixture();
    completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    const dir = fixture.dir;
    mkdirSync(join(dir, 'v1'));
    mkdirSync(join(dir, 'v2'));
    const v1 = {
      bic: extractOverlay({
        kind: 'bic',
        sourcePath: fixture.bicPath,
        outPath: join(dir, 'v1', 'restricted-bic.sqlite'),
        generator: 'test',
      }).path,
      compliance: extractOverlay({
        kind: 'compliance',
        sourcePath: fixture.compliancePath,
        outPath: join(dir, 'v1', 'restricted-compliance.sqlite'),
        generator: 'test',
      }).path,
    };
    // La version 2 : une liste finlandaise plus récente, qui attribue aussi les
    // préfixes 1 et 5 (les clés de la carte qui commencent ainsi ne sont plus
    // élaguées), et une clé polonaise de la surcouche au BIC changé.
    const fullV2 = join(dir, 'full-v2-bic.sqlite');
    copyFileSync(fixture.bicPath, fullV2);
    const b = openDb(fullV2);
    b.prepare(
      "UPDATE fi_monetary_codes SET institution = institution || ' v2', as_of = '2026-02-15'",
    ).run();
    const add = b.prepare(
      `INSERT INTO fi_monetary_codes (code, bic, institution, source, as_of)
       VALUES (?, ?, ?, 'Remplissage', '2026-02-15')`,
    );
    add.run('1', 'XMPUFIH1', 'Remplissage Un');
    add.run('5', 'XMPMFIH1', 'Remplissage Cinq');
    b.prepare(
      "UPDATE curated_bank_codes SET bic = 'XMPQPLPWXXX' WHERE country = 'PL' AND code = '99900000'",
    ).run();
    b.close();
    v2Bic = extractOverlay({
      kind: 'bic',
      sourcePath: fullV2,
      outPath: join(dir, 'v2', 'restricted-bic.sqlite'),
      generator: 'test',
    }).path;

    const publicBase = {
      bic: join(dir, 'public-bic.sqlite'),
      compliance: join(dir, 'public-compliance.sqlite'),
    };
    copyFileSync(fixture.bicPath, publicBase.bic);
    copyFileSync(fixture.compliancePath, publicBase.compliance);
    stripFamily(publicBase.bic, 'bic');
    stripFamily(publicBase.compliance, 'compliance', { dropTables: true });

    mkdirSync(join(dir, 'live'));
    live = {
      bic: join(dir, 'live', 'restricted-bic.sqlite'),
      compliance: join(dir, 'live', 'restricted-compliance.sqlite'),
    };
    deposit(v1.bic, live.bic);
    deposit(v1.compliance, live.compliance);
    process.env.BIC_DB_PATH = publicBase.bic;
    process.env.COMPLIANCE_DB_PATH = publicBase.compliance;
    process.env[OVERLAY_ENV.bic] = live.bic;
    process.env[OVERLAY_ENV.compliance] = live.compliance;

    // Les cas : la liste finlandaise (code 9000), les clés inventées de la surcouche
    // (FI 500, PL 99900000, LU 800), et une clé finlandaise en 1 de la carte
    // publique si elle en porte encore (élaguée sous la liste v1, gardée sous v2).
    const map = require('../db/bic_data.json') as Record<string, unknown>;
    const fiKey = Object.keys(map)
      .filter((k) => /^FI:1\d\d$/.test(k))
      .sort()[0];
    cases = [
      ibanFor('FI', '90000000000123'),
      ibanFor('FI', '50000000000123'),
      ibanFor('PL', '999000000000000000000001'),
      ibanFor('LU', '8000000123456789'),
      ...(fiKey ? [ibanFor('FI', `${fiKey.slice(3)}45600000785`)] : []),
    ];
  }, 180_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fixture.restore();
  });

  it('après un rechargement, les réponses d’un processus neuf ; et la carte a bougé', async () => {
    const graph = await loadGraph();
    graph.db.getBicDB();
    const before = await answers(graph);

    deposit(v2Bic, live.bic);
    const outcomes = graph.runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.rejected])).toEqual([['bic', true, null]]);
    const reloaded = await answers(graph);
    graph.db.closeAll();

    // Un processus neuf, démarré sur la même surcouche.
    const fresh = await loadGraph();
    fresh.db.getBicDB();
    const restarted = await answers(fresh);
    fresh.db.closeAll();

    for (const iban of cases) expect(reloaded[iban], iban).toEqual(restarted[iban]);
    // Le rechargement mord : la liste servie a changé de date et de noms…
    const list = cases[0];
    expect(before[list].body.bank_code_check?.as_of).toBe('2026-01');
    expect(reloaded[list].body.bank_code_check?.as_of).toBe('2026-02');
    // … et la carte composite a été reconstruite : au moins un BIC apparaît ou change.
    const moved = cases.filter(
      (iban) => (before[iban].body.bic?.code ?? null) !== (reloaded[iban].body.bic?.code ?? null),
    );
    expect(moved.length).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
