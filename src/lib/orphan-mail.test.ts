import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import {
  countPendingOrphans,
  getOrphans,
  isOrphanKind,
  recordOrphan,
  resolveOrphan,
} from './orphan-mail.js';

/**
 * Runs against the real stats database like the rest of the suite, so rows are
 * namespaced and removed rather than assumed absent.
 */
const P = 'test-orphan-';
function clean(): void {
  getStatsDB().prepare(`DELETE FROM orphan_mail WHERE id LIKE '${P}%'`).run();
}
function mine(rows: ReturnType<typeof getOrphans>) {
  return rows.filter((r) => r.id.startsWith(P));
}

describe('the queue of mail nobody can be attached to', () => {
  it('keeps one row per message, so a nightly re-run corrects instead of duplicating', () => {
    clean();
    // The sync re-sends the same window every day. A queue that grew a
    // duplicate per run would be abandoned inside a week, which is the same
    // failure as not having one.
    recordOrphan({
      id: `${P}1`,
      sender: 'A@Example.net',
      msg_date: '2026-01-05 10:00',
      kind: 'reply',
    });
    recordOrphan({
      id: `${P}1`,
      sender: 'a@example.net',
      subject: 'Re: IBANforge',
      msg_date: '2026-01-05 10:00',
      kind: 'reply',
    });
    const rows = mine(getOrphans());
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('Re: IBANforge');
    clean();
  });

  it('lowercases the sender, since the same person writes both ways', () => {
    clean();
    recordOrphan({
      id: `${P}2`,
      sender: '  Mixed@Example.NET ',
      msg_date: '2026-01-05 10:00',
      kind: 'reply',
    });
    expect(mine(getOrphans())[0].sender).toBe('mixed@example.net');
    clean();
  });

  it('puts replies above first contacts, because somebody is waiting on a reply', () => {
    clean();
    recordOrphan({
      id: `${P}new`,
      sender: 'cold@example.net',
      msg_date: '2026-01-06 08:00',
      kind: 'first_contact',
    });
    recordOrphan({
      id: `${P}old`,
      sender: 'known@example.net',
      msg_date: '2026-01-02 09:00',
      kind: 'reply',
    });
    // The reply is four days older and still comes first.
    expect(mine(getOrphans()).map((r) => r.id)).toEqual([`${P}old`, `${P}new`]);
    clean();
  });

  it('empties when dealt with, and remembers who it belonged to', () => {
    clean();
    recordOrphan({
      id: `${P}3`,
      sender: 'sender@example.net',
      msg_date: '2026-01-05 10:00',
      kind: 'reply',
    });
    const before = countPendingOrphans();
    expect(resolveOrphan(`${P}3`, 'acme@example.com')).toBe(true);
    expect(countPendingOrphans()).toBe(before - 1);
    expect(mine(getOrphans())).toHaveLength(0);
    const kept = mine(getOrphans(true))[0];
    expect(kept.resolved).toBe(1);
    expect(kept.resolved_as).toBe('acme@example.com');
    clean();
  });

  it('does not re-open a decision when the sync sees the message again', () => {
    clean();
    recordOrphan({
      id: `${P}4`,
      sender: 'sender@example.net',
      msg_date: '2026-01-05 10:00',
      kind: 'reply',
    });
    resolveOrphan(`${P}4`, 'acme@example.com');
    // Tomorrow's run sends the same message again. Re-seeing it is not a reason
    // to put a settled decision back in the operator's face.
    recordOrphan({
      id: `${P}4`,
      sender: 'sender@example.net',
      subject: 'Re: IBANforge',
      msg_date: '2026-01-05 10:00',
      kind: 'reply',
    });
    expect(mine(getOrphans())).toHaveLength(0);
    expect(mine(getOrphans(true))[0].resolved).toBe(1);
    clean();
  });

  it('serves the oldest waiting rows first, so the limit can only cut the newest', () => {
    clean();
    // A queue empties from its oldest end. With newest-first ordering, the
    // LIMIT in getOrphans silently dropped exactly the rows the wait had made
    // urgent; oldest-first makes the cut fall on what arrived a minute ago.
    recordOrphan({
      id: `${P}r-new`,
      sender: 'sender@example.net',
      msg_date: '2026-01-06 12:00',
      kind: 'reply',
    });
    recordOrphan({
      id: `${P}r-old`,
      sender: 'sender@example.net',
      msg_date: '2026-01-03 12:00',
      kind: 'reply',
    });
    recordOrphan({
      id: `${P}f-new`,
      sender: 'cold@example.net',
      msg_date: '2026-01-06 13:00',
      kind: 'first_contact',
    });
    recordOrphan({
      id: `${P}f-old`,
      sender: 'cold@example.net',
      msg_date: '2026-01-01 13:00',
      kind: 'first_contact',
    });
    expect(mine(getOrphans()).map((r) => r.id)).toEqual([
      `${P}r-old`,
      `${P}r-new`,
      `${P}f-old`,
      `${P}f-new`,
    ]);
    clean();
  });

  it('reports a miss rather than pretending to have resolved something', () => {
    expect(resolveOrphan(`${P}absent`, null)).toBe(false);
  });

  it('validates the kind on the way in', () => {
    expect(isOrphanKind('reply')).toBe(true);
    expect(isOrphanKind('first_contact')).toBe(true);
    expect(isOrphanKind('bounce')).toBe(false);
  });
});
