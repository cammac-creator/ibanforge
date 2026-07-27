import { describe, expect, it } from 'vitest';
import { PREVIOUS_MAIL_CHARS, threadTail } from './thread-tail';
import type { Message } from './types';

/** Invented content only; nothing here is anyone's real correspondence. */

const msg = (
  direction: Message['direction'],
  over: Partial<Message> = {},
): Message => ({
  direction,
  msg_date: '2026-07-01T10:00',
  subject: null,
  snippet: null,
  counterparty: null,
  ...over,
});

const LABEL_FULL = 'MY PREVIOUS MAIL, in full. Do not repeat any of it, not one sentence:';
const LABEL_CUT = `MY PREVIOUS MAIL, its first ${PREVIOUS_MAIL_CHARS} characters. Do not repeat any of it:`;
const LABEL_OPENING =
  'MY PREVIOUS MAIL, opening only, the rest is not stored. Do not repeat any of it:';

describe('threadTail', () => {
  it('is empty on a thread with no message', () => {
    expect(threadTail([])).toBe('');
  });

  it('quotes the body of the last outbound message, not its snippet', () => {
    const body = 'Full body of the mail that went out, several sentences long.';
    const out = threadTail([msg('out', { snippet: 'Full body of the', body })]);
    expect(out).toContain(body);
    expect(out).toContain(LABEL_FULL);
  });

  it('names the sender and the date exactly as before on the marked line', () => {
    const out = threadTail([msg('out', { msg_date: '2026-07-01T10:00', body: 'Hello there.' })]);
    expect(out.startsWith('[me 2026-07-01T10:00] ')).toBe(true);
  });

  it('leaves inbound messages on their snippet', () => {
    const out = threadTail([
      msg('in', { msg_date: '2026-06-01T08:00', snippet: 'Their short reply', body: 'Their long reply' }),
      msg('out', { msg_date: '2026-06-02T08:00', body: 'Our answer' }),
    ]);
    expect(out).toContain('[them 2026-06-01T08:00] Their short reply');
    expect(out).not.toContain('Their long reply');
  });

  it('marks the last outbound message only, when several were sent', () => {
    const out = threadTail([
      msg('out', { msg_date: '2026-06-01T08:00', snippet: 'first mail', body: 'first mail in full' }),
      msg('out', { msg_date: '2026-06-20T08:00', snippet: 'second mail', body: 'second mail in full' }),
    ]);
    expect(out).toContain('[me 2026-06-01T08:00] first mail');
    expect(out).not.toContain('first mail in full');
    expect(out).toContain('second mail in full');
    expect(out.match(/MY PREVIOUS MAIL/g)).toHaveLength(1);
  });

  it('keeps only the last four messages', () => {
    const out = threadTail([
      msg('in', { snippet: 'oldest' }),
      msg('in', { snippet: 'second' }),
      msg('in', { snippet: 'third' }),
      msg('in', { snippet: 'fourth' }),
      msg('in', { snippet: 'newest' }),
    ]);
    expect(out).not.toContain('oldest');
    expect(out.split('\n')).toHaveLength(4);
  });

  it('marks nothing when the tail is all inbound', () => {
    const out = threadTail([
      msg('out', { snippet: 'our old mail', body: 'our old mail in full' }),
      msg('in', { snippet: 'a' }),
      msg('in', { snippet: 'b' }),
      msg('in', { snippet: 'c' }),
      msg('in', { snippet: 'd' }),
    ]);
    expect(out).not.toContain('MY PREVIOUS MAIL');
    expect(out).not.toContain('our old mail in full');
  });

  it('never marks a draft, which never left', () => {
    const out = threadTail([msg('draft', { snippet: 'parked text', body: 'parked text in full' })]);
    expect(out).not.toContain('MY PREVIOUS MAIL');
    expect(out).toContain('[me 2026-07-01T10:00] parked text');
  });

  it('cuts a body longer than the cap and says so', () => {
    const body = 'x'.repeat(PREVIOUS_MAIL_CHARS + 500);
    const out = threadTail([msg('out', { body })]);
    expect(out).toContain(LABEL_CUT);
    expect(out).toContain('[cut here]');
    expect(out).not.toContain(LABEL_FULL);
    expect(out.length).toBeLessThan(PREVIOUS_MAIL_CHARS + 200);
  });

  it('keeps a body of exactly the cap whole', () => {
    const body = 'y'.repeat(PREVIOUS_MAIL_CHARS);
    const out = threadTail([msg('out', { body })]);
    expect(out).toContain(LABEL_FULL);
    expect(out).not.toContain('[cut here]');
  });

  it('falls back to the snippet when the body is missing, without claiming it is whole', () => {
    const out = threadTail([msg('out', { snippet: 'only the opening lines' })]);
    expect(out).toContain(LABEL_OPENING);
    expect(out).toContain('only the opening lines');
    expect(out).not.toContain(LABEL_FULL);
  });

  it('treats a blank body as a missing one', () => {
    const out = threadTail([msg('out', { snippet: 'the opening', body: '   \n  ' })]);
    expect(out).toContain(LABEL_OPENING);
    expect(out).toContain('the opening');
  });

  it('skips an outbound message with no text at all and marks the one before it', () => {
    const out = threadTail([
      msg('out', { msg_date: '2026-06-01T08:00', body: 'the real previous mail' }),
      msg('out', { msg_date: '2026-06-02T08:00', snippet: null, body: null }),
    ]);
    expect(out).toContain('the real previous mail');
    expect(out).toContain(LABEL_FULL);
  });

  it('marks nothing when the only outbound message is empty', () => {
    const out = threadTail([msg('out', { snippet: '', body: '' })]);
    expect(out).not.toContain('MY PREVIOUS MAIL');
    expect(out).toBe('[me 2026-07-01T10:00] ');
  });

  it('tolerates a message with no date', () => {
    const out = threadTail([msg('out', { msg_date: null, body: 'sent, undated' })]);
    expect(out.startsWith('[me ] ')).toBe(true);
    expect(out).toContain('sent, undated');
  });

  it('never mutates the array it was given', () => {
    const messages = [msg('out', { body: 'a' }), msg('in', { snippet: 'b' })];
    const copy = [...messages];
    threadTail(messages);
    expect(messages).toEqual(copy);
  });
});
