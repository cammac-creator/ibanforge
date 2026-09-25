import { describe, it, expect } from 'vitest';
import {
  CREDITS_NOTICE_LOCK_PREFIX,
  creditsNoticeLock,
  creditsNoticeThreshold,
  crossesCreditsNotice,
  maybeSendCreditsWarning,
} from './quota-notice.js';
import { generateCreditKey, recordQuotaNotice, validateApiKey } from './api-keys.js';
import { getStatsDB } from './db.js';
import { buildApiKeyEmail, buildCreditsWarningEmail } from './email.js';
import { ACCOUNT_PAGE } from './first-call.js';
import { PAYMENT_LINKS, PRO_PAYMENT_LINK } from './payment-links.js';
import { CREDITS_NOTICE_RATIO } from './tiers.js';

const RUN_ID = Date.now();
/** Inventée et routable (fixtures de CLAUDE.md) : elle passe toutes les gardes d'adresse. */
const HOLDER = 'holder@alpha-corp.example.net';
const FAKE_KEY = 'ifk_' + 'a1b2c3d4'.repeat(8);
const FAKE_PREFIX = FAKE_KEY.slice(0, 12);

function packKey(email: string | null, credits: number): string {
  return validateApiKey(generateCreditKey(email, credits).api_key).keyHash;
}

function input(keyHash: string, email: string, total = 1000) {
  return { keyHash, email, keyPrefix: 'ifk_test0000', remaining: total / 10, total };
}

describe('the 10% threshold of a prepaid pack', () => {
  it('is a tenth of what the pack held, rounded down, for every pack sold', () => {
    expect(CREDITS_NOTICE_RATIO).toBe(0.1);
    expect(creditsNoticeThreshold(1000)).toBe(100);
    expect(creditsNoticeThreshold(5000)).toBe(500);
    expect(creditsNoticeThreshold(25000)).toBe(2500);
    expect(creditsNoticeThreshold(15)).toBe(1);
  });

  it('does not exist for a pack too small to have one, or an unknown one', () => {
    for (const total of [9, 0, -5, Number.NaN]) expect(creditsNoticeThreshold(total)).toBe(0);
  });

  it('fires on the one call that takes the balance to the threshold or under', () => {
    expect(crossesCreditsNotice(101, 100, 1000)).toBe(true);
    // Un lot peut le sauter d'un coup.
    expect(crossesCreditsNotice(150, 50, 1000)).toBe(true);
  });

  it('does not fire above it, nor again once under it', () => {
    expect(crossesCreditsNotice(200, 150, 1000)).toBe(false);
    expect(crossesCreditsNotice(100, 99, 1000)).toBe(false);
  });

  it('does not fire on a call handed back on a 4xx (balance unchanged)', () => {
    expect(crossesCreditsNotice(101, 101, 1000)).toBe(false);
  });

  it('never fires for a pack without a threshold: running out is the 402, not this e-mail', () => {
    expect(crossesCreditsNotice(1, 0, 9)).toBe(false);
  });

  it('locks under a key the monthly listing can tell apart from a month', () => {
    expect(creditsNoticeLock(1000)).toBe(`${CREDITS_NOTICE_LOCK_PREFIX}1000`);
    expect(creditsNoticeLock(1000)).not.toMatch(/^\d{4}-\d{2}$/);
  });
});

