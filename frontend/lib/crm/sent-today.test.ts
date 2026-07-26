import { describe, expect, it } from 'vitest';
import type { MessageRow } from './build-contacts';
import { countSentToday, HARD_CAP, SOFT_CAP } from './sent-today';

/**
 * 22:00Z on purpose. It is already the next calendar day in Zurich and still
 * the same one in Honolulu, so an implementation that read the day off the
 * runtime's local calendar instead of off this instant in UTC would answer
 * differently depending on where it ran. The suite is run twice for that
 * reason, under TZ=UTC and under TZ=Pacific/Kiritimati (UTC+14); the expected
 * numbers below are the same in both.
 */
const TODAY = new Date('2026-07-25T22:00:00Z');

const row = (direction: 'in' | 'out' | 'draft', msg_date: string | null): MessageRow => ({
  customer_email: 'a@example.net',
  direction,
  msg_date,
  subject: null,
  snippet: null,
  counterparty: null,
});

describe('countSentToday', () => {
  it('counts only outbound messages dated today', () => {
    const n = countSentToday(
      [
        row('out', '2026-07-25T08:00'),
        row('out', '2026-07-25T20:00'),
        row('out', '2026-07-24T20:00'),
        row('in', '2026-07-25T09:00'),
      ],
      TODAY,
    );
    expect(n).toBe(2);
  });

  it('ignores drafts dated today', () => {
    expect(countSentToday([row('draft', '2026-07-25T10:00')], TODAY)).toBe(0);
  });

  it('returns zero on an empty list', () => {
    expect(countSentToday([], TODAY)).toBe(0);
  });

  it('does not count a mail dated after today', () => {
    // A stamp in the future is not "today". Without this the day comparison
    // could be a lower bound and nobody would notice.
    expect(countSentToday([row('out', '2026-07-26T07:00')], TODAY)).toBe(0);
  });

  it('does not count a mail with no date at all', () => {
    // msg_date is nullable in the schema. Treating a missing stamp as today
    // would inflate the counter with every undatable row in the table.
    expect(countSentToday([row('out', null)], TODAY)).toBe(0);
  });

  it('does not count a stamp it cannot read', () => {
    // The column is free text, clipped to 40 characters server-side, so rows
    // like this do exist. A stamp we cannot place carries no day, and most of
    // them are old, so assuming today would be wrong far more often than right.
    expect(countSentToday([row('out', 'Jan 5, 2026')], TODAY)).toBe(0);
  });

  it('counts a stamp written with a space instead of a T', () => {
    // The alternate shape format.ts already accepts. It is the same day.
    expect(countSentToday([row('out', '2026-07-25 08:00')], TODAY)).toBe(1);
  });

  it('reads the day off the instant given, in UTC', () => {
    // Under TZ=Pacific/Kiritimati the local calendar day of TODAY is the 26th,
    // so a local-calendar implementation answers 1 here instead of 2.
    const rows = [
      row('out', '2026-07-25T00:01'),
      row('out', '2026-07-25T23:59'),
      row('out', '2026-07-26T00:01'),
    ];
    expect(countSentToday(rows, TODAY)).toBe(2);
  });
});

describe('caps', () => {
  it('warns before it blocks', () => {
    // The rail's colour ladder and Lot 3's two guardrail codes both assume the
    // soft threshold is reached first. Swap them and the warning tier vanishes.
    expect(SOFT_CAP).toBeLessThan(HARD_CAP);
  });
});
