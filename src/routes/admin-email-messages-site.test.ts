import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit C10, section 5 (11.11.2026) : sur `POST /v1/admin/email-messages`, la clé
 * du tableau de bord (`SITE_ADMIN_TOKEN`) ne programme pas d'envoi automatique
 * (origine 'claude') et ne réécrit pas l'historique ; elle garde ce que le site
 * fait (brouillon enregistré et réenregistré, envoi consigné sous un id neuf).
 * Les autres clés, secret complet et familles des scripts, ne changent pas.
 */
const ops = vi.hoisted(() => ({ notifyOps: vi.fn(async () => true) }));
vi.mock('../lib/ops-alert.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ops-alert.js')>()),
  ...ops,
}));

const { buildApp } = await import('../app.js');
const { SCOPED_ADMIN_KEYS } = await import('../lib/admin-auth.js');
const { resetAdminAlerts } = await import('../lib/admin-alerts.js');
const { closeAll, getStatsDB } = await import('../lib/db.js');

const KEYS = {
  ADMIN_SECRET: 'full-secret-for-the-messages-test-0123456789',
  SITE_ADMIN_TOKEN: 'site-key-for-the-messages-test-0123456789',
  MAIL_OUTREACH_TOKEN: 'outreach-key-for-the-messages-test-0123456789',
  MAIL_SYNC_TOKEN: 'sync-key-for-the-messages-test-0123456789',
} as const;
const avant: Record<string, string | undefined> = {};
const app = buildApp();
let ipSeq = 0;

interface Msg {
  id: string;
  customer_email: string;
  direction: 'in' | 'out' | 'draft';
  msg_date: string;
  subject: string;
  body?: string;
  origin?: string;
}

