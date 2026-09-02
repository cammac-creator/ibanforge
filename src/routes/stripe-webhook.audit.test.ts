import { describe, it, expect, afterAll } from 'vitest';
import type Stripe from 'stripe';
import { processStripeEvent } from './stripe-webhook.js';
import { createAuditJob, getAuditJob } from '../lib/audit-jobs.js';
import { closeAll } from '../lib/db.js';

afterAll(() => closeAll());

function event(
  jobId: string,
  id = `evt_audit_${Math.random().toString(36).slice(2)}`,
): Stripe.Event {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_audit_1',
        object: 'checkout.session',
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
    expect(paid?.stripe_session_id).toBe('cs_test_audit_1');
    expect(paid?.payer_email).toBe('buyer@example.com');

    const again = processStripeEvent(event(job.id, evtId));
    expect(again.body).toMatchObject({ idempotent: true });
  });

  it('answers 200 without minting when the job no longer exists', () => {
    const r = processStripeEvent(event('0'.repeat(36)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ paid: false });
  });
});
