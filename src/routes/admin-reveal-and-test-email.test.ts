import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * Audit SEC-01#5 (lot C10, 11.11.2026) :
 *  - `GET /v1/admin/stripe/delivery/:session_id?reveal=1` CONSOMME la vue unique de
 *    la clé : après lui, la page de succès répond 404 ;
 *  - `POST /v1/admin/test-email` n'écrit qu'à une adresse du domaine du produit.
 * L'envoi lui-même est remplacé par un espion : aucun courrier ne part d'un test.
 */
const mail = vi.hoisted(() => ({ sendApiKeyEmail: vi.fn(async () => false) }));
vi.mock('../lib/email.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/email.js')>()),
  ...mail,
}));

const { buildApp } = await import('../app.js');
const { closeAll, getStatsDB } = await import('../lib/db.js');

const SECRET = 'full-admin-secret-for-the-reveal-test-0123456789';
const avant = process.env.ADMIN_SECRET;
const app = buildApp();
let ipSeq = 0;
const headers = (extra: Record<string, string> = {}) => ({
  'x-forwarded-for': `203.0.113.${++ipSeq}`,
  ...extra,
});

/** Une clé achetée par carte, dont la vue unique n'a pas encore été retirée. */
function seedPaidKey(sessionId: string): string {
  const raw = `ifk_${createHash('sha256').update(sessionId).digest('hex')}`;
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, active, stripe_session_id, raw_key_one_time_view, credits_total, credits_remaining)
       VALUES (?, ?, 'stripe-buyer', 1, ?, ?, 1000, 1000)`,
    )
    .run(createHash('sha256').update(raw).digest('hex'), raw.slice(0, 12), sessionId, raw);
  return raw;
}

async function delivery(sessionId: string, reveal: boolean) {
  const res = await app.request(
    `/v1/admin/stripe/delivery/${sessionId}${reveal ? '?reveal=1' : ''}`,
    { headers: headers({ 'X-Admin-Secret': SECRET }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function successPage(sessionId: string) {
  const res = await app.request(`/v1/stripe/key/${sessionId}`, { headers: headers() });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(() => {
  process.env.ADMIN_SECRET = SECRET;
});
afterAll(() => {
  if (avant === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = avant;
  closeAll();
});
beforeEach(() => {
  mail.sendApiKeyEmail.mockClear();
});

describe('reveal=1 consumes the one-time view', () => {
  it('after a reveal, GET /v1/stripe/key/:session_id answers 404, and a second reveal finds nothing', async () => {
    const sessionId = 'cs_test_c10reveal0001';
    const raw = seedPaidKey(sessionId);
    const first = await delivery(sessionId, true);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      found: true,
      raw_key: raw,
      raw_key_still_available: false,
      delivered_via_success_page: false,
    });
    expect((await successPage(sessionId)).status).toBe(404);
    const second = await delivery(sessionId, true);
    expect(second.body.raw_key).toBeUndefined();
    expect(second.body.raw_key_still_available).toBe(false);
    const stored = getStatsDB()
      .prepare('SELECT raw_key_one_time_view FROM api_keys WHERE stripe_session_id = ?')
      .get(sessionId) as { raw_key_one_time_view: string | null };
    expect(stored.raw_key_one_time_view).toBeNull();
  });

  it('without reveal the check stays read-only: the customer still gets the key', async () => {
    const sessionId = 'cs_test_c10reveal0002';
    const raw = seedPaidKey(sessionId);
    const check = await delivery(sessionId, false);
    expect(check.body).toMatchObject({
      raw_key_still_available: true,
      delivered_via_success_page: false,
    });
    expect(check.body.raw_key).toBeUndefined();
    const page = await successPage(sessionId);
    expect(page.status).toBe(200);
    expect(page.body.api_key).toBe(raw);
  });
});

describe('the test mail only goes to the product domain', () => {
  async function testEmail(to: string) {
    const res = await app.request(`/v1/admin/test-email?to=${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: headers({ 'X-Admin-Secret': SECRET }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  }

  it('answers 400 for acme@example.com, and sends nothing', async () => {
    const res = await testEmail('acme@example.com');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('recipient_not_allowed');
    expect(mail.sendApiKeyEmail).not.toHaveBeenCalled();
  });

  it('refuses a look-alike domain and a subdomain', async () => {
    for (const to of [
      'ops@ibanforge.com.alpha.example.net',
      'ops@mail.ibanforge.com',
      'a@ibanforge.com@alpha.example.net',
    ]) {
      const res = await testEmail(to);
      expect(res.status, to).toBe(400);
    }
    expect(mail.sendApiKeyEmail).not.toHaveBeenCalled();
  });

  it('lets an address of the product domain through to the send', async () => {
    const res = await testEmail('Ops@IBANforge.com');
    expect(res.status).toBe(200);
    expect(mail.sendApiKeyEmail).toHaveBeenCalledTimes(1);
  });
});
