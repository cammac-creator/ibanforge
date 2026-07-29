import { describe, it, expect } from 'vitest';
import { sendingAccount, OUR_MAILBOXES } from './sending-account';

describe('sendingAccount', () => {
  it('uses the mailbox the contact is filed under when the draft says nothing', () => {
    expect(sendingAccount(null, 'claude-alain@ibanforge.com')).toBe('claude-alain@ibanforge.com');
    expect(sendingAccount('', 'cammac@bluewin.ch')).toBe('cammac@bluewin.ch');
  });

  it('lets a draft pin a different one of OUR mailboxes', () => {
    // A reply to a warm thread must leave from the mailbox that carries it,
    // even if the contact would otherwise default to the cold one.
    expect(sendingAccount('cammac@bluewin.ch', 'claude-alain@ibanforge.com')).toBe('cammac@bluewin.ch');
  });

  it('refuses a recipient address masquerading as the sending account', () => {
    // The bug this exists for. A draft posted through the admin API carried
    // counterparty: the customer's own address, the card handed it to the send
    // path as the FROM mailbox, and the VPS answered "no active account
    // petteri@asterpay.io" in front of the operator, at send time.
    expect(sendingAccount('petteri@asterpay.io', 'claude-alain@ibanforge.com')).toBe(
      'claude-alain@ibanforge.com',
    );
  });

  it('is case and whitespace insensitive, since the field is hand-filled', () => {
    expect(sendingAccount('  Claude-Alain@IBANforge.com ', 'cammac@bluewin.ch')).toBe(
      'claude-alain@ibanforge.com',
    );
  });

  it('never returns something outside our mailboxes, whatever it is handed', () => {
    for (const junk of ['nope', 'x@y.z', '@', 'claude-alain@ibanforge.com.evil.test', undefined]) {
      expect(OUR_MAILBOXES).toContain(sendingAccount(junk, 'claude-alain@ibanforge.com'));
    }
  });

  it('falls back to the cold mailbox if even the contact carries nothing usable', () => {
    // Belt and braces: the return value is fed straight to SMTP, so there is no
    // acceptable "empty" answer.
    expect(sendingAccount(null, '')).toBe('claude-alain@ibanforge.com');
    expect(sendingAccount(null, 'someone@elsewhere.test')).toBe('claude-alain@ibanforge.com');
  });
});
