import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * C10 (audit SEC-01#3, version réduite du contradicteur) : les alertes des entrées
 * d'administration, contre l'application entière. Le canal d'exploitation est
 * remplacé par des espions : on compte les appels, on lit les textes.
 */
const ops = vi.hoisted(() => ({
  opsFail: vi.fn(async () => {}),
  opsOk: vi.fn(async () => {}),
  notifyOps: vi.fn(async () => true),
}));
vi.mock('./ops-alert.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ops-alert.js')>()),
  ...ops,
}));

const { buildApp } = await import('../app.js');
const { SCOPED_ADMIN_KEYS, BACKUP_ROUTE } = await import('./admin-auth.js');
const {
  EVENT_ALERTS_PER_HOUR,
  REFUSAL_BURST_ALERT,
  REFUSAL_BURST_THRESHOLD,
  REFUSAL_BURST_WINDOW_MS,
  adminEventAlert,
  closeAdminAlertEpisodesAtBoot,
  resetAdminAlerts,
} = await import('./admin-alerts.js');
const { LOGIN_ALERT_CAPPED } = await import('./admin-site-caps.js');
const { closeAll, getStatsDB } = await import('./db.js');
const { generateApiKey } = await import('./api-keys.js');
const { hashIp } = await import('./stats.js');

const SECRET = 'full-admin-secret-for-the-alerts-test-0123456789';
const SITE = 'site-key-for-the-alerts-test-0123456789';
const BACKUP = 'backup-key-for-the-alerts-test-0123456789';
const NAMES = ['ADMIN_SECRET', ...Object.keys(SCOPED_ADMIN_KEYS)];
const avant: Record<string, string | undefined> = {};

const app = buildApp();
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

async function send(
  path: string,
  opts: { method?: string; key?: string; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? nextIp() };
  if (opts.key !== undefined) headers['X-Admin-Secret'] = opts.key;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  await res.arrayBuffer();
  return res;
}

/** Tous les textes passés au canal d'exploitation, alertes d'épisode comprises. */
function texts(): string[] {
  return [
    ...ops.notifyOps.mock.calls.map((c) => String((c as unknown[])[0])),
    ...ops.opsFail.mock.calls.map(
      (c) => `${String((c as unknown[])[0])} ${String((c as unknown[])[1])}`,
    ),
  ];
}

