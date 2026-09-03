import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import {
  feedback,
  recordFeedbackRow,
  countRecentFeedback,
  FEEDBACK_INSERTS_PER_SOURCE_HOUR,
} from './feedback.js';
import { getStatsDB } from '../lib/db.js';
import { hashIp } from '../lib/stats.js';

const RUN = Date.now();

function makeApp() {
  const app = new Hono();
  app.route('/', feedback);
  return app;
}

describe('recordFeedbackRow — field caps (defence in depth on both write paths)', () => {
  it('clips oversized fields before insert', () => {
    const id = recordFeedbackRow({
      error_type: 'other',
      notes: 'x'.repeat(9000),
      endpoint: 'e'.repeat(500),
      expected: 'a'.repeat(5000),
      contact: 'c'.repeat(999),
      agent: 'g'.repeat(400),
      ipHash: null,
    });
    const row = getStatsDB()
      .prepare('SELECT notes, endpoint, expected, contact, agent FROM feedback WHERE id = ?')
      .get(id) as {
      notes: string;
      endpoint: string;
      expected: string;
      contact: string;
      agent: string;
    };
    expect(row.notes.length).toBe(4000);
    expect(row.endpoint.length).toBe(200);
    expect(row.expected.length).toBeLessThanOrEqual(2000);
    expect(row.contact.length).toBe(255);
    expect(row.agent.length).toBe(120);
  });
});

describe('countRecentFeedback', () => {
  it('counts only the window and the given source', () => {
    const src = `fb-src-${RUN}`;
    recordFeedbackRow({ error_type: 'other', notes: 'a', ipHash: src });
    recordFeedbackRow({ error_type: 'other', notes: 'b', ipHash: src });
    expect(countRecentFeedback(src, 1)).toBe(2);
    getStatsDB()
      .prepare(
        "UPDATE feedback SET created_at = datetime('now','-2 hours') WHERE ip_hash = ? AND id = (SELECT MIN(id) FROM feedback WHERE ip_hash = ?)",
      )
      .run(src, src);
    expect(countRecentFeedback(src, 1)).toBe(1);
  });
});

describe('POST /v1/feedback — per-source flood quota', () => {
  it('429s once the source hits the hourly cap, before inserting', async () => {
    const app = makeApp();
    const ip = `203.0.113.${(RUN % 200) + 1}`;
    const src = hashIp(ip)!;
    for (let i = 0; i < FEEDBACK_INSERTS_PER_SOURCE_HOUR; i++) {
      recordFeedbackRow({ error_type: 'other', notes: `pre-${i}`, ipHash: src });
    }
    const before = countRecentFeedback(src, 1);
    const res = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ notes: 'one more' }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('feedback_rate_limited');
    // The refused report must NOT have been written.
    expect(countRecentFeedback(src, 1)).toBe(before);
  });

  it('accepts a genuine report from a fresh source', async () => {
    const app = makeApp();
    const ip = `203.0.114.${(RUN % 200) + 1}`;
    const res = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ notes: 'genuine report', error_type: 'missing_data' }),
    });
    expect(res.status).toBe(201);
  });
});

/**
 * The reader the loop never had: send_feedback promised "a human reads every
 * report" while no endpoint could list reports. These pin the admin surface.
 */
describe('GET /v1/admin/feedback — the reader', () => {
  const SECRET = `fb-admin-${RUN}`;
  const saved = process.env.ADMIN_SECRET;
  beforeAll(() => {
    process.env.ADMIN_SECRET = SECRET;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = saved;
  });

  it('refuses without the secret — full notes are private', async () => {
    const app = makeApp();
    expect((await app.request('/v1/admin/feedback')).status).toBe(401);
  });

  it('lists newest first with the open count, and status marks a report done', async () => {
    const app = makeApp();
    const marker = `admin-read-${RUN}`;
    const id = recordFeedbackRow({ error_type: 'missing_data', notes: marker, ipHash: null });
    const res = await app.request('/v1/admin/feedback?limit=200', {
      headers: { 'X-Admin-Secret': SECRET },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      open: number;
      reports: Array<{ id: number; notes: string; status: string }>;
    };
    const mine = body.reports.find((r) => r.id === id);
    expect(mine?.notes).toBe(marker);
    expect(mine?.status).toBe('open');
    expect(body.open).toBeGreaterThan(0);

    const done = await app.request('/v1/admin/feedback/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id, status: 'done' }),
    });
    expect(((await done.json()) as { updated: number }).updated).toBe(1);
    const after = (await (
      await app.request(`/v1/admin/feedback?status=done&limit=200`, {
        headers: { 'X-Admin-Secret': SECRET },
      })
    ).json()) as { reports: Array<{ id: number }> };
    expect(after.reports.some((r) => r.id === id)).toBe(true);
  });

  it('refuses a status outside the two-state model', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/feedback/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: 1, status: 'archived' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('scanner probes are noise, not open reports', () => {
  it('a probe marker with nothing else lands as noise; a real complaint stays open', async () => {
    const { isScannerProbe, recordFeedbackRow } = await import('./feedback.js');
    expect(
      isScannerProbe({
        error_type: 'wrong_validation',
        notes: 'probe-jhpyoj',
        agent: 'mcp-npm',
        ipHash: null,
      }),
    ).toBe(true);
    expect(isScannerProbe({ error_type: 'other', notes: 'test', ipHash: null })).toBe(true);
    expect(
      isScannerProbe({
        error_type: 'stale_bic',
        endpoint: '/v1/bic/ABCDCHZZ',
        notes: 'merged',
        ipHash: null,
      }),
    ).toBe(false);
    expect(
      isScannerProbe({
        error_type: 'wrong_validation',
        notes: 'CH IBAN of Bank Alpha comes back not_in_register',
        ipHash: null,
      }),
    ).toBe(false);
    const { getStatsDB } = await import('../lib/db.js');
    const noise = recordFeedbackRow({
      error_type: 'wrong_validation',
      notes: 'probe-qyvhxf',
      agent: 'mcp-npm',
      ipHash: null,
    });
    const real = recordFeedbackRow({
      error_type: 'stale_bic',
      endpoint: '/v1/bic/ABCDCHZZ',
      notes: 'merged',
      ipHash: null,
    });
    const status = (id: number) =>
      (
        getStatsDB().prepare('SELECT status FROM feedback WHERE id = ?').get(id) as {
          status: string;
        }
      ).status;
    expect(status(noise)).toBe('noise');
    expect(status(real)).toBe('open');
  });
});
