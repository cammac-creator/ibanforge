import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit C10, section 5 (11.11.2026) : les deux écritures de la liste du site qui
 * partent sur le réseau depuis l'API ont un plafond propre pour la clé du site.
 * Le balayage des forums et l'envoi Telegram sont remplacés par des espions.
 */
const ops = vi.hoisted(() => ({
  notifyOps: vi.fn(async () => true),
  opsFail: vi.fn(async () => {}),
  opsOk: vi.fn(async () => {}),
}));
vi.mock('./ops-alert.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ops-alert.js')>()),
  ...ops,
}));
const radar = vi.hoisted(() => ({
  runScan: vi.fn(async () => {}),
  lastScanInfo: vi.fn(() => ({ scanning: false })),
}));
vi.mock('./forum-radar-server.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./forum-radar-server.js')>()),
  ...radar,
}));

const { buildApp } = await import('../app.js');
const { SCOPED_ADMIN_KEYS } = await import('./admin-auth.js');
const { SITE_KEY_CAPS, resetSiteKeyCaps } = await import('./admin-site-caps.js');
const { LOGIN_ALERT_CAPPED } = await import('../routes/admin-login-alert.js');
const { closeAll } = await import('./db.js');

const SECRET = 'full-secret-for-the-caps-test-0123456789';
const SITE = 'site-key-for-the-caps-test-0123456789';
const avant: Record<string, string | undefined> = {};
const app = buildApp();
let ipSeq = 0;

async function post(path: string, key: string, body: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'x-forwarded-for': `192.0.2.${(++ipSeq % 250) + 1}`,
      'content-type': 'application/json',
      'X-Admin-Secret': key,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const loginOk = () => ({ event: 'login_ok', network: '198.51.x.x', at: new Date().toISOString() });

beforeAll(() => {
  for (const name of ['ADMIN_SECRET', ...Object.keys(SCOPED_ADMIN_KEYS)]) {
    avant[name] = process.env[name];
    delete process.env[name];
  }
  process.env.ADMIN_SECRET = SECRET;
  process.env.SITE_ADMIN_TOKEN = SITE;
});
afterAll(() => {
  for (const [name, value] of Object.entries(avant)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  closeAll();
});
beforeEach(() => {
  resetSiteKeyCaps();
  for (const fn of [...Object.values(ops), radar.runScan]) fn.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the site key login alerts are capped', () => {
  it('sends the first SITE_KEY_CAPS alerts, then answers 429, says so once, and reopens the next hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
    const { max } = SITE_KEY_CAPS['dashboard-login-alert'];
    for (let i = 0; i < max; i++) {
      expect((await post('/v1/admin/dashboard-login-alert', SITE, loginOk())).status).toBe(200);
    }
    expect(ops.notifyOps).toHaveBeenCalledTimes(max);
    const over = await post('/v1/admin/dashboard-login-alert', SITE, loginOk());
    expect(over.status).toBe(429);
    await post('/v1/admin/dashboard-login-alert', SITE, loginOk());
    expect(ops.notifyOps).toHaveBeenCalledTimes(max);
    expect(ops.opsFail).toHaveBeenCalledTimes(1);
    expect((ops.opsFail.mock.calls[0] as unknown[])[0]).toBe(LOGIN_ALERT_CAPPED);

    // Le secret complet n'est pas plafonné.
    expect((await post('/v1/admin/dashboard-login-alert', SECRET, loginOk())).status).toBe(200);

    vi.setSystemTime(new Date('2026-11-11T11:00:01Z'));
    expect((await post('/v1/admin/dashboard-login-alert', SITE, loginOk())).status).toBe(200);
    expect(ops.opsOk).toHaveBeenCalledTimes(1);
    expect((ops.opsOk.mock.calls[0] as unknown[])[0]).toBe(LOGIN_ALERT_CAPPED);
  });

  it('a refused body does not spend a slot', async () => {
    const { max } = SITE_KEY_CAPS['dashboard-login-alert'];
    for (let i = 0; i < max + 3; i++) {
      expect((await post('/v1/admin/dashboard-login-alert', SITE, { event: 'x' })).status).toBe(
        400,
      );
    }
    expect((await post('/v1/admin/dashboard-login-alert', SITE, loginOk())).status).toBe(200);
  });
});

describe('the site key forum scans are capped', () => {
  it('launches SITE_KEY_CAPS scans an hour, then 429 with a reason the CRM shows', async () => {
    const { max } = SITE_KEY_CAPS['forum-scan'];
    for (let i = 0; i < max; i++) {
      const res = await post('/v1/admin/forum-scan', SITE, { what: 'threads' });
      expect(res.status).toBe(200);
      expect(res.body.started).toBe(true);
    }
    const over = await post('/v1/admin/forum-scan', SITE, { what: 'threads' });
    expect(over.status).toBe(429);
    expect(over.body.started).toBe(false);
    expect(typeof over.body.reason).toBe('string');
    expect(radar.runScan).toHaveBeenCalledTimes(max);
    // Le secret complet garde la main.
    expect((await post('/v1/admin/forum-scan', SECRET, { what: 'threads' })).status).toBe(200);
  });

  it('a scan already running answers 409 without spending a slot', async () => {
    radar.lastScanInfo.mockReturnValue({ scanning: true });
    const { max } = SITE_KEY_CAPS['forum-scan'];
    for (let i = 0; i < max + 2; i++) {
      expect((await post('/v1/admin/forum-scan', SITE, {})).status).toBe(409);
    }
    radar.lastScanInfo.mockReturnValue({ scanning: false });
    expect((await post('/v1/admin/forum-scan', SITE, {})).status).toBe(200);
  });
});
