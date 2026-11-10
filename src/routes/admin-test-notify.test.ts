/**
 * `POST /v1/admin/test-notify` — the owner's way to see the purchase alert of
 * a real key without waiting for the next payment (10/11/2026).
 *
 * Held here: the admin guard is still the only way in, a malformed prefix
 * falls back to the placeholder instead of reaching the base, and the HTTP
 * answer never carries the label itself, only whether one was found.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { upsertCompanyProfile } from '../lib/company-profiles.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { UNNAMED_CLIENT, clientRecordUrl } from '../lib/notify.js';

const SECRET = 'correct-horse-battery-staple';
const RUN = Date.now();
const ADDRESS = `achats-${RUN}@alpha.example.net`;
const PREFIX = `ifk_${String(RUN).slice(-8)}`;
const realFetch = globalThis.fetch;

function app(): Hono {
  const a = new Hono();
  a.route('/', apiKeys);
  return a;
}

let alerts: string[] = [];

beforeEach(() => {
  alerts = [];
  vi.stubEnv('ADMIN_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'jeton-fictif');
  vi.stubEnv('TELEGRAM_CHAT_ID', '424242');
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    alerts.push((JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text ?? '');
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

afterAll(() => closeAll());

upsertCompanyProfile({ email: ADDRESS, company: 'Société Alpha', source: 'site' });
getStatsDB()
  .prepare('INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)')
  .run(`admin-test-notify-${RUN}`, PREFIX, ADDRESS);

describe('POST /v1/admin/test-notify', () => {
  it('refuses without the admin secret, and sends nothing', async () => {
    const none = await app().request(`/v1/admin/test-notify?key_prefix=${PREFIX}`, {
      method: 'POST',
    });
    expect(none.status).toBe(401);
    const wrong = await app().request(`/v1/admin/test-notify?key_prefix=${PREFIX}`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': 'pas-le-bon' },
    });
    expect(wrong.status).toBe(401);
    expect(alerts).toHaveLength(0);
  });

  it("dresses the test as a real key's alert, and keeps the label out of the answer", async () => {
    const res = await app().request(`/v1/admin/test-notify?key_prefix=${PREFIX}`, {
      method: 'POST',
      headers: { 'X-Admin-Secret': SECRET },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ sent: true, key_prefix: PREFIX, client_named: true });
    expect(text).not.toContain('Alpha');
    expect(text).not.toContain('@');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].split('\n')).toContain('Client : Société Alpha');
    expect(alerts[0]).toContain(clientRecordUrl(PREFIX));
    expect(alerts[0]).not.toContain('@');
  });

  it.each(['', 'ifk_', 'ifk_ZZZZZZZZ', "ifk_0000000' OR 1=1", `${PREFIX}0`, 'autre_chose'])(
    'falls back to the placeholder for the malformed prefix %j',
    async (wanted) => {
      const res = await app().request(
        `/v1/admin/test-notify?key_prefix=${encodeURIComponent(wanted)}`,
        { method: 'POST', headers: { 'X-Admin-Secret': SECRET } },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        sent: true,
        key_prefix: 'ifk_test0000',
        client_named: false,
      });
      expect(alerts[0]).toContain(`Client : ${UNNAMED_CLIENT}`);
      expect(alerts[0]).toContain(clientRecordUrl('ifk_test0000'));
    },
  );

  it('works as before without the parameter', async () => {
    const res = await app().request('/v1/admin/test-notify', {
      method: 'POST',
      headers: { 'X-Admin-Secret': SECRET },
    });
    expect(await res.json()).toMatchObject({ sent: true, key_prefix: 'ifk_test0000' });
  });
});