beforeAll(() => {
  for (const name of NAMES) {
    avant[name] = process.env[name];
    delete process.env[name];
  }
  process.env.ADMIN_SECRET = SECRET;
  process.env.SITE_ADMIN_TOKEN = SITE;
  process.env.BACKUP_TOKEN = BACKUP;
});
afterAll(() => {
  for (const [name, value] of Object.entries(avant)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  closeAll();
});
beforeEach(() => {
  resetAdminAlerts();
  ops.opsFail.mockClear();
  ops.opsOk.mockClear();
  ops.notifyOps.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Rien d'une adresse, d'un e-mail ni d'une clé dans ce qui part vers le canal. */
function expectNoPersonalData(extra: string[] = []): void {
  for (const text of texts()) {
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/ifk_[0-9a-f]/);
    for (const secret of [SECRET, SITE, BACKUP, ...extra]) expect(text).not.toContain(secret);
  }
}

describe('a burst of refusals from one source', () => {
  it('ten 401 from the same source raise ONE opsFail, whatever follows in the same burst', async () => {
    const ip = nextIp();
    for (let i = 0; i < REFUSAL_BURST_THRESHOLD - 1; i++) {
      expect((await send('/v1/admin/keys', { key: 'not-the-secret', ip })).status).toBe(401);
    }
    expect(ops.opsFail).not.toHaveBeenCalled();
    expect((await send('/v1/admin/keys', { key: 'not-the-secret', ip })).status).toBe(401);
    expect(ops.opsFail).toHaveBeenCalledTimes(1);
    expect((ops.opsFail.mock.calls[0] as unknown[])[0]).toBe(REFUSAL_BURST_ALERT);
    for (let i = 0; i < 5; i++) await send('/v1/admin/keys', { key: 'not-the-secret', ip });
    expect(ops.opsFail).toHaveBeenCalledTimes(1);
    expectNoPersonalData([ip, String(hashIp(ip))]);
  });

  it('403 count as refusals too, and ten spread over many sources raise nothing', async () => {
    for (let i = 0; i < REFUSAL_BURST_THRESHOLD; i++) {
      expect(
        (await send('/v1/admin/keys', { method: 'POST', key: SITE, body: {}, ip: nextIp() }))
          .status,
      ).toBe(403);
    }
    expect(ops.opsFail).not.toHaveBeenCalled();
    const ip = nextIp();
    for (let i = 0; i < REFUSAL_BURST_THRESHOLD; i++) {
      await send('/v1/admin/keys', { method: 'POST', key: SITE, body: {}, ip });
    }
    expect(ops.opsFail).toHaveBeenCalledTimes(1);
  });

  it('closes the episode once the source is quiet, and a second burst alerts again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-11-11T10:00:00Z').getTime();
    vi.setSystemTime(start);
    const ip = nextIp();
    for (let i = 0; i < REFUSAL_BURST_THRESHOLD; i++) await send('/v1/admin/keys', { ip });
    expect(ops.opsFail).toHaveBeenCalledTimes(1);
    expect(ops.opsOk).not.toHaveBeenCalled();

    vi.setSystemTime(start + REFUSAL_BURST_WINDOW_MS + 60_000);
    expect((await send('/v1/admin/keys', { key: SECRET })).status).toBe(200);
    expect(ops.opsOk).toHaveBeenCalledTimes(1);
    expect((ops.opsOk.mock.calls[0] as unknown[])[0]).toBe(REFUSAL_BURST_ALERT);

    for (let i = 0; i < REFUSAL_BURST_THRESHOLD; i++) await send('/v1/admin/keys', { ip });
    expect(ops.opsFail).toHaveBeenCalledTimes(2);
  });

  it('never locks anyone out: the full secret still opens from the source in burst', async () => {
    const ip = nextIp();
    for (let i = 0; i < REFUSAL_BURST_THRESHOLD + 2; i++) await send('/v1/admin/keys', { ip });
    expect((await send('/v1/admin/keys', { key: SECRET, ip })).status).toBe(200);
  });
});

describe('the event alerts', () => {
  it('a key created by the administration alerts, without address, key nor prefix', async () => {
    const res = await send('/v1/admin/keys', {
      method: 'POST',
      key: SECRET,
      body: { email: 'acme@example.com' },
    });
    expect(res.status).toBe(201);
    expect(ops.notifyOps).toHaveBeenCalledTimes(1);
    expect(texts()[0]).toContain('POST /v1/admin/keys');
    expect(texts()[0]).toContain('ADMIN_SECRET');
    expectNoPersonalData();
  });

  it('a refused or failed creation alerts nothing', async () => {
    await send('/v1/admin/keys', {
      method: 'POST',
      key: SECRET,
      body: { email: 'pas-une-adresse' },
    });
    await send('/v1/admin/keys', {
      method: 'POST',
      key: SITE,
      body: { email: 'ops@alpha.example.net' },
    });
    expect(ops.notifyOps).not.toHaveBeenCalled();
  });

  it('an imported key alerts', async () => {
    const raw = `ifk_${createHash('sha256').update('alerts-import-fixture').digest('hex')}`;
    const res = await send('/v1/admin/keys/import', {
      method: 'POST',
      key: SECRET,
      body: { api_key: raw, email: 'ops@alpha.example.net' },
    });
    expect(res.status).toBe(201);
    expect(ops.notifyOps).toHaveBeenCalledTimes(1);
    expect(texts()[0]).toContain('POST /v1/admin/keys/import');
    expectNoPersonalData([raw]);
  });

  it('a raised limit alerts at each use, naming the key that opened', async () => {
    const k = generateApiKey('raise@alpha.example.net');
    if (!k) throw new Error('fixture key not minted');
    const res = await send('/v1/admin/keys/raise-limit', {
      method: 'POST',
      key: SITE,
      body: { key_prefix: k.key_prefix, monthly_limit: 1000 },
    });
    expect(res.status).toBe(200);
    expect(ops.notifyOps).toHaveBeenCalledTimes(1);
    expect(texts()[0]).toContain('POST /v1/admin/keys/raise-limit');
    expect(texts()[0]).toContain('SITE_ADMIN_TOKEN');
    expectNoPersonalData([k.key_prefix]);
  });

  it('caps one kind at EVENT_ALERTS_PER_HOUR messages an hour, then says how many were held back', () => {
    const t0 = Date.parse('2026-11-11T12:00:00Z');
    for (let i = 0; i < EVENT_ALERTS_PER_HOUR + 2; i++)
      adminEventAlert('test:kind', `n°${i}`, t0 + i);
    expect(ops.notifyOps).toHaveBeenCalledTimes(EVENT_ALERTS_PER_HOUR);
    adminEventAlert('test:kind', 'après l’heure', t0 + 60 * 60_000 + 1);
    expect(ops.notifyOps).toHaveBeenCalledTimes(EVENT_ALERTS_PER_HOUR + 1);
    expect(texts()[EVENT_ALERTS_PER_HOUR]).toContain('2 alerte(s) du même type tue(s)');
  });
});

