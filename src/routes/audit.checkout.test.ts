import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import Stripe from 'stripe';
import { audit, _setStripeForTests } from './audit.js';
import {
  attachAuditSession,
  createAuditJob,
  getAuditJob,
  getAuditReport,
  markAuditPaid,
  purgeExpiredAuditJobs,
} from '../lib/audit-jobs.js';
import { closeAll, getStatsDB } from '../lib/db.js';

function makeJob() {
  return createAuditJob({
    filename: 'fournisseurs-fictifs.csv',
    rows: 3,
    tier: 'standard',
    price_chf: 149,
    lang: 'fr',
    summary: {
      rows: 3,
      ok: 3,
      warning: 0,
      error: 0,
      by_code: {},
      countries: [],
      columns_detected: ['iban'],
      address_checked: false,
      tier: 'standard',
      price_chf: 149,
    },
    preview: [],
    report: Buffer.from('rapport fictif'),
  });
}

function request(path: string, body?: Record<string, unknown>) {
  const app = new Hono();
  app.route('/', audit);
  return app.request(
    path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
}

function checkout(id: string, body: Record<string, unknown> = {}) {
  return request(`/v1/audit/checkout/${id}`, body);
}

function fakeStripe(job: ReturnType<typeof makeJob>) {
  const session = {
    id: `cs_test_${job.id}`,
    object: 'checkout.session',
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    metadata: { audit_job: job.id },
    amount_total: 14900,
    currency: 'chf',
    customer_email: 'acme@example.com',
    expires_at: Math.floor(Date.parse(`${job.expires_at.replace(' ', 'T')}Z`) / 1000) - 300,
    url: 'https://checkout.stripe.com/c/pay/cs_test_fictif',
  } as unknown as Stripe.Checkout.Session;
  const sessions = {
    create: vi.fn(
      async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) =>
        session,
    ),
    retrieve: vi.fn(async (_id: string) => session),
    expire: vi.fn(async (_id: string) => ({ ...session, status: 'expired' })),
  };
  _setStripeForTests({ checkout: { sessions } } as unknown as Stripe);
  return { session, sessions };
}

