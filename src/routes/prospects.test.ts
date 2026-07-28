import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeys } from './api-keys.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const SECRET = 'correct-horse-battery-staple';
const RUN_ID = Date.now();
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/prospects — admin auth', () => {
  it('GET rejects without secret', async () => {
    const res = await makeApp().request('/v1/admin/prospects');
    expect(res.status).toBe(401);
  });

  it('POST rejects without secret', async () => {
    const res = await makeApp().request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospects: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('GET returns an array with correct secret', async () => {
    const res = await makeApp().request('/v1/admin/prospects', {
      headers: { 'X-Admin-Secret': SECRET },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { prospects: unknown[] };
    expect(Array.isArray(json.prospects)).toBe(true);
  });
});

describe('/v1/admin/prospects — upsert + read back', () => {
  it('rejects a non-array body', async () => {
    const res = await makeApp().request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ prospects: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('upserts idempotently by id and is then listed', async () => {
    const app = makeApp();
    const id = 'p_test_fixed_0001';
    const payload = {
      prospects: [
        {
          id,
          company: 'Vitest Test Co',
          segment: 'editeurs',
          website: 'https://example.com',
          contact_email: 'sales@example.com',
          status: 'a_mailer',
          mail_subject_en: 'Hello',
          mail_body_en: 'Body',
          source: 'vitest',
        },
      ],
    };
    const up1 = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify(payload),
    });
    expect(up1.status).toBe(200);
    expect(((await up1.json()) as { upserted: number }).upserted).toBe(1);

    // Second upsert with same id must not create a duplicate.
    const up2 = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify(payload),
    });
    expect(up2.status).toBe(200);

    const list = await app.request('/v1/admin/prospects', { headers: { 'X-Admin-Secret': SECRET } });
    const json = (await list.json()) as { prospects: Array<{ id: string }> };
    const matches = json.prospects.filter((p) => p.id === id);
    expect(matches.length).toBe(1);
  });

  it('updates a prospect status', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/prospects/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: 'p_test_fixed_0001', status: 'archive' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
  });

  it('rejects an invalid status', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/prospects/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: 'p_test_fixed_0001', status: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * The outcome axis. `status` says where the sourcing got to; `outcome` says
 * where the relationship got to, and the two must never disturb each other.
 */
describe('/v1/admin/prospects/update — the outcome axis', () => {
  const pid = `p_outcome_${RUN_ID}`;

  const update = (body: Record<string, unknown>) =>
    makeApp().request('/v1/admin/prospects/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: pid, ...body }),
    });

  const read = async () => {
    const res = await makeApp().request('/v1/admin/prospects', { headers: { 'X-Admin-Secret': SECRET } });
    const json = (await res.json()) as { prospects: Array<Record<string, string | null>> };
    return json.prospects.find((p) => p.id === pid)!;
  };

  beforeEach(async () => {
    await makeApp().request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        prospects: [{ id: pid, company: 'Fictive Sàrl', status: 'contacte', contact_email: `outcome-${RUN_ID}@prospect-test.example` }],
      }),
    });
  });

  it('records an outcome and reads it back', async () => {
    expect((await update({ outcome: 'pas_interesse', outcomeNote: 'Ils ont déjà un fournisseur.' })).status).toBe(200);
    const row = await read();
    expect(row.outcome).toBe('pas_interesse');
    expect(row.outcome_note).toBe('Ils ont déjà un fournisseur.');
    expect(row.outcome_at).toBeTruthy();
  });

  it('leaves the sourcing status alone when only an outcome is sent', async () => {
    await update({ outcome: 'en_discussion' });
    expect((await read()).status).toBe('contacte');
  });

  it('leaves the outcome alone when only a status is sent', async () => {
    await update({ outcome: 'en_discussion' });
    await update({ status: 'archive' });
    const row = await read();
    expect(row.status).toBe('archive');
    expect(row.outcome).toBe('en_discussion');
  });

  it('requires a wake-up date for "not now", and stores it', async () => {
    // Without a date this outcome is indistinguishable from silence, and the
    // contact would come back every ten days to be dismissed by hand again.
    expect((await update({ outcome: 'pas_maintenant' })).status).toBe(400);
    expect((await update({ outcome: 'pas_maintenant', wakeUpAt: '2026-09' })).status).toBe(400);
    expect((await update({ outcome: 'pas_maintenant', wakeUpAt: '2026-09-15' })).status).toBe(200);
    expect((await read()).wake_up_at).toBe('2026-09-15');
  });

  it('refuses a wake-up date on any other outcome', async () => {
    // Accepting one would let a contact judged dead quietly resurface.
    await update({ outcome: 'pas_interesse', wakeUpAt: '2026-09-15' });
    expect((await read()).wake_up_at).toBeNull();
  });

  it('clears the date and the note when the outcome is taken back', async () => {
    await update({ outcome: 'pas_maintenant', wakeUpAt: '2026-09-15', outcomeNote: 'rappeler après l été' });
    await update({ outcome: null });
    const row = await read();
    expect(row.outcome).toBeNull();
    expect(row.wake_up_at).toBeNull();
    expect(row.outcome_note).toBeNull();
    expect(row.outcome_at).toBeNull();
  });

  it('rejects an outcome nobody planned for', async () => {
    expect((await update({ outcome: 'peut-etre' })).status).toBe(400);
  });

  it('rejects a body that changes nothing', async () => {
    expect((await update({})).status).toBe(400);
  });
});