// Ces tests tournent sans relais de courrier, donc chaque envoi échoue exprès,
// exactement comme dans quota-notice.test.ts : un envoi raté ne doit pas brûler
// l'unique avertissement d'un pack.
describe('maybeSendCreditsWarning', () => {
  it('does not e-mail the placeholder addresses of buyers who gave none', async () => {
    const keyHash = packKey(null, 1000);
    for (const placeholder of ['credits-buyer', 'stripe-buyer', 'oem-subscriber', 'anonymous']) {
      expect(await maybeSendCreditsWarning(input(keyHash, placeholder))).toBe('no_contact');
    }
  });

  it('never mails a disposable or unroutable address', async () => {
    const keyHash = packKey(`cn-disp-${RUN_ID}@example.com`, 1000);
    expect(await maybeSendCreditsWarning(input(keyHash, 'x@yopmail.com'))).toBe(
      'unroutable_contact',
    );
  });

  it('has no age gate: a pack bought an hour ago is warned like any other', async () => {
    const keyHash = packKey(HOLDER, 1000);
    // Pas de relais en test, donc l'envoi échoue ; ce qui compte, c'est qu'il
    // ait été tenté, et non refusé pour clé trop récente.
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).toBe('send_failed');
  });

  it('releases the lock when the send fails, so the warning can be retried', async () => {
    const keyHash = packKey(HOLDER, 1000);
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).toBe('send_failed');
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).not.toBe('already_notified');
  });

  it('warns a given pack once', async () => {
    const keyHash = packKey(HOLDER, 1000);
    recordQuotaNotice(keyHash, creditsNoticeLock(1000)); // un avertissement est déjà parti
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).toBe('already_notified');
  });

  it('is not blocked by a monthly warning on the same key', async () => {
    const keyHash = packKey(HOLDER, 1000);
    recordQuotaNotice(keyHash, '2030-09');
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).toBe('send_failed');
  });

  it('does not mail a key the cohort radar flagged, and keeps its lock free', async () => {
    const keyHash = packKey(HOLDER, 1000);
    const db = getStatsDB();
    db.prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_hash = ?').run(keyHash);
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).toBe('flagged_cohort');
    db.prepare('UPDATE api_keys SET no_recredit = 0 WHERE key_hash = ?').run(keyHash);
    expect(await maybeSendCreditsWarning(input(keyHash, HOLDER))).not.toBe('already_notified');
  });
});

describe('what the pack holder reads', () => {
  const mail = buildCreditsWarningEmail({
    keyPrefix: FAKE_PREFIX,
    remaining: 100,
    total: 1000,
    proMonthlyLimit: 10_000,
  });

  it('names the key, the balance and the pack it came from', () => {
    expect(mail.subject).toContain(FAKE_PREFIX);
    expect(mail.subject).toContain('100');
    expect(mail.subject).toContain('10% alert');
    expect(mail.text).toContain('100 of its 1,000 prepaid credits');
    expect(mail.html).toContain(FAKE_PREFIX);
  });

  it('says what happens at zero, before it happens', () => {
    expect(mail.text).toContain('HTTP 402');
    expect(mail.html).toContain('HTTP 402');
  });

  it('gives the way to top up, and says a card purchase is a new key today', () => {
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain(PAYMENT_LINKS['1k']);
      expect(part).toContain(PRO_PAYMENT_LINK);
      expect(part).toContain('arrives as a new key');
    }
  });

  it('shows where to read the balance, three ways', () => {
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain(ACCOUNT_PAGE);
      expect(part).toContain('X-Credits-Remaining');
      expect(part).toContain('/v1/credits/balance');
    }
  });

  it('never carries the raw key: the prefix is all it can know', () => {
    expect(mail.text).not.toContain(FAKE_KEY);
    expect(mail.html).not.toContain(FAKE_KEY);
  });
});

describe('the purchase e-mail says "balance" in both parts', () => {
  const mail = buildApiKeyEmail({ rawKey: FAKE_KEY, credits: 1000, bundle: '1k' });

  it('the HTML part, the one a mail client shows, names the balance and where to read it', () => {
    expect(mail.html).toContain('Credits left, on your account page');
    expect(mail.html).toContain(ACCOUNT_PAGE);
    expect(mail.html).toContain('X-Credits-Remaining');
    expect(mail.html).toContain('/v1/credits/balance');
  });

  it('both parts announce the 10% warning', () => {
    expect(mail.text).toContain('when 10% of the pack is left');
    expect(mail.html).toContain('when 10% of the pack is left');
  });

  it('the text part keeps the call first, then the balance', () => {
    expect(mail.text.indexOf('30 seconds')).toBeLessThan(
      mail.text.indexOf('Your balance any time'),
    );
    expect(mail.text).toContain(`Authorization: Bearer ${FAKE_KEY}`);
  });
});