function payment(sessionId: string) {
  return { session_id: sessionId, email: 'acme@example.com', amount_minor: 14900, currency: 'chf' };
}

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Réseau externe interdit dans ce test'))),
  );
});
afterEach(() => {
  _setStripeForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => closeAll());

describe('Reprise du paiement d’un audit', () => {
  it('réutilise une session ouverte et fixe la carte, l’échéance et l’idempotence', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    const first = await checkout(job.id, { locale: 'de', email: 'acme@example.com' });
    expect(first.status).toBe(200);
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method_types: ['card'],
        expires_at: session.expires_at,
        locale: 'de',
        allow_promotion_codes: true,
      }),
      { idempotencyKey: `audit:${job.id}` },
    );
    expect(session.expires_at).toBeLessThan(
      Date.parse(`${job.expires_at.replace(' ', 'T')}Z`) / 1000,
    );
    const again = await checkout(job.id, { locale: 'en', email: 'autre@example.com' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(sessions.retrieve).toHaveBeenCalledWith(session.id);
    expect(getAuditJob(job.id)?.expires_at).toBe(job.expires_at);
  });

  it('garde le même corps et la même clé lorsque deux onglets se chevauchent', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    let release!: (session: Stripe.Checkout.Session) => void;
    sessions.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    sessions.create.mockRejectedValueOnce(new Error('Idempotency key in use'));
    const first = checkout(job.id, { locale: 'fr', email: 'acme@example.com' });
    await vi.waitFor(() => expect(sessions.create).toHaveBeenCalledTimes(1));
    const concurrent = await checkout(job.id, { locale: 'de', email: 'autre@example.com' });
    expect(concurrent.status).toBe(503);
    expect(sessions.create.mock.calls[1]).toEqual(sessions.create.mock.calls[0]);
    release(session);
    expect((await first).status).toBe(200);
    expect((await checkout(job.id)).status).toBe(200);
    expect(sessions.create).toHaveBeenCalledTimes(2);
    expect(sessions.retrieve).toHaveBeenCalledTimes(1);
  });

  it('reprend la réservation après une coupure avant l’attachement', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    sessions.create.mockRejectedValueOnce(new Error('Connection closed after creation'));
    expect((await checkout(job.id, { locale: 'de' })).status).toBe(503);
    expect(getAuditJob(job.id)?.stripe_session_id).toBeNull();
    expect((await checkout(job.id, { locale: 'en' })).status).toBe(200);
    expect(sessions.create.mock.calls[1]).toEqual(sessions.create.mock.calls[0]);
    expect(getAuditJob(job.id)?.stripe_session_id).toBe(session.id);
  });

  it('retrouve une session créée après une coupure suivie de quatre-vingt-dix minutes d’attente', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    sessions.create.mockRejectedValueOnce(new Error('Connection closed after creation'));
    expect((await checkout(job.id, { locale: 'de' })).status).toBe(503);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 90 * 60_000);
    expect(session.expires_at - Date.now() / 1000).toBeLessThan(30 * 60);
    expect((await checkout(job.id, { locale: 'en' })).status).toBe(200);
    expect(sessions.create.mock.calls[1]).toEqual(sessions.create.mock.calls[0]);
    expect(getAuditJob(job.id)?.stripe_session_id).toBe(session.id);
  });

  it('refuse clairement le rejeu trop tardif si Stripe n’avait jamais créé la session', async () => {
    const job = makeJob();
    const { sessions } = fakeStripe(job);
    sessions.create.mockRejectedValueOnce(new Error('Connection unavailable before creation'));
    expect((await checkout(job.id)).status).toBe(503);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 90 * 60_000);
    sessions.create.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message: 'expires_at must be at least 30 minutes from creation',
        param: 'expires_at',
      }),
    );
    const response = await checkout(job.id);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: 'checkout_expired' });
    expect(sessions.create.mock.calls[1]).toEqual(sessions.create.mock.calls[0]);
    expect(getAuditJob(job.id)?.stripe_session_id).toBeNull();
  });

  it('ne crée aucun nouveau paiement lorsque la lecture Stripe échoue', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    attachAuditSession(job.id, session.id);
    sessions.retrieve.mockRejectedValueOnce(new Error('Stripe temporarily unavailable'));
    expect((await checkout(job.id)).status).toBe(503);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('réconcilie un paiement achevé lors de la reprise sans racheter le rapport', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    attachAuditSession(job.id, session.id);
    session.status = 'complete';
    session.payment_status = 'paid';
    const resumed = await checkout(job.id);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ url: expect.stringContaining('/audit/done?') });
    expect(sessions.create).not.toHaveBeenCalled();
    expect(getAuditJob(job.id)?.paid_at).toBeTruthy();
  });

  it('n’écrase pas un paiement reçu pendant l’attente réseau', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    sessions.create.mockImplementationOnce(async () => {
      markAuditPaid(job.id, payment('cs_test_premier_paiement'));
      return session;
    });
    expect((await checkout(job.id)).status).toBe(409);
    expect(getAuditJob(job.id)?.stripe_session_id).toBe('cs_test_premier_paiement');
    expect(sessions.expire).toHaveBeenCalledWith(session.id);
  });
});

