import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstCallPanel } from './first-call-panel';
import fr from '../messages/fr.json';

// Même hôte léger que le panneau d’audit : appeler les vrais gestionnaires,
// puis relire le rendu. Le parcours complet est aussi éprouvé dans Chrome.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values: Record<string, unknown> = {}) => {
    const messages = fr.apiKeyDialog.firstCall as Record<string, string>;
    return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
  },
}));

const CLE = 'ifk_' + '1'.repeat(64);
function render() {
  hooks.cursor = 0;
  return FirstCallPanel({ apiBase: 'https://api.example.test', apiKey: CLE, monthlyLimit: 25 });
}
function elements(node: ReactNode): Record<string, unknown>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [child.props, ...elements(child.props.children)];
  });
}
function texte(node: ReactNode): string {
  return Children.toArray(node).map((child) => (
    isValidElement<{ children?: ReactNode }>(child) ? texte(child.props.children) : String(child)
  )).join(' ');
}
function lancer(label = fr.apiKeyDialog.firstCall.run) {
  const bouton = elements(render()).find((p) => p.onClick && p.children === label);
  expect(bouton, label).toBeDefined();
  return (bouton!.onClick as () => Promise<void>)();
}

beforeEach(() => { hooks.slots = []; hooks.cursor = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('le premier appel ne fabrique pas de résultat', () => {
  it.each([null, {}, [], { valid: 'true' }, { error: 'indisponible' }])(
    'refuse une réponse 200 sans verdict booléen : %j', async (body) => {
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
      vi.stubGlobal('fetch', fetch);
      await lancer();
      const rendu = render();
      expect(elements(rendu).some((p) => p.role === 'alert')).toBe(true);
      expect(texte(rendu)).not.toContain(fr.apiKeyDialog.firstCall.valid);
      expect(texte(rendu)).not.toContain(fr.apiKeyDialog.firstCall.invalid);
      expect(texte(rendu)).not.toContain(fr.apiKeyDialog.firstCall.showJson);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it('refuse aussi un corps illisible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Indisponible</html>')));
    await lancer();
    expect(elements(render()).some((p) => p.role === 'alert')).toBe(true);
    expect(texte(render())).not.toContain(fr.apiKeyDialog.firstCall.valid);
  });

  it.each([true, false])('garde le verdict explicite %s et le quota réellement reçu', async (valid) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ valid, bic: null }), {
      headers: { 'x-quota-used': '2', 'x-quota-limit': '25' },
    }));
    vi.stubGlobal('fetch', fetch);
    render();
    expect(fetch).not.toHaveBeenCalled();
    await lancer();
    const rendu = render();
    expect(texte(rendu)).toContain(valid ? fr.apiKeyDialog.firstCall.valid : fr.apiKeyDialog.firstCall.invalid);
    expect(texte(rendu)).toContain('2 appel(s) sur 25');
    expect(elements(rendu).some((p) => p.role === 'alert')).toBe(false);
    const point = elements(rendu).find((p) => p.children === '●');
    expect(point?.style).toEqual({ color: valid ? 'var(--ok)' : 'var(--warn)' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.example.test/v1/iban/validate');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${CLE}`, 'X-IBANforge-Context': 'demo' });
    expect(JSON.parse(init.body)).toEqual({ iban: 'CH1000230000000012345' });
  });

  it.each([401, 402, 429, 503])('affiche le refus HTTP %s sans le rejouer', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Refus simulé' }), { status }));
    vi.stubGlobal('fetch', fetch);
    await lancer();
    expect(texte(render())).toContain('Refus simulé');
    expect(texte(render())).not.toContain(fr.apiKeyDialog.firstCall.valid);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('ne rejoue pas une panne réseau ; seul un nouveau clic relance', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true })));
    vi.stubGlobal('fetch', fetch);
    await lancer();
    expect(fetch).toHaveBeenCalledOnce();
    expect(elements(render()).some((p) => p.role === 'alert')).toBe(true);
    await lancer(fr.apiKeyDialog.firstCall.again);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(texte(render())).toContain(fr.apiKeyDialog.firstCall.valid);
  });

  it('interrompt l’attente à quinze secondes sans second appel', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_ok, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Délai', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const fin = lancer();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(texte(render())).toContain(fr.apiKeyDialog.firstCall.running);
    await vi.advanceTimersByTimeAsync(1);
    await fin;
    expect(elements(render()).some((p) => p.role === 'alert')).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('borne aussi la lecture du corps après réception des en-têtes', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () => new Promise((_ok, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Corps interrompu', 'AbortError')), { once: true });
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const fin = lancer();
    await vi.advanceTimersByTimeAsync(15_000);
    await fin;
    expect(texte(render())).toContain(fr.apiKeyDialog.firstCall.timeout);
    expect(texte(render())).not.toContain(fr.apiKeyDialog.firstCall.invalidResponse);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
