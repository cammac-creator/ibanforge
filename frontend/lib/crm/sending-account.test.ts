import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { SENDING_ACCOUNT, isCompanyMailbox, sendingAccount, ourMailboxes } from './sending-account';

// The variable that used to name a personal mailbox is set here on purpose:
// a server that still carries it must not send from it.
const PERSONAL = 'warm@personal.invalid';
const saved = process.env.CRM_WARM_ACCOUNT;
beforeAll(() => {
  process.env.CRM_WARM_ACCOUNT = PERSONAL;
});
afterAll(() => {
  if (saved === undefined) delete process.env.CRM_WARM_ACCOUNT;
  else process.env.CRM_WARM_ACCOUNT = saved;
});

describe('sendingAccount', () => {
  it('leaves from the company mailbox', () => {
    expect(SENDING_ACCOUNT).toBe('claude-alain@ibanforge.com');
    expect(sendingAccount(null, 'claude-alain@ibanforge.com')).toBe('claude-alain@ibanforge.com');
  });

  it('never leaves from a personal mailbox, even one a draft or a contact still names', () => {
    // The rule of 26/10/2026: a reply to an old thread included.
    expect(sendingAccount(PERSONAL, 'claude-alain@ibanforge.com')).toBe(SENDING_ACCOUNT);
    expect(sendingAccount('', PERSONAL)).toBe(SENDING_ACCOUNT);
    expect(sendingAccount(PERSONAL, PERSONAL)).toBe(SENDING_ACCOUNT);
    expect(ourMailboxes()).not.toContain(PERSONAL);
  });

  it('refuses a recipient address masquerading as the sending account', () => {
    // The bug this exists for. A draft posted through the admin API carried
    // counterparty: the customer's own address, the card handed it to the send
    // path as the FROM mailbox, and the VPS answered "no active account
    // pilot@example.com" in front of the operator, at send time.
    expect(sendingAccount('pilot@example.com', 'claude-alain@ibanforge.com')).toBe(
      'claude-alain@ibanforge.com',
    );
  });

  it('is case and whitespace insensitive, since the field is hand-filled', () => {
    expect(sendingAccount('  Claude-Alain@IBANforge.com ', null)).toBe('claude-alain@ibanforge.com');
  });

  it('never returns something outside our mailboxes, whatever it is handed', () => {
    for (const junk of ['nope', 'x@y.z', '@', 'claude-alain@ibanforge.com.evil.test', PERSONAL, undefined]) {
      expect(ourMailboxes()).toContain(sendingAccount(junk, 'claude-alain@ibanforge.com'));
    }
  });

  it('falls back to the company mailbox if even the contact carries nothing usable', () => {
    // Belt and braces: the return value is fed straight to SMTP, so there is no
    // acceptable "empty" answer.
    expect(sendingAccount(null, '')).toBe('claude-alain@ibanforge.com');
    expect(sendingAccount(null, 'someone@elsewhere.test')).toBe('claude-alain@ibanforge.com');
  });
});

describe('isCompanyMailbox', () => {
  it('accepts an address of the company domain', () => {
    expect(isCompanyMailbox('claude-alain@ibanforge.com')).toBe(true);
    expect(isCompanyMailbox('  Claude-Alain@IBANforge.com ')).toBe(true);
  });

  it('refuses a personal mailbox, a lookalike and anything that is not one address', () => {
    for (const value of [
      PERSONAL,
      'someone@example.com',
      'x@ibanforge.com.evil.test',
      'x@mail.ibanforge.com',
      'x@ibanforge.co',
      'a@b@ibanforge.com',
      '@ibanforge.com',
      'ibanforge.com',
      '',
      'main',
      null,
      undefined,
      42,
    ]) {
      expect(isCompanyMailbox(value)).toBe(false);
    }
  });
});
