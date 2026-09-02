import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  sendViaRelay,
  deliverViaRelay,
  classifyRelayRefusal,
  isRelayConfigured,
  _setDomainCheckForTests,
} from './mail-transport.js';

// The DNS pre-check has its own module and tests; here it says yes.
beforeEach(() => _setDomainCheckForTests(async () => true));

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
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ sent: true }), { status: 200 }),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendViaRelay(MAIL)).toBe(false);
  });

  it('reports failure without throwing when the relay is unreachable', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendViaRelay(MAIL)).toBe(false);
  });

  it('bounds the wait so a hanging relay can never stall a caller', async () => {
    configure();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Response(JSON.stringify({ sent: true }), { status: 200 });
      }),
    );

    await sendViaRelay(MAIL);

    // Without a timeout, a hung relay would block the Stripe webhook (which
    // awaits delivery) well past Stripe's ~10s deadline.
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe('deliverViaRelay tells an address the server refuses from a relay that is down', () => {
  const REFUSED_RECIPIENT =
    "send failed: {'acme@alpha.example.net': (550, b'5.1.1 <acme@alpha.example.net>: Recipient address rejected: Domain not found')}";

  it('a 502 quoting a recipient refusal is undeliverable: the address is the problem', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(REFUSED_RECIPIENT, { status: 502 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await deliverViaRelay(MAIL);
    expect(r.outcome).toBe('undeliverable');
    expect(r.status).toBe(502);
    expect(await sendViaRelay(MAIL)).toBe(false);
  });

  it('a 502 without a recipient code is a refusal: the SMTP upstream is the problem', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('send failed: timed out', { status: 502 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliverViaRelay(MAIL)).outcome).toBe('refused');
  });

  it('a 401 is a refusal even when the body mentions a recipient: the shared secret is the problem', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized recipient', { status: 401 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliverViaRelay(MAIL)).outcome).toBe('refused');
  });

  it('a network error is unreachable, and no configuration is unconfigured', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliverViaRelay(MAIL)).outcome).toBe('unreachable');
    delete process.env.MAIL_RELAY_URL;
    expect((await deliverViaRelay(MAIL)).outcome).toBe('unconfigured');
  });

  it('never logs the relay text, which quotes the address', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(REFUSED_RECIPIENT, { status: 502 })),
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await deliverViaRelay(MAIL);
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain('alpha.example.net');
    expect(logged).toContain('undeliverable recipient');
  });

  it('never hands the relay a recipient whose domain takes no mail', async () => {
    configure();
    _setDomainCheckForTests(async () => false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliverViaRelay(MAIL)).outcome).toBe('undeliverable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies the SMTP prose the relay forwards', () => {
    expect(classifyRelayRefusal(502, "(550, b'5.1.1 no such user')")).toBe('undeliverable');
    expect(classifyRelayRefusal(502, 'Domain not found')).toBe('undeliverable');
    expect(classifyRelayRefusal(502, 'Connection unexpectedly closed')).toBe('refused');
    expect(classifyRelayRefusal(503, 'relay mailbox not configured')).toBe('refused');
  });
});
