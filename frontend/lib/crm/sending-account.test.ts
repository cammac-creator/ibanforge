import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { warmAccount, sendingAccount, ourMailboxes } from './sending-account';

// The warm mailbox is a personal address, so it lives in CRM_WARM_ACCOUNT
// rather than in this public repository. The test supplies its own value: it
// exercises the wiring, and the real address is nobody's business here.
const TEST_WARM = 'warm@personal.invalid';
const saved = process.env.CRM_WARM_ACCOUNT;
beforeAll(() => {
  process.env.CRM_WARM_ACCOUNT = TEST_WARM;
});
afterAll(() => {
  if (saved === undefined) delete process.env.CRM_WARM_ACCOUNT;
  else process.env.CRM_WARM_ACCOUNT = saved;
});

describe('sendingAccount', () => {
  it('uses the mailbox the contact is filed under when the draft says nothing', () => {
    expect(sendingAccount(null, 'claude-alain@ibanforge.com')).toBe('claude-alain@ibanforge.com');
    expect(sendingAccount('', warmAccount())).toBe(warmAccount());
  });

  it('lets a draft pin a different one of OUR mailboxes', () => {
    // A reply to a warm thread must leave from the mailbox that carries it,
    // even if the contact would otherwise default to the cold one.
    expect(sendingAccount(warmAccount(), 'claude-alain@ibanforge.com')).toBe(warmAccount());
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
    expect(sendingAccount('  Claude-Alain@IBANforge.com ', warmAccount())).toBe(
      'claude-alain@ibanforge.com',
    );
  });

  it('never returns something outside our mailboxes, whatever it is handed', () => {
    for (const junk of ['nope', 'x@y.z', '@', 'claude-alain@ibanforge.com.evil.test', undefined]) {
      expect(ourMailboxes()).toContain(sendingAccount(junk, 'claude-alain@ibanforge.com'));
    }
  });

  it('falls back to the cold mailbox if even the contact carries nothing usable', () => {
    // Belt and braces: the return value is fed straight to SMTP, so there is no
    // acceptable "empty" answer.
    expect(sendingAccount(null, '')).toBe('claude-alain@ibanforge.com');
    expect(sendingAccount(null, 'someone@elsewhere.test')).toBe('claude-alain@ibanforge.com');
  });
});
