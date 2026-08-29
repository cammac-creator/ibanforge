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
  const cases = [
    ['free key delivery', buildFreeKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: 200 })],
    ['purchase delivery', buildApiKeyEmail({ rawKey: FAKE_KEY, credits: 1000, bundle: '1k' })],
    ['activation nudge', buildActivationNudgeEmail({ keyPrefix: FAKE_PREFIX })],
  ] as const;

  it.each(cases)('%s', (_name, mail) => {
    expect(DASHES.test(mail.subject), `subject: ${mail.subject}`).toBe(false);
    expect(DASHES.test(mail.text), 'text part').toBe(false);
    expect(DASHES.test(mail.html), 'html part').toBe(false);
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
