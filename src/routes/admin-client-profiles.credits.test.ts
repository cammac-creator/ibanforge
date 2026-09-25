/**
 * Le CRM affiche chaque valeur de `quota_warned_by_key` comme « avertie à 80 %
 * en <mois> ». L'avertissement des packs partage `quota_notices` sous une clé
 * `credits-` : la liste doit l'écarter, sinon le porteur d'un pack se lirait
 * « averti à 80 % en credits-1000 ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { generateApiKey, recordQuotaNotice, validateApiKey } from '../lib/api-keys.js';
import { creditsNoticeLock } from '../lib/quota-notice.js';
import { closeAll } from '../lib/db.js';
import type { HonoEnv } from '../types.js';

const SECRET = 'test-admin-secret-client-profiles';
let envSecret: string | undefined;

beforeAll(() => {
  envSecret = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = SECRET;
});

afterAll(() => {
  if (envSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = envSecret;
  closeAll();
});

describe('GET /v1/admin/client-profiles, quota_warned_by_key', () => {
  it('lists the months a key was warned in, and nothing else', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const raw = generateApiKey(`acp-${Date.now()}@example.com`)!.api_key;
    const { keyHash } = validateApiKey(raw);
    const prefix = raw.slice(0, 12);

    recordQuotaNotice(keyHash, '2030-04');
    recordQuotaNotice(keyHash, creditsNoticeLock(1000));

    const res = await app.request('/v1/admin/client-profiles', {
      headers: { 'X-Admin-Secret': SECRET },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quota_warned_by_key: Record<string, string[]> };
    expect(body.quota_warned_by_key[prefix]).toEqual(['2030-04']);
  });
});
