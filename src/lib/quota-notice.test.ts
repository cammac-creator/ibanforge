import { describe, it, expect } from 'vitest';
import { maybeSendQuotaWarning } from './quota-notice.js';
import { generateApiKey, validateApiKey } from './api-keys.js';

const RUN_ID = Date.now();

function input(keyHash: string, email: string, month: string) {
  return { keyHash, email, keyPrefix: 'ifk_test0000', used: 160, limit: 200, month };
}

// These tests run without SMTP_* configured, so every send fails by design.
// That is the interesting case: a failed send must not silently consume the
// one warning a key gets per month.
describe('maybeSendQuotaWarning', () => {
  it('does not email the placeholder addresses used for anonymous buyers', async () => {
    const { keyHash } = validateApiKey(generateApiKey(`qn-ph-${RUN_ID}@example.com`)!.api_key);

    for (const placeholder of ['credits-buyer', 'stripe-buyer', 'oem-subscriber']) {
      expect(await maybeSendQuotaWarning(input(keyHash, placeholder, '2030-01'))).toBe('no_contact');
    }
  });

  it('releases the once-per-month lock when the send fails, so it can be retried', async () => {
    const { keyHash } = validateApiKey(generateApiKey(`qn-retry-${RUN_ID}@example.com`)!.api_key);

    const first = await maybeSendQuotaWarning(input(keyHash, 'holder@acme.test', '2030-02'));
    const second = await maybeSendQuotaWarning(input(keyHash, 'holder@acme.test', '2030-02'));

    expect(first).toBe('send_failed');
    expect(second).not.toBe('already_notified');
  });

  it('warns a given key at most once per month', async () => {
    const { keyHash } = validateApiKey(generateApiKey(`qn-once-${RUN_ID}@example.com`)!.api_key);
    const { recordQuotaNotice } = await import('./api-keys.js');
    recordQuotaNotice(keyHash, '2030-03'); // a warning already went out this month

    expect(await maybeSendQuotaWarning(input(keyHash, 'holder@acme.test', '2030-03'))).toBe('already_notified');
  });
});