describe('a backup launched outside its usual hours', () => {
  /** Des sauvegardes réussies passées, à 02:05 UTC les jours d'avant `day`. */
  function seedNightlyBackups(day: string, nights: number): void {
    const insert = getStatsDB().prepare(
      `INSERT INTO admin_calls (created_at, method, route, scope, presented, ip_hash, status)
       VALUES (?, 'GET', ?, 'BACKUP_TOKEN', 1, NULL, 200)`,
    );
    for (let n = 1; n <= nights; n++) {
      const d = new Date(Date.parse(`${day}T02:05:00Z`) - n * 24 * 60 * 60_000);
      insert.run(d.toISOString().replace('T', ' ').slice(0, 19), BACKUP_ROUTE);
    }
  }

  it('alerts at 14:00 when the journal knows three nightly backups around 02:00, never in the night', async () => {
    getStatsDB().prepare('DELETE FROM admin_calls WHERE route = ?').run(BACKUP_ROUTE);
    seedNightlyBackups('2026-10-20', 3);
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(new Date('2026-10-20T02:40:00Z'));
    expect((await send(BACKUP_ROUTE, { key: BACKUP })).status).toBe(200);
    expect(ops.notifyOps).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-10-20T14:00:00Z'));
    expect((await send(BACKUP_ROUTE, { key: SECRET })).status).toBe(200);
    expect(ops.notifyOps).toHaveBeenCalledTimes(1);
    expect(texts()[0]).toContain('14:00 UTC');
    expect(texts()[0]).toContain('vers 02 h UTC');
    expect(texts()[0]).toContain('ADMIN_SECRET');
    expectNoPersonalData();
  });

  it('tolerates the hour a clock change moves a job set on Swiss time (85 minutes late)', async () => {
    getStatsDB().prepare('DELETE FROM admin_calls WHERE route = ?').run(BACKUP_ROUTE);
    seedNightlyBackups('2026-10-26', 3);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T03:30:00Z'));
    expect((await send(BACKUP_ROUTE, { key: BACKUP })).status).toBe(200);
    expect(ops.notifyOps).not.toHaveBeenCalled();
  });

  it('judges nothing while the journal knows fewer than three backups', async () => {
    getStatsDB().prepare('DELETE FROM admin_calls WHERE route = ?').run(BACKUP_ROUTE);
    seedNightlyBackups('2026-09-20', 2);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T14:00:00Z'));
    expect((await send(BACKUP_ROUTE, { key: BACKUP })).status).toBe(200);
    expect(ops.notifyOps).not.toHaveBeenCalled();
  });
});

describe('the episode alerts at boot', () => {
  it('closes both episode alerts, whose open state outlives a restart in kv_state', () => {
    closeAdminAlertEpisodesAtBoot();
    const keys = ops.opsOk.mock.calls.map((c) => (c as unknown[])[0]);
    expect(keys).toEqual(expect.arrayContaining([REFUSAL_BURST_ALERT, LOGIN_ALERT_CAPPED]));
    expect(ops.opsFail).not.toHaveBeenCalled();
  });
});
