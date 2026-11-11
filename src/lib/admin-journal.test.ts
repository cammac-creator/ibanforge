import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { SCOPED_ADMIN_KEYS } from './admin-auth.js';
import { purgeAdminCalls } from './admin-journal.js';
import { closeAll, getStatsDB } from './db.js';
import { hashIp } from './stats.js';

/**
 * C10 (audit SEC-01#3) : chaque passage à la porte d'administration laisse une
 * ligne dans `admin_calls`, accepté ou refusé, avec la route sous sa forme de
 * gabarit, le nom de la clé, l'empreinte salée de l'adresse et le statut de la
 * réponse ; jamais un corps, jamais un secret. Contre l'application entière
 * (`buildApp`) : le limiteur de débit, le gestionnaire d'erreurs et le tampon de
 * compression sont ceux de la production.
 */
const SECRET = 'full-admin-secret-for-the-journal-test-0123456789';
const SITE = 'site-key-for-the-journal-test-0123456789';
const KEY_NAMES = Object.keys(SCOPED_ADMIN_KEYS);
const avant: Record<string, string | undefined> = {};

interface Row {
  id: number;
  created_at: string;
  method: string;
  route: string;
  scope: string | null;
  presented: number;
  ip_hash: string | null;
  status: number | null;
}

const app = buildApp();
let ipSeq = 0;
/** Une adresse par requête : le limiteur compte par adresse. */
const nextIp = () => `192.0.2.${++ipSeq}`;

function rowsSince(id: number): Row[] {
  return getStatsDB()
    .prepare('SELECT * FROM admin_calls WHERE id > ? ORDER BY id')
    .all(id) as Row[];
}
function lastId(): number {
  return (
    (getStatsDB().prepare('SELECT MAX(id) AS id FROM admin_calls').get() as { id: number | null })
      .id ?? 0
  );
}

async function call(
  path: string,
  opts: { method?: string; key?: string; body?: string; ip?: string } = {},
): Promise<{ res: Response; rows: Row[]; ip: string }> {
  const before = lastId();
  const ip = opts.ip ?? nextIp();
  const headers: Record<string, string> = { 'x-forwarded-for': ip };
  if (opts.key !== undefined) headers['X-Admin-Secret'] = opts.key;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  await res.arrayBuffer();
  return { res, rows: rowsSince(before), ip };
}

beforeAll(() => {
  for (const name of ['ADMIN_SECRET', ...KEY_NAMES]) {
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
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the admin journal', () => {
  it('a successful POST /v1/admin/keys writes one row: route, scope, salted source, 201, no body, no secret', async () => {
    const { res, rows, ip } = await call('/v1/admin/keys', {
      method: 'POST',
      key: SECRET,
      body: JSON.stringify({ email: 'acme@example.com', monthly_limit: 500 }),
    });
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      method: 'POST',
      route: '/v1/admin/keys',
      scope: 'full',
      presented: 1,
      ip_hash: hashIp(ip),
      status: 201,
    });
    expect(row.ip_hash).not.toBeNull();
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const text = JSON.stringify(row);
    for (const forbidden of [SECRET, 'acme', '500', ip]) expect(text).not.toContain(forbidden);
  });

  it('a scoped key is named by its variable, never by its value', async () => {
    const { res, rows } = await call('/v1/admin/keys', { key: SITE });
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      route: '/v1/admin/keys',
      scope: 'SITE_ADMIN_TOKEN',
      status: 200,
    });
    expect(JSON.stringify(rows[0])).not.toContain(SITE);
  });

  it('refusals enter too: 403 for a scoped key outside its list, 401 for an unknown or absent secret', async () => {
    const outside = await call('/v1/admin/keys', {
      method: 'POST',
      key: SITE,
      body: JSON.stringify({ email: 'acme@example.com' }),
    });
    expect(outside.res.status).toBe(403);
    expect(outside.rows).toHaveLength(1);
    expect(outside.rows[0]).toMatchObject({ scope: 'SITE_ADMIN_TOKEN', status: 403, presented: 1 });

    const wrong = await call('/v1/admin/keys', { key: 'definitely-not-the-secret' });
    expect(wrong.res.status).toBe(401);
    expect(wrong.rows).toHaveLength(1);
    expect(wrong.rows[0]).toMatchObject({ scope: null, status: 401, presented: 1 });
    expect(JSON.stringify(wrong.rows[0])).not.toContain('definitely-not-the-secret');

    const none = await call('/v1/admin/keys');
    expect(none.res.status).toBe(401);
    expect(none.rows).toHaveLength(1);
    expect(none.rows[0]).toMatchObject({ scope: null, status: 401, presented: 0 });
  });

  it('the status is the one the route answered after the gate (400 on an unreadable body)', async () => {
    const { res, rows } = await call('/v1/admin/keys', {
      method: 'POST',
      key: SECRET,
      body: 'pas du json',
    });
    expect(res.status).toBe(400);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: 'full', status: 400 });
  });

  it('keeps the route template, never the requested address nor its query string', async () => {
    const delivery = await call('/v1/admin/stripe/delivery/cs_test_journal123?reveal=1', {
      key: 'definitely-not-the-secret',
    });
    expect(delivery.rows).toHaveLength(1);
    expect(delivery.rows[0].route).toBe('/v1/admin/stripe/delivery/:session_id');
    expect(JSON.stringify(delivery.rows[0])).not.toContain('cs_test_journal123');

    const mail = await call('/v1/admin/test-email?to=acme@example.com', {
      method: 'POST',
      key: 'definitely-not-the-secret',
      body: '{}',
    });
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0].route).toBe('/v1/admin/test-email');
    expect(JSON.stringify(mail.rows[0])).not.toContain('acme');
  });

  // Le limiteur de débit lit la même table des clés (`isAdminAuthorizedFor`) : les
  // « une seule ligne » ci-dessus disent qu'il n'en écrit pas une seconde.

  it('never fails an admin request when the journal cannot write', async () => {
    const db = getStatsDB();
    const real = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('admin_calls')) throw new Error('journal en panne (essai)');
      return real(sql);
    }) as typeof db.prepare);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'x-forwarded-for': nextIp(),
        'content-type': 'application/json',
        'X-Admin-Secret': SECRET,
      },
      // Une autre adresse que le premier essai : une création par adresse et par jour.
      body: JSON.stringify({ email: 'ops@alpha.example.net' }),
    });
    expect(ok.status).toBe(201);
    const refused = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'x-forwarded-for': nextIp(),
        'content-type': 'application/json',
        'X-Admin-Secret': SITE,
      },
      body: JSON.stringify({ email: 'acme@example.com' }),
    });
    expect(refused.status).toBe(403);
    expect(errors.mock.calls.some((c) => String(c[0]).includes('[admin-journal]'))).toBe(true);
  });

  it('is purged after twelve months, like request_log', () => {
    const db = getStatsDB();
    const insert = db.prepare(
      `INSERT INTO admin_calls (created_at, method, route, scope, presented, ip_hash, status)
       VALUES (?, 'GET', '/v1/admin/retention-test', 'full', 1, NULL, 200)`,
    );
    insert.run('2020-01-01 00:00:00');
    insert.run(new Date().toISOString().replace('T', ' ').slice(0, 19));
    expect(purgeAdminCalls()).toBeGreaterThanOrEqual(1);
    const left = db
      .prepare(`SELECT created_at FROM admin_calls WHERE route = '/v1/admin/retention-test'`)
      .all() as Array<{ created_at: string }>;
    expect(left).toHaveLength(1);
    expect(left[0].created_at.startsWith('2020')).toBe(false);
  });
});
