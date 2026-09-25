import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { Hono } from 'hono';
import { OVERLAY_ENV, RESTRICTED_FAMILY, type OverlayKind } from './restricted-family.js';
import {
  OVERLAY_MEMBERS_TABLE,
  extractOverlay,
  memberContentSha256,
  sha256File,
  stripFamily,
} from './restricted-overlay.js';
import {
  MANIFEST_FORMAT,
  OVERLAY_DOWNLOAD_MAX_BYTES,
  manifestEntryFor,
  type OverlayManifest,
} from './restricted-overlay-manifest.js';
import {
  installRestrictedFixture,
  type RestrictedFixture,
} from '../test-support/restricted-fixtures.js';
import { completeRestrictedFamily } from '../test-support/restricted-overlay-fixtures.js';

/**
 * Le tirage de la surcouche privée (étape 5), contre un faux GitHub local : une
 * API qui exige le jeton et redirige chaque asset, et un « stockage » séparé
 * (une autre origine) qui ne doit jamais recevoir ce jeton.
 *
 * Tout est inventé : le dépôt, le jeton, les données (restricted-fixtures.ts,
 * complété jusqu'aux planchers).
 */

const ops = vi.hoisted(() => ({ opsFail: vi.fn(), opsOk: vi.fn() }));
vi.mock('./ops-alert.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ops-alert.js')>()),
  opsFail: ops.opsFail,
  opsOk: ops.opsOk,
}));

const REPO = 'acme-exemple/surcouche-essai';
const TOKEN = 'jeton-essai-0001';
const DAY = 24 * 3_600_000;
const PULL_ENV_REPO = 'RESTRICTED_OVERLAY_PULL_REPO';
const PULL_ENV_TOKEN = 'RESTRICTED_OVERLAY_PULL_TOKEN';
const require = createRequire(import.meta.url);

