import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendViaRelay, isRelayConfigured } from './mail-transport.js';

/**
 * Railway blocks outbound SMTP below its Pro plan — measured 2026-07-25 from
 * inside the production container: ports 25/465/587 all ETIMEDOUT, to
 * Infomaniak *and* to Gmail, while HTTPS/443 connected in 33ms. So mail leaves
 * over HTTPS, through the relay on the tabornio VPS.
 */
const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

function configure() {
  process.env.MAIL_RELAY_URL = 'https://relay.test/api/relay/send';
  process.env.MAIL_RELAY_SECRET = 'shared-secret';
}

const MAIL = { to: 'buyer@acme.test', subject: 'Quota at 80%', text: 'plain', html: '<p>rich</p>' };

describe('isRelayConfigured', () => {
  it('is false until both the URL and the shared secret are set', () => {
    delete process.env.MAIL_RELAY_URL;
    delete process.env.MAIL_RELAY_SECRET;
    expect(isRelayConfigured()).toBe(false);

    process.env.MAIL_RELAY_URL = 'https://relay.test/api/relay/send';
    expect(isRelayConfigured()).toBe(false); // secret still missing

    process.env.MAIL_RELAY_SECRET = 'shared-secret';
    expect(isRelayConfigured()).toBe(true);
  });
});

describe('sendViaRelay', () => {
  it('posts the message to the relay with the shared secret header', async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sent: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const ok = await sendViaRelay(MAIL);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://relay.test/api/relay/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Relay-Secret']).toBe('shared-secret');
    expect(JSON.parse(init.body as string)).toEqual(MAIL);
  });

  it('never sends and never throws when the relay is not configured', async () => {
    delete process.env.MAIL_RELAY_URL;
    delete process.env.MAIL_RELAY_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendViaRelay(MAIL)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the relay answers an error', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendViaRelay(MAIL)).toBe(false);
  });

  it('reports failure without throwing when the relay is unreachable', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendViaRelay(MAIL)).toBe(false);
  });

  it('bounds the wait so a hanging relay can never stall a caller', async () => {
    configure();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    }));

    await sendViaRelay(MAIL);

    // Without a timeout, a hung relay would block the Stripe webhook (which
    // awaits delivery) well past Stripe's ~10s deadline.
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
