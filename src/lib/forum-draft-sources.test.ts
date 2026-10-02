import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { NO_AI_DRAFT_SOURCES, POSTABLE_SOURCE_NAMES } from './forum-radar.js';
import { draftBackfillRows } from './forum-radar-server.js';
import { draftSystem } from './forum-draft-gen.js';

/**
 * Stack Overflow and Money.SE ban text drafted by a language model
 * (https://stackoverflow.com/help/gen-ai-policy,
 * https://money.stackexchange.com/help/gen-ai-policy). Their threads stay in
 * the Forums tab; the model never writes, nor translates, a reply for them.
 */

function thread(url: string, source: string, score: number): void {
  getStatsDB()
    .prepare(
      `INSERT INTO forum_threads (url, source, title, status, score, first_seen)
       VALUES (?, ?, 'Question inventée', 'new', ?, datetime('now'))`,
    )
    .run(url, source, score);
}

describe('no AI draft on the sites that ban it', () => {
  it('names the row sources, and leaves the scan of Stack Exchange alone', () => {
    expect([...NO_AI_DRAFT_SOURCES].sort()).toEqual(['money_se', 'stackoverflow']);
    // The scan is gated by fetcher name: the threads must keep coming in.
    expect(POSTABLE_SOURCE_NAMES.has('stackexchange')).toBe(true);
  });

  it('hands the model the GitHub thread only, even when the banned ones rank first', () => {
    thread('https://stackoverflow.com/questions/1/acme', 'stackoverflow', 95);
    thread('https://money.stackexchange.com/questions/2/acme', 'money_se', 90);
    thread('https://github.com/acme/alpha/issues/3', 'github', 40);
    for (let i = 0; i < 8; i++)
      thread(`https://stackoverflow.com/questions/${10 + i}/acme`, 'stackoverflow', 80);

    const rows = draftBackfillRows(6);
    expect(rows.map((r) => r.source)).toEqual(['github']);
  });

  it('a Stack Overflow thread that already has a draft is not sent for translation either', () => {
    getStatsDB()
      .prepare(
        `INSERT INTO forum_threads (url, source, title, status, score, first_seen, draft)
         VALUES ('https://stackoverflow.com/questions/99/acme', 'stackoverflow', 'Question inventée',
                 'to_answer', 99, datetime('now'), 'written by hand')`,
      )
      .run();
    expect(draftBackfillRows(50).some((r) => r.source === 'stackoverflow')).toBe(false);
  });

  it('the drafting prompt no longer asks for a Stack Overflow answer', () => {
    expect(draftSystem()).not.toMatch(/stack overflow/i);
  });
});
