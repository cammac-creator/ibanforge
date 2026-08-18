import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { feedback, recordFeedbackRow, countRecentFeedback, FEEDBACK_INSERTS_PER_SOURCE_HOUR } from './feedback.js';
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
      .get(id) as { notes: string; endpoint: string; expected: string; contact: string; agent: string };
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
