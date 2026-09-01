import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_PAGE,
  FIRST_CALL_ENDPOINT,
  FIRST_CALL_IBAN,
  KEY_PLACEHOLDER,
  buildFirstCallCurl,
  buildFirstCallHtml,
  buildFirstCallText,
} from './first-call.js';
import { validateIBAN } from './iban.js';
import { buildActivationNudgeEmail, buildApiKeyEmail, buildFreeKeyEmail } from './email.js';
import * as emailModule from './email.js';

/**
 * Fixtures are invented (CLAUDE.md): a key shape that is real in form and
 * belongs to nobody.
 */
const FAKE_KEY = 'ifk_' + 'a1b2c3d4'.repeat(8);
const FAKE_PREFIX = FAKE_KEY.slice(0, 12);

/**
 * The shell command is the deliverable, so it is checked as a command and not
 * as prose: one logical line, every continuation escaped, quotes balanced.
 */
function isShellPasteable(curl: string): boolean {
  const lines = curl.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].endsWith('\\')) return false;
  }
  if (lines[lines.length - 1].endsWith('\\')) return false;
  const doubles = (curl.match(/"/g) ?? []).length;
  const singles = (curl.match(/'/g) ?? []).length;
  return doubles % 2 === 0 && singles % 2 === 0;
}

describe('buildFirstCallCurl', () => {
  it('carries the bearer, the endpoint and the example IBAN', () => {
    const curl = buildFirstCallCurl(FAKE_KEY);
    expect(curl).toContain(`Authorization: Bearer ${FAKE_KEY}`);
    expect(curl).toContain(FIRST_CALL_ENDPOINT);
    expect(curl).toContain(FIRST_CALL_IBAN);
    expect(curl.startsWith('curl -X POST')).toBe(true);
  });

  it('stays syntactically pasteable into a shell', () => {
    expect(isShellPasteable(buildFirstCallCurl(FAKE_KEY))).toBe(true);
  });

  it('uses an IBAN our own validator accepts (the promise must hold)', () => {
    // If this ever fails, every message below is telling readers to run a call
    // that answers valid:false, which is worse than sending nothing.
    expect(validateIBAN(FIRST_CALL_IBAN).valid).toBe(true);
  });
});

describe('buildFirstCallText / buildFirstCallHtml', () => {
  it('names the expected answer and links the account page', () => {
    const text = buildFirstCallText({ bearer: FAKE_KEY });
    expect(text).toContain('"valid": true');
    expect(text).toContain(ACCOUNT_PAGE);
    expect(text).toContain(FAKE_KEY);
  });

  it('says plainly that a placeholder is a placeholder, and names the prefix', () => {
    const text = buildFirstCallText({ bearer: KEY_PLACEHOLDER, keyPrefix: FAKE_PREFIX });
    expect(text).toContain(KEY_PLACEHOLDER);
    expect(text).toContain(FAKE_PREFIX);
    expect(text).toContain('only its hash');
  });

  it('omits the placeholder note when the real key is in hand', () => {
    expect(buildFirstCallText({ bearer: FAKE_KEY })).not.toContain('only its hash');
  });

  it('escapes the HTML it is handed', () => {
    const html = buildFirstCallHtml({ bearer: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

/**
 * Em and en dashes render as mojibake in several mail clients and read as
 * marketing polish. The repo already carries stripDashes() as a safety net for
 * generated copy; these messages are handwritten, so the guard is a test.
 */
const DASHES = /[—–]/;

describe('outgoing message bodies carry no em or en dash', () => {
  /**
   * One fixture per builder email.ts exports, and the completeness is LOCKED:
   * a hand-kept list is how the rule held on three builders while a fourth
   * shipped dashes unswept. Add a builder to email.ts and this map must gain a
   * fixture, or the lock test below names the omission.
   */
  const fixtures: Record<string, { subject: string; text: string; html: string }> = {
    buildFreeKeyEmail: buildFreeKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: 200 }),
    buildApiKeyEmail: buildApiKeyEmail({ rawKey: FAKE_KEY, credits: 1000, bundle: '1k' }),
    buildActivationNudgeEmail: buildActivationNudgeEmail({ keyPrefix: FAKE_PREFIX }),
    buildQuotaWarningEmail: emailModule.buildQuotaWarningEmail({
      used: 160,
      limit: 200,
      month: '2026-08',
      keyPrefix: FAKE_PREFIX,
    }),
    // Added 2026-09-01 (BIZ-14). These two messages were live and unswept: both
    // were assembled inside their async sender, so the lock test above could not
    // see them and the OEM subject shipped an em dash. Making them pure is what
    // makes the rule enforceable, not the dash removal itself.
    buildOemKeyEmail: emailModule.buildOemKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: 50_000 }),
    buildKeyVerificationEmail: emailModule.buildKeyVerificationEmail({ code: '123456' }),
  };

  it('the sweep covers every builder the module exports', () => {
    const exported = Object.keys(emailModule)
      .filter((name) => /^build[A-Za-z]*Email$/.test(name))
      .sort();
    expect(exported, 'a mail builder has no dash fixture — add it to `fixtures` above').toEqual(
      Object.keys(fixtures).sort(),
    );
  });

  it.each(Object.entries(fixtures))('%s', (_name, mail) => {
    expect(DASHES.test(mail.subject), `subject: ${mail.subject}`).toBe(false);
    expect(DASHES.test(mail.text), 'text part').toBe(false);
    expect(DASHES.test(mail.html), 'html part').toBe(false);
  });
});

/**
 * SEC-08 (2026-09-01): a failed send used to print the customer's address into
 * stdout, which Railway keeps. The log still has to be actionable, so the
 * domain stays and the local part goes.
 */
describe('recipientDomain', () => {
  it('keeps the domain and drops the person', () => {
    expect(emailModule.recipientDomain('acme@example.com')).toBe('example.com');
    expect(emailModule.recipientDomain('Acme@Alpha.Example.NET')).toBe('alpha.example.net');
  });

  it('never returns something address-shaped, whatever it is handed', () => {
    for (const weird of ['', 'no-at-sign', 'trailing@', '@leading', 'a@b@c']) {
      const out = emailModule.recipientDomain(weird);
      expect(out).not.toContain('@');
    }
    expect(emailModule.recipientDomain('trailing@')).toBe('unknown');
    // Two @ signs: the LAST one delimits the domain, so nothing of the local
    // part can ride along in the log.
    expect(emailModule.recipientDomain('a@b@example.com')).toBe('example.com');
  });
});

describe('the key reaches every message that claims to carry it', () => {
  it('free key delivery prints the raw key and the working curl', () => {
    const mail = buildFreeKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: 200 });
    expect(mail.text).toContain(FAKE_KEY);
    expect(mail.html).toContain(FAKE_KEY);
    expect(mail.text).toContain(`Authorization: Bearer ${FAKE_KEY}`);
    expect(mail.text).toContain(FIRST_CALL_IBAN);
    // A first-call message must not double as a sales pitch.
    expect(mail.text.toLowerCase()).not.toContain('credits  $');
  });

  it('purchase delivery leads with the call, then the balance check', () => {
    const mail = buildApiKeyEmail({ rawKey: FAKE_KEY, credits: 5000, bundle: '5k' });
    expect(mail.text).toContain(`Authorization: Bearer ${FAKE_KEY}`);
    expect(mail.text).toContain(FIRST_CALL_IBAN);
    expect(mail.text).toContain('5,000');
    expect(mail.text.indexOf('30 seconds')).toBeLessThan(mail.text.indexOf('/v1/credits/balance'));
  });

  it('the nudge never invents a key it cannot know', () => {
    const mail = buildActivationNudgeEmail({ keyPrefix: FAKE_PREFIX });
    expect(mail.text).toContain(KEY_PLACEHOLDER);
    expect(mail.text).toContain(FAKE_PREFIX);
    expect(mail.text).not.toContain(FAKE_KEY);
    expect(mail.text).toContain('Claude-Alain Martin');
    expect(mail.text).toContain('Reply to this email');
  });
});
