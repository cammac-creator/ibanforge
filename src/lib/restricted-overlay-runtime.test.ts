import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { Hono } from 'hono';
import { OVERLAY_ENV } from './restricted-family.js';
import { extractOverlay, sha256File, stripFamily } from './restricted-overlay.js';
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
      // Le tirage (étape 5), ajouté à côté : sans ses variables, `off` et rien d'autre.
      pull: { state: 'off' },
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

  const liveDir = (): string[] => readdirSync(join(fixture.dir, 'live')).sort();
  const mergedFiles = (): string[] => liveDir().filter((n) => n.includes('.merged-'));

  it("le fichier arrive pendant que l'API tourne : servi après rechargement", async () => {
    deposit(v1.bic, live.bic);
    deposit(v1.compliance, live.compliance);
    expect(runtime.restrictedOverlaysChanged()).toEqual(['bic', 'compliance']);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.status.state, o.rejected])).toEqual([
      ['bic', true, 'applied', null],
      ['compliance', true, 'applied', null],
    ]);
    expect(runtime.restrictedOverlaysChanged()).toEqual([]);

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
    // La surcouche servie est gardée comme dernière acceptée (R3).
    for (const kind of ['bic', 'compliance'] as const) {
      const served = runtime.restrictedOverlayStatus().find((st) => st.kind === kind)!;
      expect(sha256File(join(fixture.dir, 'live', `restricted-${kind}.accepted.sqlite`))).toBe(
        served.sha256,
      );
    }
  });

  it('un dépôt de la seule conformité ne refusionne pas la base BIC (R5)', async () => {
    const bicBefore = runtime.restrictedOverlayStatus().find((st) => st.kind === 'bic')!;
    const bicConnection = db.getBicDB();
    deposit(v2.compliance, live.compliance);
    expect(runtime.restrictedOverlaysChanged()).toEqual(['compliance']);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed])).toEqual([['compliance', true]]);
    const bicAfter = runtime.restrictedOverlayStatus().find((st) => st.kind === 'bic')!;
    expect(bicAfter.served_path).toBe(bicBefore.served_path);
    expect(bicAfter.built_at).toBe(bicBefore.built_at);
    expect(db.getBicDB()).toBe(bicConnection);
    expect((await complianceOfBic('XMPLATW1XXX')).compliance.vop.status).toBe('pending');
  });

  it('une surcouche BIC différente remplace la précédente, caches compris', async () => {
    // Le cache des recherches BIC est chaud avant le rechargement.
    const warm = await bic(family.eba[0]);
    expect((await bic(family.eba[0])).institution).toBe(warm.institution);
    expect(warm.institution).not.toBe('REMPLISSAGE EBA RENOMME');

    deposit(v2.bic, live.bic);
    expect(runtime.restrictedOverlaysChanged()).toEqual(['bic']);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.every((o) => o.changed && o.status.state === 'applied')).toBe(true);

    expect((await bic(family.eba[0])).institution).toBe('REMPLISSAGE EBA RENOMME');
    const onlyUn = await bic(FIXTURE.UN.onlyUn);
    // L'ONU reste chargée (une autre inscription) : toutes les listes promises
    // ont été lues, et plus rien ne correspond. Un « non » ferme, cette fois.
    expect(onlyUn.sanctions).toEqual({ screened: true, listed: false, matched_lists: [] });
    // Un seul fichier fusionné par base : les précédents sont effacés.
    expect(mergedFiles().length).toBe(2);
  });

  it('un fichier refusé laisse la précédente en service, et la veille se calme (R1)', async () => {
    const before = runtime.restrictedOverlayStatus();
    writeFileSync(`${live.compliance}.depot`, Buffer.from('pas une base SQLite'));
    renameSync(`${live.compliance}.depot`, live.compliance);
    expect(runtime.restrictedOverlaysChanged()).toEqual(['compliance']);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.rejected?.state])).toEqual([
      ['compliance', false, 'refused'],
    ]);
    // Le fichier refusé est vu : le passage suivant ne recommence rien.
    expect(runtime.restrictedOverlaysChanged()).toEqual([]);
    expect(runtime.reloadRestrictedOverlays()).toEqual([]);
    expect(runtime.restrictedOverlayStatus()).toEqual(before);
    expect((await complianceOfBic('XMPLATW1XXX')).compliance.vop.status).toBe('pending');
    const compliance = before.find((st) => st.kind === 'compliance')!;
    expect((await health()).restricted_overlays.compliance).toEqual({
      state: 'applied',
      sha256: compliance.sha256!.slice(0, 12),
    });
  });

  it('une surcouche qui perdrait un membre servi est refusée, fichier fusionné compris (R2)', async () => {
    // v2 avec une inscription VoP altérée : l'empreinte ne correspond plus,
    // epc_vop serait refusé et ne serait plus servi.
    const damaged = join(fixture.dir, 'v2', 'abimee.sqlite');
    copyFileSync(v2.compliance, damaged);
    const d = openDb(damaged);
    d.prepare("UPDATE vop_participants SET status = 'active' WHERE bic8 = 'XMPLATW1'").run();
    d.close();
    deposit(damaged, live.compliance);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.rejected?.state])).toEqual([
      ['compliance', false, 'partial'],
    ]);
    expect(outcomes[0].rejected!.members.find((m) => m.id === 'epc_vop')?.reason).toBe(
      'content_hash_mismatch',
    );
    expect((await complianceOfBic('XMPLATW1XXX')).compliance.vop.status).toBe('pending');
    expect(mergedFiles().length).toBe(2);
    expect(runtime.restrictedOverlaysChanged()).toEqual([]);
  });

  it('une surcouche qui ne porterait plus un membre tardif servi est refusée (absent)', async () => {
    // La même famille, sans les tables des membres venus après la première
    // surcouche : le fichier est accepté seul (membres absents, aucun refus), mais
    // il retirerait les clés PL, FI et LU servies aujourd'hui.
    const older = join(fixture.dir, 'v2', 'sans-tardifs-source.sqlite');
    copyFileSync(fixture.bicPath, older);
    const o = openDb(older);
    o.exec('DROP TABLE curated_bank_codes');
    o.exec('DROP TABLE fi_monetary_codes');
    o.close();
    const withoutLate = extractOverlay({
      kind: 'bic',
      sourcePath: older,
      outPath: join(fixture.dir, 'v2', 'sans-tardifs.sqlite'),
      generator: 'test',
    }).path;
    const servedBefore = runtime.restrictedOverlayStatus().find((st) => st.kind === 'bic')!;
    expect(servedBefore.members.find((m) => m.id === 'map_pl')?.state).toBe('applied');
    deposit(withoutLate, live.bic);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.rejected?.state])).toEqual([
      ['bic', false, 'applied'],
    ]);
    expect(outcomes[0].rejected!.members.find((m) => m.id === 'map_pl')?.state).toBe('absent');
    // Toujours servies : les clés tardives de la surcouche précédente.
    const n = (
      db.getBicDB().prepare('SELECT COUNT(*) AS n FROM curated_bank_codes').get() as { n: number }
    ).n;
    expect(n).toBeGreaterThan(0);
    // Le dépôt suivant remet la version servie : rien ne change.
    deposit(v2.bic, live.bic);
    expect(runtime.reloadRestrictedOverlays().every((o) => !o.rejected)).toBe(true);
  });

  it('au redémarrage, la dernière surcouche acceptée remplace le fichier refusé (R3)', async () => {
    const accepted = sha256File(join(fixture.dir, 'live', 'restricted-compliance.accepted.sqlite'));
    // Un redémarrage : connexions fermées, état oublié, fichiers gardés.
    db.closeAll();
    runtime.resetRestrictedOverlayStateForTests();
    expect((await complianceOfBic('XMPLATW1XXX')).compliance.vop.status).toBe('pending');
    const compliance = runtime.restrictedOverlayStatus().find((st) => st.kind === 'compliance')!;
    expect(compliance.state).toBe('applied');
    expect(compliance.fallback).toBe(true);
    expect(compliance.sha256).toBe(accepted);
    expect(compliance.error).toMatch(/^variable_file_refused:members_refused:epc_vop=/);
    expect((await health()).restricted_overlays.compliance).toEqual({
      state: 'applied',
      sha256: accepted.slice(0, 12),
      fallback: true,
    });
    // Le fichier refusé est vu : la veille ne le reconstruit pas toutes les dix minutes.
    await bic(family.eba[0]);
    expect(runtime.restrictedOverlaysChanged()).toEqual([]);
    expect(mergedFiles().length).toBe(2);
  });

  it('un chemin invalide ou un fichier retiré ne font pas boucler la veille (R1)', async () => {
    const served = runtime.restrictedOverlayStatus().find((st) => st.kind === 'bic')!;
    const notSqlite = join(fixture.dir, 'live', 'surcouche.db');
    writeFileSync(notSqlite, 'x');
    process.env[OVERLAY_ENV.bic] = notSqlite;
    expect(runtime.restrictedOverlaysChanged()).toEqual(['bic']);
    const invalid = runtime.reloadRestrictedOverlays();
    expect(invalid.map((o) => [o.kind, o.changed, o.rejected?.error])).toEqual([
      ['bic', false, 'overlay_path_invalid'],
    ]);
    expect(runtime.restrictedOverlaysChanged()).toEqual([]);

    process.env[OVERLAY_ENV.bic] = live.bic;
    rmSync(live.bic);
    expect(runtime.restrictedOverlaysChanged()).toEqual(['bic']);
    const missing = runtime.reloadRestrictedOverlays();
    expect(missing.map((o) => [o.kind, o.changed, o.rejected?.error])).toEqual([
      ['bic', false, 'overlay_file_missing'],
    ]);
    expect(runtime.restrictedOverlaysChanged()).toEqual([]);
    // Toujours servie : effacer le fichier privé n'est PAS un retour arrière.
    expect(runtime.restrictedOverlayStatus().find((st) => st.kind === 'bic')!.served_path).toBe(
      served.served_path,
    );
    expect((await bic(family.eba[0])).found).toBe(true);
  });

  it('variable retirée : retour à la base publique seule', async () => {
    delete process.env[OVERLAY_ENV.bic];
    expect(runtime.restrictedOverlaysChanged()).toEqual(['bic']);
    const outcomes = runtime.reloadRestrictedOverlays();
    const bicOutcome = outcomes.find((o) => o.kind === 'bic')!;
    expect(bicOutcome.changed).toBe(true);
    expect(bicOutcome.status.state).toBe('off');
    expect(bicOutcome.status.served_path).toBe(publicBase.bic);
    // La ligne EBA STEP2 inventée n'est plus servie.
    expect((await bic(family.eba[0])).found).toBe(false);
    expect(liveDir().filter((n) => n.startsWith('restricted-bic.merged-'))).toEqual([]);
    // La copie acceptée reste : la procédure de retrait l'efface à la main.
    expect(liveDir()).toContain('restricted-bic.accepted.sqlite');
  });
});

