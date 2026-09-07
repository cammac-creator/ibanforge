import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import { adminSearchConsole } from './admin-search-console.js';
import {
  resetSearchConsoleAuth,
  resetSearchConsoleCache,
  WITNESS_PATHS,
} from '../lib/search-console.js';
import { getStatsDB } from '../lib/db.js';

/**
 * The three answers of GET /v1/admin/search-console, each with its own status.
 *
 * The 502 matters more than it looks: the dashboard's reader keeps the body of
 * that response on purpose, so what is asserted here is not "it fails loudly"
 * but "it fails with last week's figures attached".
 */
const SECRET = 'test-admin-secret-search-console';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const app = () => new Hono().route('/', adminSearchConsole);
const auth = { headers: { 'X-Admin-Secret': SECRET } };

const json = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function googleUp(): void {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return json({ access_token: 'stub-token', expires_in: 3600 });
    }
    if (String(url).includes('/searchAnalytics/query')) {
      const sent = JSON.parse(String(init?.body)) as { dimensions: string[] };
      return json({
        rows: [
          sent.dimensions[0] === 'date'
            ? { keys: ['2026-08-26'], clicks: 3, impressions: 120, position: 14 }
            : { keys: ['iban checker'], clicks: 3, impressions: 120, position: 14 },
        ],
      });
    }
    if (String(url).includes('/sitemaps')) {
      return json({
        sitemap: [
          {
            path: 'https://ibanforge.com/sitemap.xml',
            contents: [{ submitted: '1394', indexed: '31' }],
          },
        ],
      });
    }
    return json({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } });
  });
}

beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
  process.env.GSC_SA_JSON = JSON.stringify({
    client_email: 'gsc-reader@example.iam.gserviceaccount.com',
    private_key: privateKey,
  });
  resetSearchConsoleAuth();
  getStatsDB().exec('DROP TABLE IF EXISTS search_console_cache');
  resetSearchConsoleCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GSC_SA_JSON;
  resetSearchConsoleAuth();
});

describe('GET /v1/admin/search-console', () => {
  it('is admin only', async () => {
    expect((await app().request('/v1/admin/search-console')).status).toBe(401);
    expect(
      (await app().request('/v1/admin/search-console', { headers: { 'X-Admin-Secret': 'no' } }))
        .status,
    ).toBe(401);
  });

  it('says 503 not_configured rather than failing, on an environment with no key', async () => {
    delete process.env.GSC_SA_JSON;
    const res = await app().request('/v1/admin/search-console', auth);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
  });

  it('serves the summary, its stamp and stale: false', async () => {
    googleUp();
    const res = await app().request('/v1/admin/search-console', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.stale).toBe(false);
    expect(typeof body.fetched_at).toBe('string');
    expect(body.site).toBe('https://ibanforge.com/');
    expect(body.weeks).toHaveLength(4);
    expect((body.inspections as unknown[]).length).toBe(WITNESS_PATHS.length);
  });

  it('answers 502 with the upstream status and NO payload before any reading landed', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'invalid_grant' }, 403));
    const res = await app().request('/v1/admin/search-console', auth);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream', upstream_status: 403, stale: true });
  });

  it('answers 502 WITH the last reading, marked stale, once one exists', async () => {
    googleUp();
    const good = (await (await app().request('/v1/admin/search-console', auth)).json()) as Record<
      string,
      unknown
    >;
    vi.stubGlobal('fetch', async () => json({ error: 'rateLimitExceeded' }, 429));
    const res = await app().request('/v1/admin/search-console?refresh=1', auth);
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: 'upstream', upstream_status: 429, stale: true });
    expect(body.weeks).toEqual(good.weeks);
    expect(body.fetched_at).toBe(good.fetched_at);
  });
});
