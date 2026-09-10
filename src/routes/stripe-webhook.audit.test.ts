import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { processStripeEvent, stripeWebhook, resetStripeClient } from './stripe-webhook.js';
import {
  createAuditJob,
  getAuditJob,
  markAuditPaid,
  purgeExpiredAuditJobs,
} from '../lib/audit-jobs.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import * as email from '../lib/email.js';
import * as ops from '../lib/ops-alert.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetStripeClient();
});

afterAll(() => closeAll());

function makeAudit() {
  return createAuditJob({
    filename: 'fictif.csv',
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

function event(
  jobId: string,
  id = `evt_audit_${Math.random().toString(36).slice(2)}`,
): Stripe.Event {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_audit_${jobId}`,
        object: 'checkout.session',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 14900,
        currency: 'chf',
        customer_email: 'buyer@example.com',
        customer_details: null,
        metadata: { audit_job: jobId },
      },
    },
  } as unknown as Stripe.Event;
}

describe('processStripeEvent with metadata.audit_job', () => {
  it('marks the audit paid, mints nothing, and stays idempotent', () => {
    const job = createAuditJob({
      filename: 'f.csv',
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
      report: Buffer.from('xlsx'),
    });
    const evtId = `evt_audit_${job.id.slice(0, 12)}`;
    const first = processStripeEvent(event(job.id, evtId));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ received: true, audit_job: job.id, paid: true });
    expect(first.notify).toBeUndefined();
    const paid = getAuditJob(job.id);
    expect(paid?.paid_at).toBeTruthy();
    expect(paid?.stripe_session_id).toBe(`cs_test_audit_${job.id}`);
    expect(paid?.payer_email).toBe('buyer@example.com');

    const again = processStripeEvent(event(job.id, evtId));
    expect(again.body).toMatchObject({ idempotent: true });
  });

  it('answers 200 without minting when the job no longer exists', () => {
    const send = vi.spyOn(email, 'sendAuditReadyEmail').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const input = event('0'.repeat(36));
    const r = processStripeEvent(input);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ paid: false, delivery: 'job_missing', report_available: false });
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[audit-payment]', 'job_missing', expect.any(Object));
    expect(processStripeEvent(input).body).toMatchObject({ idempotent: true });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('signale un second paiement sans envoyer un lien qui remplace le premier', () => {
    const send = vi.spyOn(email, 'sendAuditReadyEmail').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const job = createAuditJob({
      filename: 'fictif.csv',
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
    getStatsDB()
      .prepare('UPDATE audit_jobs SET stripe_session_id = ? WHERE id = ?')
      .run('cs_test_seconde', job.id);
    const first = event(job.id);
    expect(processStripeEvent(first).body).toMatchObject({ paid: true, delivery: 'paid' });
    const firstPaid = getAuditJob(job.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ link: expect.stringContaining(`cs_test_audit_${job.id}`) }),
    );
    const second = event(job.id);
    (second.data.object as Stripe.Checkout.Session).id = 'cs_test_seconde';
    expect(processStripeEvent(second).body).toMatchObject({
      paid: false,
      delivery: 'additional_payment',
      report_available: false,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(getAuditJob(job.id)?.stripe_session_id).toBe(firstPaid?.stripe_session_id);
    expect(getAuditJob(job.id)?.expires_at).toBe(firstPaid?.expires_at);
    expect(log).toHaveBeenCalledWith('[audit-payment]', 'additional_payment', expect.any(Object));
    expect(processStripeEvent(second).body).toMatchObject({ idempotent: true });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('ne ressuscite pas un rapport impayé purgé quand le paiement arrive tard', () => {
    const send = vi.spyOn(email, 'sendAuditReadyEmail').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const job = createAuditJob({
      filename: 'fictif.csv',
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
    getStatsDB()
      .prepare("UPDATE audit_jobs SET expires_at = '2000-01-01 00:00:00' WHERE id = ?")
      .run(job.id);
    purgeExpiredAuditJobs();
    expect(processStripeEvent(event(job.id)).body).toMatchObject({
      paid: false,
      delivery: 'job_missing',
    });
    expect(getAuditJob(job.id)).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM audit_sales WHERE job_id = ?').get(job.id),
    ).toEqual({ n: 0 });
  });

  it('notifie une seule fois un incident par paiement et signale aussi le paiement suivant', () => {
    const alert = vi.spyOn(ops, 'opsFail').mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('VITEST', '');
    processStripeEvent(event('a'.repeat(36)));
    processStripeEvent(event('a'.repeat(36)));
    processStripeEvent(event('b'.repeat(36)));
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[0][0]).not.toBe(alert.mock.calls[1][0]);
    expect(JSON.stringify(alert.mock.calls)).not.toContain('cs_test');
    expect(JSON.stringify(alert.mock.calls)).not.toContain('example.com');
  });

  it('envoie le premier message après une reprise GET puis déduplique les événements du même paiement', () => {
    const send = vi.spyOn(email, 'sendAuditReadyEmail').mockImplementation(() => undefined);
    const job = makeAudit();
    const first = event(job.id);
    markAuditPaid(job.id, {
      session_id: `cs_test_audit_${job.id}`,
      email: 'acme@example.com',
      amount_minor: 14900,
      currency: 'chf',
    });
    expect(send).not.toHaveBeenCalled();
    expect(processStripeEvent(first).body).toMatchObject({ delivery: 'already_paid', paid: true });
    const another = event(job.id);
    another.type = 'checkout.session.async_payment_succeeded';
    expect(processStripeEvent(another).body).toMatchObject({
      delivery: 'already_paid',
      paid: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('vérifie la signature HTTP avant paiement et conserve le rejeu signé idempotent', async () => {
    const send = vi.spyOn(email, 'sendAuditReadyEmail').mockImplementation(() => undefined);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fictif_sans_compte');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fictif_sans_compte');
    resetStripeClient();
    const job = makeAudit();
    const payload = JSON.stringify(event(job.id));
    const signature = new Stripe('sk_test_fictif_sans_compte').webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_fictif_sans_compte',
    });
    const sendRequest = (body: string) =>
      stripeWebhook.request('/v1/stripe/webhook', {
        method: 'POST',
        body,
        headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      });
    const invalid = await sendRequest(`${payload} `);
    expect(invalid.status).toBe(400);
    expect(getAuditJob(job.id)?.paid_at).toBeNull();
    expect(send).not.toHaveBeenCalled();
    const valid = await sendRequest(payload);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ paid: true, delivery: 'paid' });
    const replay = await sendRequest(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotent: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
