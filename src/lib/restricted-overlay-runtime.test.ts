import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { Hono } from 'hono';
import { OVERLAY_ENV } from './restricted-family.js';
import { extractOverlay, stripFamily } from './restricted-overlay.js';
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
 * La surcouche dans une API qui tourne : absente au démarrage, déposée, remplacée,
 * refusée, retirée, sans jamais redémarrer.
 *
 * Deux défauts relevés à l'intégration de la PR 249 sont prouvés ici :
 *
 * 1. **Le faux « propre »** : l'UE et l'OFAC chargées, la liste de l'ONU absente
 *    (surcouche manquante). Une banque inscrite par la SEULE ONU ne doit pas
 *    ressortir « non listée » en silence : drapeau sans poids qui nomme la liste,
 *    `listed: null` sur la recherche BIC, `meta.sources` sans l'ONU.
 * 2. **L'ajout sans redémarrage** : une surcouche arrivée pendant que l'API tourne
 *    doit être servie après rechargement, sondes et mémos de la PR 249
 *    (`complianceTableLoaded`, `meta.sources`) remis à zéro, comme le cache des
 *    recherches BIC.
 *
 * Tout est inventé (restricted-fixtures.ts, complété jusqu'aux planchers).
 */

const require = createRequire(import.meta.url);
const DEV = { 'X-Dev-Skip': 'true' };

function openDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path);
}