describe('email-messages upsert → prospect status auto-flip', () => {
  const pid = 'p_test_contact_flip';
  const email = `flip-${RUN_ID}@prospect-test.example`;

  async function seedProspect(app: Hono, status: string) {
    const res = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        prospects: [{ id: pid, company: 'FlipTest AG', contact_email: email, status }],
      }),
    });
    expect(res.status).toBe(200);
  }

  async function readStatus(app: Hono): Promise<string> {
    const list = await app.request('/v1/admin/prospects', { headers: { 'X-Admin-Secret': SECRET } });
    const json = (await list.json()) as { prospects: Array<{ id: string; status: string }> };
    return json.prospects.find((p) => p.id === pid)!.status;
  }

  it('an outgoing message to the prospect email flips a_mailer → contacte', async () => {
    const app = makeApp();
    await seedProspect(app, 'a_mailer');
    const res = await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-out-${RUN_ID}`, customer_email: email.toUpperCase(), direction: 'out', subject: 'Hello', msg_date: '2026-07-02T08:00' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await readStatus(app)).toBe('contacte');
  });

  it('an incoming message alone does NOT flip the preparation status', async () => {
    const app = makeApp();
    await seedProspect(app, 'a_mailer');
    await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-in-${RUN_ID}`, customer_email: email, direction: 'in', subject: 'Re: Hello', msg_date: '2026-07-02T09:00' }],
      }),
    });
    expect(await readStatus(app)).toBe('a_mailer');
  });

  it('does not touch terminal statuses (rejete stays rejete)', async () => {
    const app = makeApp();
    await seedProspect(app, 'rejete');
    await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-out2-${RUN_ID}`, customer_email: email, direction: 'out', subject: 'Hello again', msg_date: '2026-07-02T10:00' }],
      }),
    });
    expect(await readStatus(app)).toBe('rejete');
  });

  it('a CRM draft does NOT flip the preparation status (a draft is not correspondence)', async () => {
    const app = makeApp();
    await seedProspect(app, 'a_mailer');
    const res = await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-draft-${RUN_ID}`, customer_email: email, direction: 'draft', subject: 'Brouillon', msg_date: '2026-07-02T11:00', body: 'draft body' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await readStatus(app)).toBe('a_mailer');
  });
});

describe('email-messages delete — drafts only', () => {
  it('deletes a draft, refuses to delete sent history', async () => {
    const app = makeApp();
    const mail = `draft-del-${RUN_ID}@example.com`;
    await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [
          { id: `del-draft-${RUN_ID}`, customer_email: mail, direction: 'draft', subject: 'Brouillon', msg_date: '2026-07-02T12:00' },
          { id: `del-out-${RUN_ID}`, customer_email: mail, direction: 'out', subject: 'Envoyé', msg_date: '2026-07-02T12:01' },
        ],
      }),
    });

    const delDraft = await app.request('/v1/admin/email-messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: `del-draft-${RUN_ID}` }),
    });
    expect(delDraft.status).toBe(200);
    expect(((await delDraft.json()) as { deleted: number }).deleted).toBe(1);

    const delOut = await app.request('/v1/admin/email-messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: `del-out-${RUN_ID}` }),
    });
    expect(((await delOut.json()) as { deleted: number }).deleted).toBe(0);
  });

  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/email-messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'whatever' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('/v1/admin/prospects — em dashes scrubbed from mail prose on seed', () => {
  it('replaces em dashes contextually in the 4 mail fields, leaves internal notes untouched', async () => {
    const app = makeApp();
    const id = `p_test_emdash_${RUN_ID}`;
    const up = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        prospects: [
          {
            id,
            company: 'EmDash AG',
            contact_email: 'em@dash.example',
            status: 'a_mailer',
            mail_subject_en: 'One call — validation + BIC',
            mail_body_en:
              "Hi team — (route this freely). We run checks — that's the gate.\nClaude-Alain Martin — IBANforge — https://ibanforge.com",
            mail_body_fr: 'Salut — une idée entre développeurs.',
            fit_reason: 'kept as-is — internal note',
          },
        ],
      }),
    });
    expect(up.status).toBe(200);

    const list = await app.request('/v1/admin/prospects', { headers: { 'X-Admin-Secret': SECRET } });
    const { prospects } = (await list.json()) as { prospects: Array<Record<string, string>> };
    const p = prospects.find((x) => x.id === id)!;

    expect(p.mail_subject_en).toBe('One call, validation + BIC');
    expect(p.mail_body_en).toContain('Hi team (route this freely).');
    expect(p.mail_body_en).toContain("We run checks. That's the gate.");
    expect(p.mail_body_en).toContain('Claude-Alain Martin · IBANforge · https://ibanforge.com');
    expect(p.mail_body_fr).toBe('Salut, une idée entre développeurs.');
    expect(p.mail_body_en).not.toContain('—');
    // Internal notes are not sendable prose and stay untouched.
    expect(p.fit_reason).toBe('kept as-is — internal note');
  });
});