function openDb(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------
// Le faux GitHub
// ---------------------------------------------------------------------------

interface FakeAsset {
  name: string;
  body: Buffer;
  /** Taille annoncée par la release, si elle ment. */
  size?: number;
}

interface FakeRelease {
  tag: string;
  published_at: string;
  assets: FakeAsset[];
}

interface SeenRequest {
  server: 'api' | 'storage';
  path: string;
  auth: string | null;
}

class FakeGithub {
  release: FakeRelease | null = null;
  /** Le jeton que l'API accepte : le changer, c'est faire expirer celui de l'API. */
  token = TOKEN;
  /** Un statut imposé à `releases/latest`. */
  latestStatus: number | null = null;
  requests: SeenRequest[] = [];
  apiBase = '';
  private storageBase = '';
  private api: Server | null = null;
  private storage: Server | null = null;

  async start(): Promise<void> {
    this.storage = createServer((req, res) => this.serveStorage(req, res));
    this.api = createServer((req, res) => this.serveApi(req, res));
    this.storageBase = await listen(this.storage);
    this.apiBase = await listen(this.api);
  }

  async stop(): Promise<void> {
    for (const server of [this.api, this.storage])
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  /** Les assets téléchargés (au stockage), par nom. */
  downloaded(): string[] {
    return this.requests
      .filter((r) => r.server === 'storage')
      .map((r) => this.release?.assets[Number(/\/blob\/(\d+)/.exec(r.path)?.[1]) - 1]?.name ?? '?');
  }

  private serveApi(req: IncomingMessage, res: ServerResponse): void {
    const path = req.url ?? '';
    this.requests.push({ server: 'api', path, auth: req.headers.authorization ?? null });
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${this.token}`)
      return json(401, { message: 'Bad credentials' });
    if (path === `/repos/${REPO}/releases/latest`) {
      if (this.latestStatus) return json(this.latestStatus, { message: 'imposé' });
      if (!this.release) return json(404, { message: 'Not Found' });
      return json(200, {
        tag_name: this.release.tag,
        published_at: this.release.published_at,
        draft: false,
        assets: this.release.assets.map((a, i) => ({
          id: i + 1,
          name: a.name,
          size: a.size ?? a.body.length,
          state: 'uploaded',
          url: `${this.apiBase}/repos/${REPO}/releases/assets/${i + 1}`,
        })),
      });
    }
    const asset = new RegExp(`^/repos/${REPO}/releases/assets/(\\d+)$`).exec(path);
    if (asset && req.headers.accept === 'application/octet-stream') {
      res.writeHead(302, { location: `${this.storageBase}/blob/${asset[1]}?sig=signature-essai` });
      return void res.end();
    }
    json(404, { message: 'Not Found' });
  }

  private serveStorage(req: IncomingMessage, res: ServerResponse): void {
    const path = req.url ?? '';
    this.requests.push({ server: 'storage', path, auth: req.headers.authorization ?? null });
    const id = Number(/^\/blob\/(\d+)\?sig=signature-essai$/.exec(path)?.[1]);
    const asset = this.release?.assets[id - 1];
    if (!asset) {
      res.writeHead(404);
      return void res.end();
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(asset.body);
  }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// ---------------------------------------------------------------------------
// Sans variables : rien
// ---------------------------------------------------------------------------

describe('tirage de la surcouche : sans ses variables', () => {
  const saved = { repo: process.env[PULL_ENV_REPO], token: process.env[PULL_ENV_TOKEN] };

  beforeAll(() => {
    delete process.env[PULL_ENV_REPO];
    delete process.env[PULL_ENV_TOKEN];
  });

  afterAll(async () => {
    if (saved.repo !== undefined) process.env[PULL_ENV_REPO] = saved.repo;
    if (saved.token !== undefined) process.env[PULL_ENV_TOKEN] = saved.token;
    (await import('./db.js')).closeAll();
    vi.restoreAllMocks();
  });

  it('variables absentes : aucun appel réseau, aucune alerte, état off', async () => {
    vi.resetModules();
    const pull = await import('./restricted-overlay-pull.js');
    const { overlayWatchTick } = await import('./restricted-overlay-ops.js');
    const { health } = await import('../routes/health.js');
    ops.opsFail.mockReset();
    ops.opsOk.mockReset();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await pull.runOverlayPull()).toEqual({
      state: 'off',
      error: null,
      release: null,
      kinds: {},
      installed: [],
    });
    expect(await pull.overlayPullTick()).toEqual([]);
    overlayWatchTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pull.restrictedOverlayPullHealth()).toEqual({ state: 'off' });
    const app = new Hono();
    app.route('/', health);
    const body = (await (await app.request('/health')).json()) as Json;
    expect(body.restricted_overlays.pull).toEqual({ state: 'off' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ops.opsFail).not.toHaveBeenCalled();
    expect(ops.opsOk).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Contre le faux GitHub
// ---------------------------------------------------------------------------

describe('tirage de la surcouche : contre un faux GitHub', () => {
  let fixture: RestrictedFixture;
  let fake: FakeGithub;
  let v1: Record<OverlayKind, string>;
  let v2: Record<OverlayKind, string>;
  let live: Record<OverlayKind, string>;
  let pull: typeof import('./restricted-overlay-pull.js');
  let runtime: typeof import('./restricted-overlay-runtime.js');
  let opsModule: typeof import('./restricted-overlay-ops.js');
  let db: typeof import('./db.js');
  let complianceDb: typeof import('./compliance-db.js');
  let forum: typeof import('./forum-radar-server.js');
  let app: Hono;
  const saved: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'BIC_DB_PATH',
    'COMPLIANCE_DB_PATH',
    OVERLAY_ENV.bic,
    OVERLAY_ENV.compliance,
    PULL_ENV_REPO,
    PULL_ENV_TOKEN,
  ];

  const health = async (): Promise<Json> => (await (await app.request('/health')).json()) as Json;
  const served = (kind: OverlayKind) =>
    runtime.restrictedOverlayStatus().find((s) => s.kind === kind)!;
  const run = (now?: () => number) => pull.runOverlayPull({ apiBase: fake.apiBase, now });
  const alertKeys = (fn: typeof ops.opsFail): string[] => fn.mock.calls.map((c) => String(c[0]));
  const liveLeftovers = (): string[] =>
    readdirSync(join(fixture.dir, 'live')).filter((n) => n.includes('.pull-'));

  /** Publie une release : les fichiers donnés, leur manifeste, et d'éventuels mensonges. */
  function publish(
    tag: string,
    files: Partial<Record<OverlayKind, string>>,
    options: {
      publishedAt?: string;
      tweak?: (manifest: OverlayManifest) => void;
      bodies?: Partial<Record<OverlayKind, Buffer>>;
    } = {},
  ): OverlayManifest {
    const manifest: OverlayManifest = {
      format: MANIFEST_FORMAT,
      generated_at: new Date().toISOString(),
      public_commit: '0123456789abcdef0123456789abcdef01234567',
      files: {},
    };
    for (const kind of ['bic', 'compliance'] as const) {
      const path = files[kind];
      if (path)
        manifest.files[kind] = manifestEntryFor({
          kind,
          path,
          publicCommit: manifest.public_commit,
        });
    }
    options.tweak?.(manifest);
    const assets: FakeAsset[] = [
      { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) },
    ];
    for (const kind of ['bic', 'compliance'] as const) {
      const entry = manifest.files[kind];
      if (!entry || !files[kind]) continue;
      const body = options.bodies?.[kind] ?? readFileSync(files[kind]!);
      assets.push({ name: entry.name, body, size: entry.bytes });
    }
    fake.release = {
      tag,
      published_at: options.publishedAt ?? new Date().toISOString(),
      assets,
    };
    return manifest;
  }

  beforeAll(async () => {
    fixture = installRestrictedFixture();
    completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    const dir = fixture.dir;
    const extract = (kind: OverlayKind, source: string, out: string): string =>
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
    // Une seconde édition : un nom de banque et un statut VoP changés.
    const fullV2 = {
      bic: join(dir, 'full-v2-bic.sqlite'),
      compliance: join(dir, 'full-v2-compliance.sqlite'),
    };
    copyFileSync(fixture.bicPath, fullV2.bic);
    copyFileSync(fixture.compliancePath, fullV2.compliance);
    const b = openDb(fullV2.bic);
    b.prepare(
      "UPDATE bic_entries SET institution = 'REMPLISSAGE RENOMME' WHERE source = 'eba_step2' AND rowid = (SELECT MIN(rowid) FROM bic_entries WHERE source = 'eba_step2')",
    ).run();
    b.close();
    const c = openDb(fullV2.compliance);
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

    const publicBase = {
      bic: join(dir, 'public-bic.sqlite'),
      compliance: join(dir, 'public-compliance.sqlite'),
    };
    copyFileSync(fixture.bicPath, publicBase.bic);
    copyFileSync(fixture.compliancePath, publicBase.compliance);
    stripFamily(publicBase.bic, 'bic');
    stripFamily(publicBase.compliance, 'compliance', { dropTables: true });

    mkdirSync(join(dir, 'live'), { mode: 0o700 });
    live = {
      bic: join(dir, 'live', 'restricted-bic.sqlite'),
      compliance: join(dir, 'live', 'restricted-compliance.sqlite'),
    };

    fake = new FakeGithub();
    await fake.start();

    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.BIC_DB_PATH = publicBase.bic;
    process.env.COMPLIANCE_DB_PATH = publicBase.compliance;
    process.env[OVERLAY_ENV.bic] = live.bic;
    process.env[OVERLAY_ENV.compliance] = live.compliance;
    process.env[PULL_ENV_REPO] = REPO;
    process.env[PULL_ENV_TOKEN] = TOKEN;

    vi.resetModules();
    pull = await import('./restricted-overlay-pull.js');
    runtime = await import('./restricted-overlay-runtime.js');
    opsModule = await import('./restricted-overlay-ops.js');
    db = await import('./db.js');
    complianceDb = await import('./compliance-db.js');
    forum = await import('./forum-radar-server.js');
    app = new Hono();
    app.route('/', (await import('../routes/health.js')).health);
    // Le démarrage : les deux bases ouvertes, sans fichier privé encore.
    db.getBicDB();
    complianceDb.getComplianceDB();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  }, 180_000);

  afterAll(async () => {
    await fake?.stop();
    db?.closeAll();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
    await fixture?.restore();
  });

  afterEach(() => {
    fake.requests = [];
    fake.token = TOKEN;
    fake.latestStatus = null;
    ops.opsFail.mockClear();
    ops.opsOk.mockClear();
  });

  it('avant le premier tirage : pending, rien de servi par un tirage', async () => {
    const h = await health();
    expect(h.restricted_overlays.bic).toEqual({ state: 'refused', sha256: null });
    expect(h.restricted_overlays.pull).toEqual({
      state: 'pending',
      last_attempt_at: null,
      last_success_at: null,
      release: null,
      release_published_at: null,
      bic: null,
      compliance: null,
      error: null,
    });
  });

  it('release et manifeste normaux : les deux fichiers posés, puis servis par la veille', async () => {
    const manifest = publish('surcouche-essai-1', v1);
    const attempt = await run();
    expect(attempt).toMatchObject({
      state: 'ok',
      error: null,
      release: 'surcouche-essai-1',
      kinds: { bic: 'installed', compliance: 'installed' },
      installed: ['bic', 'compliance'],
    });
    for (const kind of ['bic', 'compliance'] as const)
      expect(sha256File(live[kind])).toBe(manifest.files[kind]!.sha256);
    // Le jeton part vers l'API, jamais vers le stockage ; l'adresse signée n'est
    // écrite nulle part.
    expect(
      fake.requests.filter((r) => r.server === 'api').every((r) => r.auth === `Bearer ${TOKEN}`),
    ).toBe(true);
    expect(fake.requests.filter((r) => r.server === 'storage').map((r) => r.auth)).toEqual([
      null,
      null,
      null,
    ]);
    expect(fake.downloaded().sort()).toEqual([
      'manifest.json',
      'restricted-bic.sqlite',
      'restricted-compliance.sqlite',
    ]);
    expect(liveLeftovers()).toEqual([]);

    // La veille recharge les bases dont le fichier a changé.
    expect(runtime.restrictedOverlaysChanged()).toEqual(['bic', 'compliance']);
    opsModule.overlayWatchTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const kind of ['bic', 'compliance'] as const) {
      expect(served(kind).state).toBe('applied');
      expect(served(kind).sha256).toBe(manifest.files[kind]!.sha256);
    }
    // Quatre requêtes à l'API (la release, trois assets), trois au stockage ; pas
    // dû avant quatre heures, la veille n'a rien retiré de plus.
    expect(fake.requests.length).toBe(7);

    const h = await health();
    expect(h.restricted_overlays.pull).toMatchObject({
      state: 'ok',
      release: 'surcouche-essai-1',
      error: null,
      bic: {
        release: 'surcouche-essai-1',
        generated_at: manifest.files.bic!.generated_at,
        age_days: 0,
      },
      compliance: { release: 'surcouche-essai-1', age_days: 0 },
    });
    expect(h.restricted_overlays.pull.last_success_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Ni le dépôt, ni le jeton : dans /health comme dans l'état gardé.
    const text = JSON.stringify(h) + (forum.kvGet('overlay:pull:state') ?? '');
    expect(text).not.toContain(REPO);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('signature-essai');
    expect(alertKeys(ops.opsOk)).toContain('overlay:pull');
    expect(alertKeys(ops.opsFail)).toEqual([]);
  });

  it('redémarrage : état repris, aucun fichier retéléchargé', async () => {
    const before = (await health()).restricted_overlays.pull;
    // Un redémarrage : connexions fermées, mémoires oubliées, fichiers et kv gardés.
    db.closeAll();
    runtime.resetRestrictedOverlayStateForTests();
    pull.resetOverlayPullForTests();
    db.getBicDB();
    complianceDb.getComplianceDB();
    expect(served('bic').state).toBe('applied');
    expect((await health()).restricted_overlays.pull).toEqual(before);

    const attempt = await run();
    expect(attempt.kinds).toEqual({ bic: 'up_to_date', compliance: 'up_to_date' });
    expect(attempt.installed).toEqual([]);
    expect(fake.downloaded()).toEqual(['manifest.json']);
  });

  it('jeton expiré (401) : erreur courte, rien ne change', async () => {
    const shaBefore = sha256File(live.bic);
    fake.token = 'jeton-renouvele';
    const attempt = await run();
    expect(attempt).toMatchObject({ state: 'error', error: 'github_unauthorized', installed: [] });
    expect(fake.requests.filter((r) => r.server === 'storage')).toEqual([]);
    expect(sha256File(live.bic)).toBe(shaBefore);
    expect(served('bic').state).toBe('applied');
    const h = (await health()).restricted_overlays.pull;
    expect(h.state).toBe('error');
    expect(h.error).toBe('github_unauthorized');
    // Encore servie, et d'où elle vient.
    expect(h.bic.release).toBe('surcouche-essai-1');
    // Moins de 24 h sans succès : pas encore d'alerte.
    expect(alertKeys(ops.opsFail)).not.toContain('overlay:pull');
  });

  it('dépôt ou release introuvable (404)', async () => {
    fake.latestStatus = 404;
    expect(await run()).toMatchObject({ state: 'error', error: 'github_not_found' });
    fake.latestStatus = null;
    const release = fake.release;
    fake.release = null;
    expect(await run()).toMatchObject({ state: 'error', error: 'github_not_found' });
    fake.release = release;
  });

  it('empreinte fausse : rien posé, aucun reste, réessayé au tirage suivant', async () => {
    publish('surcouche-essai-2', v2, {
      tweak: (m) => {
        m.files.compliance!.sha256 = 'f'.repeat(64);
      },
    });
    const shaBefore = sha256File(live.compliance);
    const attempt = await run();
    expect(attempt.error).toBe('sha256_mismatch:compliance');
    expect(attempt.kinds).toEqual({ bic: 'installed', compliance: 'error' });
    expect(sha256File(live.compliance)).toBe(shaBefore);
    expect(liveLeftovers()).toEqual([]);
    // Pas marqué refusé : un transfert abîmé se réessaie.
    fake.requests = [];
    await run();
    expect(fake.downloaded()).toEqual(['manifest.json', 'restricted-compliance.sqlite']);
  });

  it('fichier trop gros : annoncé au-delà du plafond, ou plus long que annoncé', async () => {
    const manifest = publish('surcouche-essai-3', v2, {
      tweak: (m) => {
        m.files.bic!.bytes = OVERLAY_DOWNLOAD_MAX_BYTES + 1;
      },
      bodies: {
        compliance: Buffer.concat([readFileSync(v2.compliance), Buffer.alloc(4096, 1)]),
      },
    });
    // Le manifeste annonce le vrai poids de la conformité, le stockage en sert plus.
    expect(manifest.files.compliance!.bytes).toBe(readFileSync(v2.compliance).length);
    const shaBefore = sha256File(live.compliance);
    const attempt = await run();
    // Le fichier BIC v2 est déjà en place (test précédent) : son empreinte suffit
    // à ne rien retirer, le plafond n'entre pas en jeu.
    expect(attempt.kinds.bic).toBe('up_to_date');
    expect(attempt.kinds.compliance).toBe('error');
    expect(attempt.error).toBe('download_too_large:compliance');
    expect(sha256File(live.compliance)).toBe(shaBefore);
    expect(liveLeftovers()).toEqual([]);

    // Une base qui n'est pas déjà servie : le plafond l'arrête avant tout téléchargement.
    publish(
      'surcouche-essai-3b',
      { bic: v1.bic, compliance: v2.compliance },
      {
        tweak: (m) => {
          m.files.bic!.sha256 = 'e'.repeat(64);
          m.files.bic!.bytes = OVERLAY_DOWNLOAD_MAX_BYTES + 1;
        },
      },
    );
    fake.requests = [];
    const second = await run();
    expect(second.error).toBe('file_too_large:bic');
    expect(fake.downloaded()).not.toContain('restricted-bic.sqlite');
  });

  it('surcouche refusée par inspectOverlay : jamais posée, jamais retéléchargée', async () => {
    const garbage = join(fixture.dir, 'pas-une-base.sqlite');
    writeFileSync(garbage, Buffer.alloc(8192, 7));
    publish(
      'surcouche-essai-4',
      { bic: v1.bic, compliance: v2.compliance },
      {
        tweak: (m) => {
          m.files.bic!.sha256 = sha256File(garbage);
          m.files.bic!.bytes = 8192;
        },
        bodies: { bic: readFileSync(garbage) },
      },
    );
    const shaBefore = sha256File(live.bic);
    const attempt = await run();
    expect(attempt.kinds.bic).toBe('error');
    expect(attempt.error).toMatch(/^overlay_refused:bic:overlay_(unreadable|integrity)/);
    expect(sha256File(live.bic)).toBe(shaBefore);
    expect(liveLeftovers()).toEqual([]);
    fake.requests = [];
    const again = await run();
    expect(again.kinds.bic).toBe('refused_before');
    expect(again.error).toBe(attempt.error);
    expect(fake.downloaded()).not.toContain('restricted-bic.sqlite');
  });

  it('surcouche qui perdrait un membre servi : refusée, la servie reste', async () => {
    // Une conformité cohérente avec elle-même, mais sans aucune inscription ONU :
    // sous le plancher du membre `un`, que la surcouche servie porte.
    const shrunk = join(fixture.dir, 'sans-onu.sqlite');
    copyFileSync(v2.compliance, shrunk);
    const d = openDb(shrunk);
    d.prepare("DELETE FROM sanctioned_entities WHERE source_list = 'UN'").run();
    const un = RESTRICTED_FAMILY.find((m) => m.id === 'un')!;
    d.prepare(
      `UPDATE ${OVERLAY_MEMBERS_TABLE} SET rows = 0, content_sha256 = ? WHERE member = 'un'`,
    ).run(memberContentSha256(d, 'main', un));
    d.close();
    const servedBefore = served('compliance');
    expect(servedBefore.members.find((m) => m.id === 'un')?.state).toBe('applied');
    publish(
      'surcouche-essai-5',
      { compliance: v2.compliance },
      {
        tweak: (m) => {
          m.files.compliance = {
            name: 'restricted-compliance.sqlite',
            sha256: sha256File(shrunk),
            bytes: readFileSync(shrunk).length,
            generated_at: new Date().toISOString(),
            public_commit: null,
            members: { un: 0, epc_sepa: 0, epc_vop: 0 },
          };
        },
        bodies: { compliance: readFileSync(shrunk) },
      },
    );
    const attempt = await run();
    expect(attempt.kinds.compliance).toBe('error');
    expect(attempt.error).toMatch(/^members_refused:compliance:un=below_floor:1/);
    expect(served('compliance').sha256).toBe(servedBefore.sha256);
    expect(sha256File(live.compliance)).not.toBe(sha256File(shrunk));
    expect(liveLeftovers()).toEqual([]);
  });

  it('release trop vieille, ou fichier BIC absent : alerte, refermée par une release fraîche', async () => {
    publish('surcouche-essai-6', v1, {
      publishedAt: new Date(Date.now() - 10 * DAY).toISOString(),
    });
    await run();
    expect(alertKeys(ops.opsFail)).toContain('overlay:pull:stale');
    const staleCall = ops.opsFail.mock.calls.find((c) => c[0] === 'overlay:pull:stale')!;
    expect(String(staleCall[1])).toContain('release:10d');

    ops.opsFail.mockClear();
    publish('surcouche-essai-7', { compliance: v1.compliance });
    await run();
    const absent = ops.opsFail.mock.calls.find((c) => c[0] === 'overlay:pull:stale')!;
    expect(String(absent[1])).toContain('bic:absent');

    ops.opsOk.mockClear();
    publish('surcouche-essai-8', v1);
    await run();
    expect(alertKeys(ops.opsOk)).toContain('overlay:pull:stale');
  });

  it('aucun tirage réussi depuis plus de 24 h : alerte, refermée au succès suivant', async () => {
    fake.token = 'jeton-renouvele';
    const later = Date.now() + 25 * 3_600_000;
    const attempt = await run(() => later);
    expect(attempt.error).toBe('github_unauthorized');
    expect(alertKeys(ops.opsFail)).toContain('overlay:pull');
    const call = ops.opsFail.mock.calls.find((c) => c[0] === 'overlay:pull')!;
    expect(String(call[1])).toContain('github_unauthorized');
    expect(String(call[1])).not.toContain(REPO);

    fake.token = TOKEN;
    ops.opsOk.mockClear();
    expect((await run(() => later + 60_000)).state).toBe('ok');
    expect(alertKeys(ops.opsOk)).toContain('overlay:pull');
  });

  it('la veille : rien avant l’heure, jamais deux tirages à la fois', async () => {
    // Le dernier tirage a réussi « plus tard » : le suivant est dû quatre heures après.
    const now = Date.now();
    expect(await pull.overlayPullTick({ apiBase: fake.apiBase, now: () => now })).toEqual([]);
    expect(fake.requests).toEqual([]);

    const due = now + 30 * 3_600_000;
    const first = pull.overlayPullTick({ apiBase: fake.apiBase, now: () => due });
    const second = pull.overlayPullTick({ apiBase: fake.apiBase, now: () => due });
    expect(await second).toEqual([]);
    await first;
    expect(fake.requests.filter((r) => r.path.endsWith('/releases/latest')).length).toBe(1);
  });

  it('variables incomplètes : erreur dite, sans appel réseau', async () => {
    delete process.env[PULL_ENV_TOKEN];
    try {
      expect(await run()).toMatchObject({ state: 'error', error: 'pull_config_incomplete' });
      expect(fake.requests).toEqual([]);
      expect((await health()).restricted_overlays.pull).toMatchObject({
        state: 'error',
        error: 'pull_config_incomplete',
      });
    } finally {
      process.env[PULL_ENV_TOKEN] = TOKEN;
    }
  });

  it('variables retirées : les alertes du tirage se referment une fois', async () => {
    delete process.env[PULL_ENV_REPO];
    delete process.env[PULL_ENV_TOKEN];
    try {
      pull.resetOverlayPullForTests();
      expect(await pull.overlayPullTick()).toEqual([]);
      expect(alertKeys(ops.opsOk)).toEqual(['overlay:pull', 'overlay:pull:stale']);
      ops.opsOk.mockClear();
      pull.resetOverlayPullForTests();
      expect(await pull.overlayPullTick()).toEqual([]);
      expect(ops.opsOk).not.toHaveBeenCalled();
      expect(fake.requests).toEqual([]);
      expect((await health()).restricted_overlays.pull).toEqual({ state: 'off' });
    } finally {
      process.env[PULL_ENV_REPO] = REPO;
      process.env[PULL_ENV_TOKEN] = TOKEN;
    }
  });
});
