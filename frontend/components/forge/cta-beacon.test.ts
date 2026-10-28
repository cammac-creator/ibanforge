import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CtaBeacon } from './cta-beacon';

const effects = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({ useEffect: (effect: () => () => void) => { effects.cleanup = effect(); } }));

let listeners: Map<string, EventListener>;
let sendBeacon: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
const humanAgent = 'Mozilla/5.0 Safari/605.1.15';

function mount(userAgent: string, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('navigator', { userAgent, webdriver: false, doNotTrack: null, sendBeacon, ...extra });
  CtaBeacon({ locale: 'fr', page: '/fr/docs/mcp' });
}

function click(name = 'cta:vendor-docs') {
  const event = new Event('click', { cancelable: true });
  Object.defineProperty(event, 'target', {
    value: { closest: () => ({ getAttribute: () => name }) },
  });
  listeners.get(event.type)?.(event);
  return event;
}

function station(detail: number) {
  const event = new Event('forge:station');
  Object.defineProperty(event, 'detail', { value: detail });
  listeners.get(event.type)?.(event);
}

beforeEach(() => {
  listeners = new Map();
  const doc = {
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: (type: string, listener: EventListener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  sendBeacon = vi.fn(() => true);
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { innerWidth: 390 });
  vi.stubGlobal('location', { pathname: '/fr/docs/mcp' });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  effects.cleanup?.();
  effects.cleanup = undefined;
  vi.unstubAllGlobals();
});

describe('la balise de clic', () => {
  it.each([
    'IBANforge-outil/codex-docs-connecteurs',
    `${humanAgent} IBANforge-outil/controle`,
    'ibanforge-OUTIL/exemple',
    'HeadlessChrome/123',
    'Lighthouse/12',
  ])('reste muette pour %s, clics et film compris', (ua) => {
    mount(ua);
    click();
    station(0);
    station(3);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ webdriver: true }, { doNotTrack: '1' }])('respecte aussi %j', (flags) => {
    mount(humanAgent, flags);
    click();
    station(0);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envoie le clic humain, limite le film à une fois et retire ses écouteurs', async () => {
    mount(humanAgent);
    click();
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toMatch(/\/v1\/web\/events$/);
    expect(JSON.parse(await blob.text())).toEqual({
      name: 'cta:vendor-docs', page: '/fr/docs/mcp', locale: 'fr', referrer: '', viewport: 'phone',
    });
    station(0);
    station(0);
    station(3);
    station(3);
    expect(sendBeacon).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
    effects.cleanup?.();
    click();
    station(0);
    expect(sendBeacon).toHaveBeenCalledTimes(3);
  });

  it('utilise fetch si sendBeacon refuse un événement humain', () => {
    sendBeacon.mockReturnValue(false);
    mount(humanAgent);
    click();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/web\/events$/), expect.objectContaining({
      method: 'POST', keepalive: true,
    }));
  });

  it.each(['beacon', 'refus', 'absent'] as const)(
    'envoie avant la navigation externe, sans lire sa référence privée (%s)',
    async (transport) => {
      if (transport === 'refus') sendBeacon.mockReturnValue(false);
      mount(humanAgent, transport === 'absent' ? { sendBeacon: undefined } : {});
      expect(document.addEventListener).toHaveBeenCalledWith('click', expect.any(Function), true);
      const getAttribute = vi.fn((key: string) => key === 'data-evt' ? 'cta:buy-pro-on-key' : null);
      const closest = vi.fn(() => ({
        href: 'https://buy.stripe.com/exemple?client_reference_id=reference_fictive',
        target: '_blank', getAttribute,
      }));
      const event = new Event('click', { cancelable: true });
      // Le clic touche un enfant du lien ; la capture précède le gestionnaire et la navigation.
      Object.defineProperty(event, 'target', { value: { closest } });
      listeners.get('click')?.(event);
      expect(closest).toHaveBeenCalledWith('[data-evt]');
      expect(getAttribute.mock.calls).toEqual([['data-evt']]);
      expect(event.defaultPrevented).toBe(false);
      let body: string;
      if (transport === 'beacon') {
        expect(sendBeacon).toHaveBeenCalledOnce();
        expect(fetchMock).not.toHaveBeenCalled();
        const blob = (sendBeacon.mock.calls[0] as unknown as [string, Blob])[1];
        expect(blob.type).toBe('text/plain');
        body = await blob.text();
      } else {
        expect(fetchMock).toHaveBeenCalledOnce();
        const options = fetchMock.mock.calls[0][1];
        expect(options).toMatchObject({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' } });
        body = options.body;
      }
      expect(JSON.parse(body)).toEqual({
        name: 'cta:buy-pro-on-key', page: '/fr/docs/mcp', locale: 'fr', referrer: '', viewport: 'phone',
      });
      expect(body).not.toContain('reference_fictive');
    },
  );

  it.each([
    'cta:buy-pack-1k', 'cta:buy-pack-5k', 'cta:buy-pack-25k', 'cta:buy-pro',
    'cta:buy-audit', 'cta:oem-mail', 'cta:buy-topup-1k', 'cta:buy-topup-5k',
    'cta:buy-topup-25k', 'cta:buy-pro-on-key',
  ])('transmet un clic d’achat %s sans bloquer son action', async (name) => {
    mount(humanAgent);
    expect(click(name).defaultPrevented).toBe(false);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const blob = (sendBeacon.mock.calls[0] as unknown as [string, Blob])[1];
    expect(JSON.parse(await blob.text()).name).toBe(name);
  });
});
