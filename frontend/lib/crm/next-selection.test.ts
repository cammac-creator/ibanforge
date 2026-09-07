import { describe, expect, it } from 'vitest';
import { nextSelectionAfterSend } from './next-selection';

/** Invented fixtures only; example.net is reserved by RFC 2606. */
const rows = ['alpha@example.net', 'beta@example.net', 'gamma@example.net'];

describe('nextSelectionAfterSend', () => {
  it('gives the row that follows the one just answered', () => {
    expect(nextSelectionAfterSend(rows, 'alpha@example.net')).toBe('beta@example.net');
    expect(nextSelectionAfterSend(rows, 'beta@example.net')).toBe('gamma@example.net');
  });

  it('stops at the end of the list rather than wrapping round', () => {
    // Wrapping would re-open a file already done and make the run endless.
    expect(nextSelectionAfterSend(rows, 'gamma@example.net')).toBeNull();
  });

  it('answers nothing when no file is open', () => {
    expect(nextSelectionAfterSend(rows, null)).toBeNull();
  });

  it('answers nothing on an empty list', () => {
    expect(nextSelectionAfterSend([], 'alpha@example.net')).toBeNull();
  });

  it('answers nothing when the open file left the list', () => {
    // The defect this pins: `indexOf` gives -1, and -1 + 1 is 0. A naive read
    // would jump to the TOP of the queue — a row already done. Sending a reply
    // really does drop a contact out of "À répondre" on the refresh that
    // follows the send, so this is the ordinary path, not a corner case.
    expect(nextSelectionAfterSend(rows, 'delta@example.net')).toBeNull();
  });

  it('reads the list it is handed, so a filtered queue stays the queue', () => {
    const queue = ['beta@example.net', 'gamma@example.net'];
    expect(nextSelectionAfterSend(queue, 'beta@example.net')).toBe('gamma@example.net');
    // alpha is in the base but not in this queue: no next, rather than a jump
    // out of the run the operator is doing.
    expect(nextSelectionAfterSend(queue, 'alpha@example.net')).toBeNull();
  });
});