describe("surcouche privée : un entretien de fichiers en échec n'interrompt rien", () => {
  let fixture: RestrictedFixture;
  let family: InventedFamily;
  let runtime: typeof import('./restricted-overlay-runtime.js');
  let live: string;
  let publicBic: string;
  let fresher: string;
  const saved = process.env[OVERLAY_ENV.bic];

  beforeAll(async () => {
    fixture = installRestrictedFixture();
    family = completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    mkdirSync(join(fixture.dir, 'live'));
    live = join(fixture.dir, 'live', 'restricted-bic.sqlite');
    extractOverlay({ kind: 'bic', sourcePath: fixture.bicPath, outPath: live, generator: 'test' });
    // Une seconde surcouche, plus récente, pour le rechargement.
    const changed = join(fixture.dir, 'plus-recente.sqlite');
    copyFileSync(fixture.bicPath, changed);
    const d = openDb(changed);
    d.prepare(
      "UPDATE bic_entries SET institution = 'AUTRE NOM', updated_at = '2099-01-01 00:00:00' WHERE bic11 = ?",
    ).run(family.eba[0]);
    d.close();
    fresher = extractOverlay({
      kind: 'bic',
      sourcePath: changed,
      outPath: join(fixture.dir, 'restricted-plus-recente.sqlite'),
      generator: 'test',
    }).path;
    publicBic = join(fixture.dir, 'public-bic.sqlite');
    copyFileSync(fixture.bicPath, publicBic);
    stripFamily(publicBic, 'bic');
    // L'obstacle : un dossier non vide là où la copie acceptée doit être écrite.
    mkdirSync(join(fixture.dir, 'live', 'restricted-bic.accepted.sqlite'));
    writeFileSync(join(fixture.dir, 'live', 'restricted-bic.accepted.sqlite', 'x'), 'x');
    process.env[OVERLAY_ENV.bic] = live;
    vi.resetModules();
    runtime = await import('./restricted-overlay-runtime.js');
  }, 180_000);

  afterAll(async () => {
    if (saved === undefined) delete process.env[OVERLAY_ENV.bic];
    else process.env[OVERLAY_ENV.bic] = saved;
    await fixture.restore();
  });

  it('au démarrage, l’état est gardé : deux ouvertures, une seule fusion', () => {
    const first = runtime.servedDatabasePath('bic', publicBic);
    const status = runtime.restrictedOverlayStatus()[0];
    expect(status.state).toBe('applied');
    expect(status.housekeeping_error).toBeTruthy();
    expect(runtime.servedDatabasePath('bic', publicBic)).toBe(first);
    expect(runtime.restrictedOverlayStatus()[0].built_at).toBe(status.built_at);
  });

  it('au rechargement, les caches inscrits sont vidés malgré l’échec', () => {
    let resets = 0;
    runtime.onReferenceDataReload(() => {
      resets++;
    });
    copyFileSync(fresher, `${live}.depot`);
    renameSync(`${live}.depot`, live);
    const outcomes = runtime.reloadRestrictedOverlays();
    expect(outcomes.map((o) => [o.kind, o.changed, o.status.state])).toEqual([
      ['bic', true, 'applied'],
    ]);
    expect(outcomes[0].status.housekeeping_error).toBeTruthy();
    expect(resets).toBe(1);
  });
});
