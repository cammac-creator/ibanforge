/**
 * `POST /v1/admin/dashboard-login-alert` (WEB-01, lot C11) : le site prévient le
 * propriétaire d'une connexion à son tableau de bord par le bot de l'API.
 *
 * Tenu ici : le secret d'administration reste la seule porte ; une adresse
 * complète (IPv4 ou IPv6) est refusée et rien ne part ; le message porte l'heure
 * suisse et l'indice masqué, jamais une adresse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { adminLoginAlert, loginAlertText, parseLoginAlert } from './admin-login-alert.js';

const SECRET = 'correct-horse-battery-staple';
const realFetch = globalThis.fetch;

function app(): Hono {
  const a = new Hono();
  a.route('/', adminLoginAlert);
  return a;
}

async function post(body: unknown, secret: string | null = SECRET): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['X-Admin-Secret'] = secret;
  return app().request('/v1/admin/dashboard-login-alert', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let alerts: string[] = [];

beforeEach(() => {
  alerts = [];
  vi.stubEnv('ADMIN_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'jeton-fictif');
  vi.stubEnv('TELEGRAM_CHAT_ID', '424242');
  vi.stubEnv('OPS_ALERTS_DISABLED', '');
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    alerts.push((JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text ?? '');
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
  // L'horloge de l'API à l'instant de la connexion : `at` est borné autour d'elle.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(AT));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// 14:03 UTC le 10.11.2026 : 15:03 en Suisse (heure d'hiver, UTC+1).
const AT = '2026-11-10T14:03:00.000Z';
const LOGIN = { event: 'login_ok', network: '198.51.x.x', at: AT };

describe('POST /v1/admin/dashboard-login-alert', () => {
  it('refuses without the admin secret or with a wrong one, and sends nothing', async () => {
    expect((await post(LOGIN, null)).status).toBe(401);
    expect((await post(LOGIN, 'pas-le-bon')).status).toBe(401);
    expect(alerts).toHaveLength(0);
  });

  it('sends a successful login with the Swiss time and the masked network', async () => {
    const res = await post(LOGIN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('connexion au tableau de bord');
    expect(alerts[0]).toContain('Le 10.11 à 15:03 (heure suisse)');
    expect(alerts[0]).toContain('réseau 198.51.x.x');
    expect(alerts[0]).toContain("Si ce n'est pas vous");
  });

  it.each(['2001:db8::/32', 'inconnu', '0.0.x.x', '255.255.x.x'])(
    'accepts the masked form %j',
    async (network) => {
      expect((await post({ ...LOGIN, network })).status).toBe(200);
      expect(alerts[0]).toContain(`réseau ${network}`);
    },
  );

  it.each([
    '198.51.100.7',
    '198.51.100.x',
    '2001:db8::1',
    '2001:db8:0:0:0:0:0:1',
    '::ffff:192.0.2.1',
    '2001:db8:1::/48',
    '256.1.x.x',
    '',
    'inconnu, 198.51.100.7',
  ])('refuses the unmasked network %j and sends nothing', async (network) => {
    const res = await post({ ...LOGIN, network });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'network_not_masked' });
    // Le refus ne renvoie jamais la valeur reçue.
    if (network) expect(text).not.toContain(network);
    expect(alerts).toHaveLength(0);
  });

  it('sends the global ceiling once, with its counts and the reopening time', async () => {
    const res = await post({
      event: 'global_cap',
      at: AT,
      until: '2026-11-10T15:01:00.000Z',
      failures: 60,
      addresses: 12,
    });
    expect(res.status).toBe(200);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('plafond des connexions atteint');
    expect(alerts[0]).toContain("60 mots de passe faux en moins d'une heure");
    expect(alerts[0]).toContain('depuis 12 adresses');
    expect(alerts[0]).toContain("jusqu'au 10.11 à 16:01");
  });

  it.each([
    ['not json', 'invalid_json'],
    [{ event: 'login_ok', network: '198.51.x.x' }, 'invalid_at'],
    [{ ...LOGIN, at: 'hier' }, 'invalid_at'],
    [{ ...LOGIN, event: 'autre' }, 'unknown_event'],
    [{ event: 'global_cap', at: AT, until: AT, failures: 0, addresses: 1 }, 'invalid_global_cap'],
    [{ event: 'global_cap', at: AT, until: AT, failures: 1.5, addresses: 1 }, 'invalid_global_cap'],
    [{ event: 'global_cap', at: AT, failures: 60, addresses: 1 }, 'invalid_global_cap'],
    // `at` borné autour de l'horloge de l'API : ni l'an prochain, ni la veille,
    // ni seize minutes d'avance.
    [{ ...LOGIN, at: '2027-11-10T14:03:00.000Z' }, 'invalid_at'],
    [{ ...LOGIN, at: '2026-11-09T14:03:00.000Z' }, 'invalid_at'],
    [{ ...LOGIN, at: '2026-11-10T14:19:00.000Z' }, 'invalid_at'],
    // `until` jamais avant `at`, ni plus de deux heures après.
    [
      {
        event: 'global_cap',
        at: AT,
        until: '2026-11-10T14:02:59.000Z',
        failures: 60,
        addresses: 2,
      },
      'invalid_global_cap',
    ],
    [
      {
        event: 'global_cap',
        at: AT,
        until: '2026-11-10T16:03:01.000Z',
        failures: 60,
        addresses: 2,
      },
      'invalid_global_cap',
    ],
    [
      {
        event: 'global_cap',
        at: AT,
        until: '2027-11-10T14:03:00.000Z',
        failures: 60,
        addresses: 2,
      },
      'invalid_global_cap',
    ],
  ])('refuses a malformed body (%j) and sends nothing', async (body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(alerts).toHaveLength(0);
  });

  it('accepts an instant within the clock tolerance, and a closure of up to two hours', async () => {
    const near = '2026-11-10T13:49:00.000Z'; // quatorze minutes plus tôt
    expect((await post({ ...LOGIN, at: near })).status).toBe(200);
    const cap = await post({
      event: 'global_cap',
      at: AT,
      until: '2026-11-10T16:03:00.000Z',
      failures: 60,
      addresses: 2,
    });
    expect(cap.status).toBe(200);
    expect(alerts).toHaveLength(2);
  });

  it('answers sent: false, without failing, when the alert channel is not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    const res = await post(LOGIN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: false });
    expect(alerts).toHaveLength(0);
  });
});

describe('loginAlertText', () => {
  it('uses summer time between the last Sundays of March and October', () => {
    const summer = '2026-07-01T10:00:00.000Z';
    const parsed = parseLoginAlert({ ...LOGIN, at: summer }, Date.parse(summer));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(loginAlertText(parsed.alert)).toContain('Le 01.07 à 12:00');
  });

  it('says "1 adresse" in the singular', () => {
    const parsed = parseLoginAlert({
      event: 'global_cap',
      at: AT,
      until: AT,
      failures: 60,
      addresses: 1,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(loginAlertText(parsed.alert)).toContain('depuis 1 adresse ');
  });
});