describe('Échéance du paiement et du rapport', () => {
  it('refuse une première création trop proche de la fin des deux heures', async () => {
    const job = makeJob();
    const { sessions } = fakeStripe(job);
    const expires = new Date(Date.now() + 34 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    getStatsDB().prepare('UPDATE audit_jobs SET expires_at = ? WHERE id = ?').run(expires, job.id);
    expect((await checkout(job.id)).status).toBe(410);
    expect(sessions.create).not.toHaveBeenCalled();
    expect(getAuditJob(job.id)?.expires_at).toBe(expires);
  });

  it('permet la reprise d’une session déjà ouverte dans ses dernières minutes', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    const expires = new Date(Date.now() + 20 * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    getStatsDB().prepare('UPDATE audit_jobs SET expires_at = ? WHERE id = ?').run(expires, job.id);
    session.expires_at = Math.floor(Date.parse(`${expires.replace(' ', 'T')}Z`) / 1000) - 300;
    attachAuditSession(job.id, session.id);
    expect((await checkout(job.id)).status).toBe(200);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('ferme une ancienne session ouverte qui dépasse l’échéance du rapport', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    attachAuditSession(job.id, session.id);
    session.expires_at += 24 * 3600;
    expect((await checkout(job.id)).status).toBe(410);
    expect(sessions.expire).toHaveBeenCalledWith(session.id);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuse un rapport expiré et un nouveau paiement sans attendre la purge', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    markAuditPaid(job.id, payment(session.id));
    getStatsDB()
      .prepare("UPDATE audit_jobs SET expires_at = '2000-01-01 00:00:00' WHERE id = ?")
      .run(job.id);
    expect(getStatsDB().prepare('SELECT 1 FROM audit_jobs WHERE id = ?').get(job.id)).toBeTruthy();
    expect(getAuditJob(job.id)).toBeNull();
    expect(getAuditReport(job.id)).toBeNull();
    expect((await request(`/v1/audit/report/${job.id}?session_id=${session.id}`)).status).toBe(404);
    expect((await checkout(job.id)).status).toBe(404);
    expect(sessions.create).not.toHaveBeenCalled();
  });
});

describe('Lien payé et vente durable', () => {
  it('lie un état historique A puis B à la session A réellement payée', async () => {
    const job = makeJob();
    getStatsDB()
      .prepare('UPDATE audit_jobs SET stripe_session_id = ? WHERE id = ?')
      .run('cs_test_B', job.id);
    const paid = markAuditPaid(job.id, payment('cs_test_A'));
    expect(paid.status).toBe('paid');
    expect(paid.job?.stripe_session_id).toBe('cs_test_A');
    expect((await request(`/v1/audit/report/${job.id}?session_id=cs_test_A`)).status).toBe(200);
    expect((await request(`/v1/audit/report/${job.id}?session_id=cs_test_B`)).status).toBe(403);
    const again = markAuditPaid(job.id, payment('cs_test_A'));
    const additional = markAuditPaid(job.id, payment('cs_test_B'));
    expect(again.status).toBe('already_paid');
    expect(additional.status).toBe('additional_payment');
    expect(additional.job?.expires_at).toBe(paid.job?.expires_at);
    expect(additional.job?.stripe_session_id).toBe('cs_test_A');
    expect(attachAuditSession(job.id, 'cs_test_B')).toBe(false);
    expect(
      getStatsDB()
        .prepare('SELECT stripe_session_id FROM audit_sales WHERE job_id = ?')
        .all(job.id),
    ).toEqual([{ stripe_session_id: 'cs_test_A' }]);
  });

  it('annule le passage à payé si l’écriture de la vente échoue puis accepte le rejeu', () => {
    const job = makeJob();
    const db = getStatsDB();
    db.exec(
      "CREATE TEMP TRIGGER audit_sale_failure BEFORE INSERT ON audit_sales BEGIN SELECT RAISE(ABORT, 'échec simulé'); END",
    );
    try {
      expect(() => markAuditPaid(job.id, payment('cs_test_transaction'))).toThrow('échec simulé');
      expect(getAuditJob(job.id)?.paid_at).toBeNull();
    } finally {
      db.exec('DROP TRIGGER audit_sale_failure');
    }
    expect(markAuditPaid(job.id, payment('cs_test_transaction')).status).toBe('paid');
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM audit_sales WHERE job_id = ?').get(job.id),
    ).toEqual({ n: 1 });
  });

  it('conserve la vente après purge, sans recréer le rapport au rejeu', () => {
    const job = makeJob();
    markAuditPaid(job.id, payment('cs_test_durable'));
    getStatsDB()
      .prepare("UPDATE audit_jobs SET expires_at = '2000-01-01 00:00:00' WHERE id = ?")
      .run(job.id);
    purgeExpiredAuditJobs();
    expect(markAuditPaid(job.id, payment('cs_test_durable'))).toEqual({
      status: 'already_paid',
      job: null,
    });
    expect(markAuditPaid(job.id, payment('cs_test_additional'))).toEqual({
      status: 'additional_payment',
      job: null,
    });
    expect(
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM audit_sales WHERE job_id = ?').get(job.id),
    ).toEqual({ n: 1 });
    expect(getAuditReport(job.id)).toBeNull();
  });

  it('réconcilie le statut avec Stripe et refuse la session d’un autre rapport', async () => {
    const job = makeJob();
    const { session } = fakeStripe(job);
    attachAuditSession(job.id, session.id);
    session.status = 'complete';
    session.payment_status = 'paid';
    session.metadata = { audit_job: 'autre-rapport-fictif' };
    const wrong = await request(`/v1/audit/status/${job.id}?session_id=${session.id}`);
    expect(await wrong.json()).toMatchObject({ paid: false, download: null });
    session.metadata = { audit_job: job.id };
    session.payment_status = 'unpaid';
    const pending = await request(`/v1/audit/status/${job.id}?session_id=${session.id}`);
    expect(await pending.json()).toMatchObject({ paid: false, download: null });
    session.payment_status = 'no_payment_required';
    session.amount_total = 0;
    const correct = await request(`/v1/audit/status/${job.id}?session_id=${session.id}`);
    expect(await correct.json()).toMatchObject({
      paid: true,
      download: expect.stringContaining(session.id),
    });
    expect(
      getStatsDB()
        .prepare('SELECT amount_paid_minor FROM audit_sales WHERE job_id = ?')
        .get(job.id),
    ).toEqual({ amount_paid_minor: 0 });
  });

  it('signale le paiement supplémentaire au retour client sans exposer le lien du premier', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    attachAuditSession(job.id, session.id);
    session.status = 'complete';
    session.payment_status = 'paid';
    sessions.retrieve.mockImplementationOnce(async () => {
      markAuditPaid(job.id, payment('cs_test_premier_prive'));
      return session;
    });
    const response = await request(`/v1/audit/status/${job.id}?session_id=${session.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ delivery: 'additional_payment', download: null });
    expect(JSON.stringify(body)).not.toContain('cs_test_premier_prive');
  });

  it('répond rapport absent s’il expire pendant la réconciliation du retour client', async () => {
    const job = makeJob();
    const { session, sessions } = fakeStripe(job);
    attachAuditSession(job.id, session.id);
    session.status = 'complete';
    session.payment_status = 'paid';
    sessions.retrieve.mockImplementationOnce(async () => {
      getStatsDB()
        .prepare("UPDATE audit_jobs SET expires_at = '2000-01-01 00:00:00' WHERE id = ?")
        .run(job.id);
      purgeExpiredAuditJobs();
      return session;
    });
    const response = await request(`/v1/audit/status/${job.id}?session_id=${session.id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'job_not_found' });
    expect(
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM audit_sales WHERE job_id = ?').get(job.id),
    ).toEqual({ n: 0 });
  });

  it('ajoute la réservation sur un ancien schéma fictif sans modifier ses rapports', () => {
    const job = makeJob();
    getStatsDB().exec('ALTER TABLE audit_jobs DROP COLUMN checkout_params_json');
    closeAll();
    expect(
      (getStatsDB().prepare('PRAGMA table_info(audit_jobs)').all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    ).toContain('checkout_params_json');
    expect(getAuditJob(job.id)?.expires_at).toBe(job.expires_at);
    expect(getAuditReport(job.id)?.toString()).toBe('rapport fictif');
  });
});
