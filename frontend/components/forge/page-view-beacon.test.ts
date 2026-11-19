import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageViewBeacon } from './page-view-beacon';

vi.mock('react', () => ({ useEffect: (effect: () => void) => { effect(); } }));

let sendBeacon: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
const humanAgent = 'Mozilla/5.0 Safari/605.1.15';

function mount(userAgent: string, extra: Record<string, unknown> = {}, page = '/fr/blz/37040044') {
  vi.stubGlobal('navigator', { userAgent, webdriver: false, doNotTrack: null, sendBeacon, ...extra });
  PageViewBeacon({ locale: 'fr', page });
}

beforeEach(() => {
  sendBeacon = vi.fn(() => true);
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('la balise de visite', () => {
  it('envoie le chemin et la langue, rien d autre', async () => {
    mount(humanAgent);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    // the site's own origin: a relative address, never the API
    expect(url).toBe('/api/pv');
    expect(JSON.parse(await blob.text())).toEqual({ page: '/fr/blz/37040044', locale: 'fr' });
  });

  it('coupe une chaîne de requête et un fragment avant l envoi', async () => {
    mount(humanAgent, {}, '/fr/pricing?ref=abc#x');
    const blob = (sendBeacon.mock.calls[0] as unknown as [string, Blob])[1];
    expect(JSON.parse(await blob.text()).page).toBe('/fr/pricing');
  });

  it.each([
    [{ doNotTrack: '1' }],
    [{ globalPrivacyControl: true }],
    [{ webdriver: true }],
  ])('reste muette pour %j', (flags) => {
    mount(humanAgent, flags);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['HeadlessChrome/123', 'Lighthouse/12', 'IBANforge-outil/controle'])('reste muette pour %s', (ua) => {
    mount(ua);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('utilise fetch si sendBeacon refuse', () => {
    sendBeacon.mockReturnValue(false);
    mount(humanAgent);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
