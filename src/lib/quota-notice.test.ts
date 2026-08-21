import { describe, it, expect } from 'vitest';
import { maybeSendQuotaWarning, MIN_KEY_AGE_HOURS } from './quota-notice.js';
import { generateApiKey, validateApiKey } from './api-keys.js';
import { getStatsDB } from './db.js';

const RUN_ID = Date.now();

function input(keyHash: string, email: string, month: string) {
  return { keyHash, email, keyPrefix: 'ifk_test0000', used: 160, limit: 200, month };
}

/**
 * Freshly generated keys are younger than MIN_KEY_AGE_HOURS by construction,
 * which is exactly what the too-new guard refuses. Tests that exercise the
 * LATER stages of the pipeline backdate their fixture past the guard.
 */
function makeAgedKey(email: string): string {
  const { keyHash } = validateApiKey(generateApiKey(email)!.api_key);
  getStatsDB()
    .prepare("UPDATE api_keys SET created_at = datetime('now', '-3 days') WHERE key_hash = ?")
    .run(keyHash);
  return keyHash;
}

// These tests run without SMTP_* configured, so every send fails by design.
// That is the interesting case: a failed send must not silently consume the
// one warning a key gets per month.
describe('maybeSendQuotaWarning', () => {
  it('does not email the placeholder addresses used for anonymous buyers', async () => {
    const keyHash = makeAgedKey(`qn-ph-${RUN_ID}@example.com`);

    for (const placeholder of ['credits-buyer', 'stripe-buyer', 'oem-subscriber']) {
      expect(await maybeSendQuotaWarning(input(keyHash, placeholder, '2030-01'))).toBe('no_contact');
    }
  });

  it('never mails a disposable or unroutable address', async () => {
    const keyHash = makeAgedKey(`qn-disp-${RUN_ID}@example.com`);

    expect(await maybeSendQuotaWarning(input(keyHash, 'x@yopmail.com', '2030-05'))).toBe('unroutable_contact');
    expect(await maybeSendQuotaWarning(input(keyHash, 'x@tempmail.edu.ge', '2030-05'))).toBe('unroutable_contact');
    expect(await maybeSendQuotaWarning(input(keyHash, 'cohorte@cohorte.invalid', '2030-05'))).toBe('unroutable_contact');
  });

  it(`never mails a key younger than ${MIN_KEY_AGE_HOURS}h — the invented-address wave crosses 80% within minutes of signup`, async () => {
    const { keyHash } = validateApiKey(generateApiKey(`qn-young-${RUN_ID}@example.com`)!.api_key);

    expect(await maybeSendQuotaWarning(input(keyHash, 'holder@alpha-corp.example.net', '2030-06'))).toBe('too_new');
  });

  it('a refused address must not burn the once-per-month lock', async () => {
    const keyHash = makeAgedKey(`qn-lock-${RUN_ID}@example.com`);

    expect(await maybeSendQuotaWarning(input(keyHash, 'x@mailinator.com', '2030-07'))).toBe('unroutable_contact');
    // Same key, now with a routable address: the lock must still be free
    // (outcome is send_failed because SMTP is unset, NOT already_notified).
    expect(await maybeSendQuotaWarning(input(keyHash, 'holder@alpha-corp.example.net', '2030-07'))).toBe('send_failed');
  });

  it('releases the once-per-month lock when the send fails, so it can be retried', async () => {
    const keyHash = makeAgedKey(`qn-retry-${RUN_ID}@example.com`);

    const first = await maybeSendQuotaWarning(input(keyHash, 'holder@alpha-corp.example.net', '2030-02'));
    const second = await maybeSendQuotaWarning(input(keyHash, 'holder@alpha-corp.example.net', '2030-02'));

    expect(first).toBe('send_failed');
    expect(second).not.toBe('already_notified');
  });

  it('warns a given key at most once per month', async () => {
    const keyHash = makeAgedKey(`qn-once-${RUN_ID}@example.com`);
    const { recordQuotaNotice } = await import('./api-keys.js');
    recordQuotaNotice(keyHash, '2030-03'); // a warning already went out this month

    expect(await maybeSendQuotaWarning(input(keyHash, 'holder@alpha-corp.example.net', '2030-03'))).toBe('already_notified');
  });
});

/**
 * The cohort guard. Added 21/08 after the mail audit: `no_recredit` already
 * stopped the monthly re-credit for a farm key, but nothing stopped the mail,
 * so a farm key not yet relabelled to `@cohorte.invalid` still got written to.
 */
describe('maybeSendQuotaWarning — flagged cohorts', () => {
  function flag(keyHash: string): void {
    getStatsDB().prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_hash = ?').run(keyHash);
  }

  it('does not mail a key the cohort radar has flagged', async () => {
    const keyHash = makeAgedKey(`qn-farm-${RUN_ID}@example.com`);
    flag(keyHash);
    const outcome = await maybeSendQuotaWarning(input(keyHash, `qn-farm-${RUN_ID}@example.com`, '2026-08'));
    expect(outcome).toBe('flagged_cohort');
  });

  it('refuses before claiming the monthly lock, so the warning is not burned', async () => {
    const email = `qn-farm2-${RUN_ID}@example.com`;
    const keyHash = makeAgedKey(email);
    flag(keyHash);
    await maybeSendQuotaWarning(input(keyHash, email, '2026-08'));
    // Un-flag and retry: if the lock had been claimed, this would come back
    // 'already_notified' and the key would have lost its single warning.
    getStatsDB().prepare('UPDATE api_keys SET no_recredit = 0 WHERE key_hash = ?').run(keyHash);
    const second = await maybeSendQuotaWarning(input(keyHash, email, '2026-08'));
    expect(second).not.toBe('already_notified');
  });

  it('still mails a key that is not flagged', async () => {
    const email = `qn-ok-${RUN_ID}@example.com`;
    const keyHash = makeAgedKey(email);
    const outcome = await maybeSendQuotaWarning(input(keyHash, email, '2026-08'));
    // No SMTP in tests, so the send fails — but it got PAST the cohort guard,
    // which is what this asserts.
    expect(outcome).toBe('send_failed');
  });
});
