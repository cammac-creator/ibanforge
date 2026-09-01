/**
 * What happens when a message does NOT leave (QUA-13 + SEC-08, 2026-09-01).
 *
 * The wording of each message is asserted in ./first-call.test.ts. This file is
 * about the other half: an undelivered key used to produce a `console.error`
 * carrying the customer's address and nothing else, while disk volume, 5xx rate
 * and sanctions age all raised ops alerts. A key that was paid for and never
 * arrived is indistinguishable, from every dashboard we own, from a customer
 * who simply never called.
 *
 * `./ops-alert.js` is mocked rather than exercised, for the reason spelled out
 * in ./record-safely.test.ts: the real one writes into `kv_state` inside
 * `stats.sqlite`, and a latched alert would make the second run of this suite
 * behave differently from the first.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const opsFail = vi.fn(async () => {});
vi.mock('./ops-alert.js', () => ({
  opsFail: (...args: unknown[]) => opsFail(...(args as [])),
  opsOk: async () => {},
}));

const email = await import('./email.js');

const FAKE_KEY = 'ifk_' + 'a1b2c3d4'.repeat(8);
const ENV = { vitest: process.env.VITEST, url: process.env.MAIL_RELAY_URL, secret: process.env.MAIL_RELAY_SECRET };

beforeEach(() => {
  opsFail.mockClear();
  // No relay configured means sendViaRelay returns false without a network
  // call: exactly the production shape of "the message did not leave".
  delete process.env.MAIL_RELAY_URL;
  delete process.env.MAIL_RELAY_SECRET;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of [
    ['VITEST', ENV.vitest],
    ['MAIL_RELAY_URL', ENV.url],
    ['MAIL_RELAY_SECRET', ENV.secret],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/**
 * The alert is muted under vitest on purpose (see alertKeyDeliveryFailure): the
 * Stripe webhook delivers without a VITEST guard and the suite drives it with
 * example addresses, so every `npm run check` would otherwise fire a real
 * Telegram alert on a shell that has the bot token set. The flag is lifted here,
 * and only here, to assert the production behaviour.
 */
async function asProduction<T>(fn: () => Promise<T>): Promise<T> {
  delete process.env.VITEST;
  try {
    // Awaited INSIDE the try: restoring the flag on the synchronous return of a
    // promise would put it back before the send ever reached its failure path,
    // and every assertion below would pass for the wrong reason.
    return await fn();
  } finally {
    process.env.VITEST = ENV.vitest ?? 'true';
  }
}

describe('a key that does not reach its mailbox raises an ops alert', () => {
  it('alerts when the paid-key delivery fails', async () => {
    const ok = await asProduction(() =>
      email.sendApiKeyEmail({ to: 'acme@example.com', rawKey: FAKE_KEY, credits: 1000, bundle: '1k' }),
    );
    expect(ok).toBe(false);
    expect(opsFail).toHaveBeenCalledTimes(1);
    const [key, detail, threshold] = opsFail.mock.calls[0] as unknown as [string, string, number];
    expect(key).toBe('mail:key-delivery');
    // Threshold 1: there is no acceptable number of undelivered keys.
    expect(threshold).toBe(1);
    expect(detail).toContain('purchase key delivery');
  });

  it('alerts when the free-key delivery fails', async () => {
    await asProduction(() => email.sendFreeKeyEmail({ to: 'acme@example.com', rawKey: FAKE_KEY, monthlyLimit: 200 }));
    expect(opsFail).toHaveBeenCalledTimes(1);
    expect((opsFail.mock.calls[0] as unknown as [string])[0]).toBe('mail:key-delivery');
  });

  it('alerts when the OEM key delivery fails', async () => {
    await asProduction(() => email.sendOemKeyEmail({ to: 'acme@example.com', rawKey: FAKE_KEY, monthlyLimit: 50_000 }));
    expect(opsFail).toHaveBeenCalledTimes(1);
  });

  /**
   * Losing a nudge is a missed nudge. Alerting on all six senders would drown
   * the two that mean a customer paid and got nothing.
   */
  it('stays quiet for the messages that carry no key', async () => {
    await asProduction(async () => {
      await email.sendActivationNudgeEmail({ to: 'acme@example.com', keyPrefix: FAKE_KEY.slice(0, 12) });
      await email.sendQuotaWarningEmail({
        to: 'acme@example.com',
        used: 160,
        limit: 200,
        month: '2026-08',
        keyPrefix: FAKE_KEY.slice(0, 12),
      });
      await email.sendKeyVerificationEmail({ to: 'acme@example.com', code: '123456' });
    });
    expect(opsFail).not.toHaveBeenCalled();
  });

  /**
   * ops-alert.ts rule 3: Telegram is not a declared processor. A corporate
   * domain names a customer nearly as well as their address does, so neither
   * travels. The domain goes to the log, where it makes the line actionable.
   */
  it('puts no address and no domain in the alert text', async () => {
    await asProduction(() =>
      email.sendApiKeyEmail({ to: 'ops@alpha.example.net', rawKey: FAKE_KEY, credits: 1000, bundle: '1k' }),
    );
    const detail = (opsFail.mock.calls[0] as unknown as [string, string])[1];
    expect(detail).not.toContain('@');
    expect(detail).not.toContain('alpha.example.net');
    expect(detail).not.toContain(FAKE_KEY);
  });

  it('logs the domain and never the person (SEC-08)', async () => {
    const spy = console.error as unknown as ReturnType<typeof vi.fn>;
    await email.sendApiKeyEmail({ to: 'ops@alpha.example.net', rawKey: FAKE_KEY, credits: 1000, bundle: '1k' });
    const logged = spy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(logged).toContain('alpha.example.net');
    expect(logged).not.toContain('ops@alpha.example.net');
  });

  /**
   * The mute is the thing that keeps the alert credible. If this ever turns
   * green-to-red, `npm run check` has started paging whoever runs it.
   */
  it('never alerts from inside the test suite', async () => {
    await email.sendApiKeyEmail({ to: 'acme@example.com', rawKey: FAKE_KEY, credits: 1000, bundle: '1k' });
    expect(process.env.VITEST).toBeTruthy();
    expect(opsFail).not.toHaveBeenCalled();
  });
});