async function post(key: keyof typeof KEYS, messages: Msg[]) {
  const res = await app.request('/v1/admin/email-messages', {
    method: 'POST',
    headers: {
      'x-forwarded-for': `192.0.2.${++ipSeq}`,
      'content-type': 'application/json',
      'X-Admin-Secret': KEYS[key],
    },
    body: JSON.stringify({ messages }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function stored(id: string) {
  return getStatsDB()
    .prepare('SELECT direction, origin, body, subject FROM email_messages WHERE id = ?')
    .get(id) as
    { direction: string; origin: string | null; body: string; subject: string } | undefined;
}

const draft = (id: string, body: string, extra: Partial<Msg> = {}): Msg => ({
  id,
  customer_email: 'acme@example.com',
  direction: 'draft',
  msg_date: '2026-11-11T09:00',
  subject: 'Votre clé',
  body,
  ...extra,
});

beforeAll(() => {
  for (const name of ['ADMIN_SECRET', ...Object.keys(SCOPED_ADMIN_KEYS)]) {
    avant[name] = process.env[name];
    delete process.env[name];
  }
  Object.assign(process.env, KEYS);
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
  ops.notifyOps.mockClear();
});

describe('the site key on POST /v1/admin/email-messages', () => {
  it('keeps what the dashboard does: save a draft, save it again, record a sent mail', async () => {
    expect((await post('SITE_ADMIN_TOKEN', [draft('draft-site-1', 'v1')])).body).toEqual({
      upserted: 1,
    });
    expect((await post('SITE_ADMIN_TOKEN', [draft('draft-site-1', 'v2')])).status).toBe(200);
    expect(stored('draft-site-1')?.body).toBe('v2');
    const sent = await post('SITE_ADMIN_TOKEN', [
      {
        id: 'sent-site-1',
        customer_email: 'acme@example.com',
        direction: 'out',
        msg_date: '2026-11-11T09:05:00',
        subject: 'Votre clé',
        body: 'Bonjour',
        origin: 'dashboard',
      },
    ]);
    expect(sent.body).toEqual({ upserted: 1 });
    expect(stored('sent-site-1')?.origin).toBe('dashboard');
    expect(ops.notifyOps).not.toHaveBeenCalled();
  });

  it('refuses the agent origin with 403, and writes nothing of the batch', async () => {
    const res = await post('SITE_ADMIN_TOKEN', [
      draft('draft-site-ok', 'innocent'),
      draft('draft-site-agent', 'texte piégé', {
        customer_email: 'ops@alpha.example.net',
        origin: 'claude',
      }),
    ]);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden', reason: 'origin_not_allowed' });
    expect(stored('draft-site-agent')).toBeUndefined();
    expect(stored('draft-site-ok')).toBeUndefined();
  });

  it('refuses to rewrite a received or sent mail, or to turn a draft into a sent one', async () => {
    const received: Msg = {
      id: 'in-history-1',
      customer_email: 'acme@example.com',
      direction: 'in',
      msg_date: '2026-11-10T08:00',
      subject: 'Question',
      body: 'texte reçu',
    };
    expect((await post('MAIL_SYNC_TOKEN', [received])).status).toBe(200);
    const rewrite = await post('SITE_ADMIN_TOKEN', [{ ...received, body: 'texte réécrit' }]);
    expect(rewrite.status).toBe(403);
    expect(rewrite.body).toMatchObject({ error: 'forbidden', reason: 'rewrite_not_allowed' });
    expect(stored('in-history-1')?.body).toBe('texte reçu');

    expect((await post('SITE_ADMIN_TOKEN', [draft('draft-site-2', 'brouillon')])).status).toBe(200);
    const promote = await post('SITE_ADMIN_TOKEN', [
      { ...draft('draft-site-2', 'brouillon'), direction: 'out' },
    ]);
    expect(promote.status).toBe(403);
    expect(stored('draft-site-2')?.direction).toBe('draft');
  });

  it('may correct a draft the agent scheduled: it stays scheduled, and the owner is alerted', async () => {
    const scheduled = draft('draft-scheduled-1', 'texte de l’agent', { origin: 'claude' });
    expect((await post('MAIL_OUTREACH_TOKEN', [scheduled])).status).toBe(200);
    expect(ops.notifyOps).not.toHaveBeenCalled();
    const fix = await post('SITE_ADMIN_TOKEN', [draft('draft-scheduled-1', 'texte corrigé')]);
    expect(fix.status).toBe(200);
    expect(stored('draft-scheduled-1')).toMatchObject({ origin: 'claude', body: 'texte corrigé' });
    expect(ops.notifyOps).toHaveBeenCalledTimes(1);
    const text = String((ops.notifyOps.mock.calls[0] as unknown[])[0]);
    expect(text).toContain('SITE_ADMIN_TOKEN');
    expect(text).not.toMatch(/@/);
  });
});

describe('every other key is unchanged on POST /v1/admin/email-messages', () => {
  it('the outreach family and the full secret still schedule a send', async () => {
    for (const key of ['MAIL_OUTREACH_TOKEN', 'ADMIN_SECRET'] as const) {
      const id = `draft-unchanged-${key}`;
      const res = await post(key, [draft(id, 'envoi programmé', { origin: 'claude' })]);
      expect(res.body, key).toEqual({ upserted: 1 });
      expect(stored(id)?.origin).toBe('claude');
    }
  });

  it('the sync family and the full secret still rewrite a recorded message', async () => {
    const received: Msg = {
      id: 'in-history-2',
      customer_email: 'acme@example.com',
      direction: 'in',
      msg_date: '2026-11-10T08:30',
      subject: 'Relance',
      body: 'premier',
    };
    expect((await post('MAIL_SYNC_TOKEN', [received])).status).toBe(200);
    expect((await post('MAIL_SYNC_TOKEN', [{ ...received, body: 'deuxième' }])).status).toBe(200);
    expect((await post('ADMIN_SECRET', [{ ...received, body: 'troisième' }])).status).toBe(200);
    expect(stored('in-history-2')?.body).toBe('troisième');
    expect(ops.notifyOps).not.toHaveBeenCalled();
  });
});