/** Dépôt comme en production : un fichier voisin, puis un renommage atomique. */
function deposit(source: string, target: string): void {
  const staged = `${target}.depot`;
  copyFileSync(source, staged);
  renameSync(staged, target);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('surcouche privée : rechargement sans redémarrage', () => {
  let fixture: RestrictedFixture;
  let family: InventedFamily;
  let live: { bic: string; compliance: string };
  let v1: { bic: string; compliance: string };
  let v2: { bic: string; compliance: string };
  let publicBase: { bic: string; compliance: string };
  let runtime: typeof import('./restricted-overlay-runtime.js');
  let db: typeof import('./db.js');
  let app: Hono;
  const saved = {
    BIC_DB_PATH: process.env.BIC_DB_PATH,
    COMPLIANCE_DB_PATH: process.env.COMPLIANCE_DB_PATH,
    [OVERLAY_ENV.bic]: process.env[OVERLAY_ENV.bic],
    [OVERLAY_ENV.compliance]: process.env[OVERLAY_ENV.compliance],
  };

  const bic = async (code: string): Promise<Json> =>
    (await (await app.request(`/v1/bic/${code}`, { headers: DEV })).json()) as Json;
  const complianceOfBic = async (code: string): Promise<Json> =>
    (await (
      await app.request('/v1/iban/compliance', {
        method: 'POST',
        headers: { ...DEV, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bic: code }),
      })
    ).json()) as Json;
  const health = async (): Promise<Json> => (await (await app.request('/health')).json()) as Json;

  beforeAll(async () => {
    fixture = installRestrictedFixture();
    family = completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    const dir = fixture.dir;
    const extract = (kind: 'bic' | 'compliance', source: string, out: string): string =>
      extractOverlay({ kind, sourcePath: source, outPath: out, generator: 'test' }).path;
    mkdirSync(join(dir, 'v1'));
    v1 = {
      bic: extract('bic', fixture.bicPath, join(dir, 'v1', 'restricted-bic.sqlite')),
      compliance: extract(
        'compliance',
        fixture.compliancePath,
        join(dir, 'v1', 'restricted-compliance.sqlite'),
      ),
    };

    // La version 2 : un nom de banque changé, une inscription ONU en moins, une
    // banque passée « en attente » au registre VoP.
    const fullV2 = {
      bic: join(dir, 'full-v2-bic.sqlite'),
      compliance: join(dir, 'full-v2-compliance.sqlite'),
    };
    copyFileSync(fixture.bicPath, fullV2.bic);
    copyFileSync(fixture.compliancePath, fullV2.compliance);
    const b = openDb(fullV2.bic);
    b.prepare("UPDATE bic_entries SET institution = 'REMPLISSAGE EBA RENOMME' WHERE bic11 = ?").run(
      family.eba[0],
    );
    b.close();
    const c = openDb(fullV2.compliance);
    c.prepare("DELETE FROM sanctioned_entities WHERE bic8 = ? AND source_list = 'UN'").run(
      FIXTURE.UN.onlyUn,
    );
    c.prepare("UPDATE vop_participants SET status = 'pending' WHERE bic8 = 'XMPLATW1'").run();
    c.close();
    mkdirSync(join(dir, 'v2'));
    v2 = {
      bic: extract('bic', fullV2.bic, join(dir, 'v2', 'restricted-bic.sqlite')),
      compliance: extract(
        'compliance',
        fullV2.compliance,
        join(dir, 'v2', 'restricted-compliance.sqlite'),
      ),
    };

    publicBase = {
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
    process.env.BIC_DB_PATH = publicBase.bic;
    process.env.COMPLIANCE_DB_PATH = publicBase.compliance;
    process.env[OVERLAY_ENV.bic] = live.bic;
    process.env[OVERLAY_ENV.compliance] = live.compliance;

    vi.resetModules();
    runtime = await import('./restricted-overlay-runtime.js');
    db = await import('./db.js');
    app = new Hono();
    app.route('/', (await import('../routes/bic-lookup.js')).bicLookup);
    app.route('/', (await import('../routes/iban-compliance.js')).ibanCompliance);
    app.route('/', (await import('../routes/health.js')).health);
  }, 180_000);

  afterAll(async () => {
    db?.closeAll();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fixture.restore();
  });

  it('surcouche configurée mais absente au démarrage : base publique seule, raison dite', async () => {
    const h = await health();
    const status = runtime.restrictedOverlayStatus();
    expect(status.map((s) => [s.kind, s.state, s.error])).toEqual([
      ['bic', 'refused', 'overlay_file_missing'],
      ['compliance', 'refused', 'overlay_file_missing'],
    ]);
    expect(h.restricted_overlays).toEqual({
      bic: { state: 'refused', sha256: null },
      compliance: { state: 'refused', sha256: null },
    });
  });

  it("pas de faux « propre » quand seule la liste de l'ONU manque", async () => {
    const onlyUn = await complianceOfBic(FIXTURE.UN.onlyUn);
    expect(onlyUn.compliance.sanctions.bank_screened).toBe(true);
    expect(onlyUn.compliance.sanctions.bank_sanctioned).toBe(false);
    expect(onlyUn.compliance.flags).toContain('sanctions_list_unavailable_un');
    expect(onlyUn.meta.sources).not.toMatch(/\bUN\b/);

    const lookup = await bic(FIXTURE.UN.onlyUn);
    expect(lookup.sanctions).toEqual({
      screened: true,
      listed: null,
      matched_lists: [],
      unscreened_lists: ['UN'],
    });
    // Une correspondance sur une liste lue reste un « oui » ferme.
    const both = await bic(FIXTURE.UN.unAndOfac);
    expect(both.sanctions.listed).toBe(true);
    expect(both.sanctions.matched_lists).toEqual(['OFAC']);
    expect(both.sanctions.unscreened_lists).toEqual(['UN']);
  });

  it("le fichier arrive pendant que l'API tourne : servi après rechargement", async () => {
    deposit(v1.bic, live.bic);
    deposit(v1.compliance, live.compliance);
    expect(runtime.restrictedOverlayFilesChanged()).toBe(true);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.status.state, o.rejected])).toEqual([
      ['bic', true, 'applied', null],
      ['compliance', true, 'applied', null],
    ]);
    expect(runtime.restrictedOverlayFilesChanged()).toBe(false);

    const onlyUn = await complianceOfBic(FIXTURE.UN.onlyUn);
    expect(onlyUn.compliance.sanctions.bank_sanctioned).toBe(true);
    expect(onlyUn.compliance.sanctions.matched_lists).toEqual(['UN']);
    expect(onlyUn.compliance.flags).not.toContain('sanctions_list_unavailable_un');
    // Les mémos de la PR 249 ont été effacés : l'ONU et l'EPC sont nommés.
    expect(onlyUn.meta.sources).toMatch(/\bUN\b/);
    expect(onlyUn.meta.sources).toMatch(/EPC-SCT/);
    const lookup = await bic(FIXTURE.UN.onlyUn);
    expect(lookup.sanctions).toEqual({ screened: true, listed: true, matched_lists: ['UN'] });

    const at = await complianceOfBic('XMPLATW1XXX');
    expect(at.compliance.reachability.screened).toBe(true);
    expect(at.compliance.vop.status).toBe('active');

    const h = await health();
    expect(h.restricted_overlays.bic.state).toBe('applied');
    expect(h.restricted_overlays.compliance.sha256).toMatch(/^[0-9a-f]{12}$/);
  });

  it('une surcouche différente remplace la précédente, caches compris', async () => {
    // Le cache des recherches BIC est chaud avant le rechargement.
    const warm = await bic(family.eba[0]);
    expect((await bic(family.eba[0])).institution).toBe(warm.institution);
    expect(warm.institution).not.toBe('REMPLISSAGE EBA RENOMME');

    deposit(v2.bic, live.bic);
    deposit(v2.compliance, live.compliance);
    expect(runtime.restrictedOverlayFilesChanged()).toBe(true);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.every((o) => o.changed && o.status.state === 'applied')).toBe(true);

    expect((await bic(family.eba[0])).institution).toBe('REMPLISSAGE EBA RENOMME');
    const onlyUn = await bic(FIXTURE.UN.onlyUn);
    // L'ONU reste chargée (une autre inscription) : toutes les listes promises
    // ont été lues, et plus rien ne correspond. Un « non » ferme, cette fois.
    expect(onlyUn.sanctions).toEqual({ screened: true, listed: false, matched_lists: [] });
    expect((await complianceOfBic('XMPLATW1XXX')).compliance.vop.status).toBe('pending');

    // Un seul fichier fusionné par base : les précédents sont effacés.
    const merged = readdirSync(join(fixture.dir, 'live')).filter((n) => n.includes('.merged-'));
    expect(merged.length).toBe(2);
  });

  it('une surcouche neuve refusée laisse la précédente en service', async () => {
    const before = runtime.restrictedOverlayStatus().find((s) => s.kind === 'compliance')!;
    writeFileSync(`${live.compliance}.depot`, Buffer.from('pas une base SQLite'));
    renameSync(`${live.compliance}.depot`, live.compliance);
    const outcomes = runtime.reloadRestrictedOverlays();
    const compliance = outcomes.find((o) => o.kind === 'compliance')!;
    expect(compliance.changed).toBe(false);
    expect(compliance.rejected?.state).toBe('refused');
    expect(compliance.status.sha256).toBe(before.sha256);
    expect((await complianceOfBic('XMPLATW1XXX')).compliance.vop.status).toBe('pending');
    expect((await health()).restricted_overlays.compliance).toEqual({
      state: 'applied',
      sha256: before.sha256!.slice(0, 12),
    });
  });

  it('variable retirée : retour à la base publique seule', async () => {
    delete process.env[OVERLAY_ENV.bic];
    expect(runtime.restrictedOverlayFilesChanged()).toBe(true);
    const outcomes = runtime.reloadRestrictedOverlays();
    const bicOutcome = outcomes.find((o) => o.kind === 'bic')!;
    expect(bicOutcome.changed).toBe(true);
    expect(bicOutcome.status.state).toBe('off');
    expect(bicOutcome.status.served_path).toBe(publicBase.bic);
    // La ligne EBA STEP2 inventée n'est plus servie.
    expect((await bic(family.eba[0])).found).toBe(false);
    expect(
      readdirSync(join(fixture.dir, 'live')).filter((n) => n.startsWith('restricted-bic.merged-')),
    ).toEqual([]);
  });
});
