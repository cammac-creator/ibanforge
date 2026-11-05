import { Children, isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaygroundPage from './page';
import fr from '../../../messages/fr.json';

// Exécuter les vrais événements de la page, puis lire son arbre React.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => {
      hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'fr',
  useTranslations: () => (key: string) => key.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], fr.playground),
}));
function render() { hooks.cursor = 0; return PlaygroundPage(); }
function elements(node: ReactNode): Record<string, unknown>[] {
  return Children.toArray(node).flatMap(child => isValidElement<{ children?: ReactNode }>(child)
    ? [child.props, ...elements(child.props.children)] : []);
}
function props() { return elements(render()); }
function carte() { return props().find(p => p.data && 'received' in p); }
function alerte() { return props().find(p => p.role === 'alert'); }
function onglet(mode: string) { (props().find(p => p.onValueChange)!.onValueChange as (v: string) => void)(mode); }
function saisir(value: string) { (props().find(p => p.onChange && p['aria-label'])!.onChange as (e: unknown) => void)({ target: { value } }); }
function lancer() { (props().find(p => p.onSubmit)!.onSubmit as (e: unknown) => void)({ preventDefault() {} }); }
const reponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { hooks.slots = []; hooks.cursor = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('le Playground montre uniquement le résultat du contrôle courant', () => {
  it.each(['iban', 'bic', 'compliance', 'clearing'])('retire le résultat dès la saisie en mode %s', mode => {
    onglet(mode); expect(carte()).toBeDefined();
    saisir('NOUVELLE-SAISIE'); expect(carte()).toBeUndefined();
  });

  it.each([
    ['iban', { valid: null }], ['iban', { found: true }], ['compliance', { valid: 'true' }],
    ['bic', { found: null }], ['bic', { valid: true }], ['clearing', { found: 'false' }],
    ['iban', null], ['iban', []],
  ])('refuse un verdict absent ou du mauvais mode : %s %j', async (mode, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(body)));
    onglet(mode as string); lancer();
    await vi.waitFor(() => expect(alerte()).toBeDefined());
    expect(carte()).toBeUndefined();
  });

  it.each(['iban', 'bic', 'compliance', 'clearing'])('conserve un verdict false explicite en mode %s', async mode => {
    const body = ['iban', 'compliance'].includes(mode) ? { valid: false } : { found: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(body)));
    onglet(mode); lancer();
    await vi.waitFor(() => expect(carte()?.received).toBe(true));
    expect(carte()?.data).toEqual(body); expect(alerte()).toBeUndefined();
  });

  it.each([200, 429, 503])('retire le succès précédent après un refus, HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(reponse({ valid: true }))
      .mockResolvedValueOnce(reponse({ error: 'rate_limited' }, status));
    vi.stubGlobal('fetch', fetch); lancer();
    await vi.waitFor(() => expect(carte()?.received).toBe(true));
    lancer(); expect(carte()).toBeUndefined();
    await vi.waitFor(() => expect(alerte()?.children).toBe(fr.playground.error.rateLimited));
    expect(carte()).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ne traite pas un HTTP 503 portant valid true comme un succès', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse({ valid: true }, 503)));
    lancer(); await vi.waitFor(() => expect(alerte()).toBeDefined()); expect(carte()).toBeUndefined();
  });

  it('refuse un corps HTML sans conserver la carte précédente', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<p>Indisponible</p>')));
    lancer(); await vi.waitFor(() => expect(alerte()).toBeDefined()); expect(carte()).toBeUndefined();
  });

  it('n’exécute qu’un appel même en changeant d’onglet pendant l’attente', async () => {
    let finir!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finir = resolve; }));
    vi.stubGlobal('fetch', fetch); lancer(); onglet('bic'); lancer();
    expect(fetch).toHaveBeenCalledOnce();
    expect(props().find(p => p.onChange && p['aria-label'])?.disabled).toBe(true);
    finir(reponse({ valid: true })); onglet('iban');
    await vi.waitFor(() => expect(carte()?.received).toBe(true));
  });

  it('affiche une panne sans rejouer ; un nouveau clic peut réussir', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Connexion'))
      .mockResolvedValueOnce(reponse({ valid: true }));
    vi.stubGlobal('fetch', fetch); lancer();
    await vi.waitFor(() => expect(alerte()?.children).toBe(fr.playground.error.network));
    expect(carte()).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
    lancer(); await vi.waitFor(() => expect(carte()?.received).toBe(true));
    expect(alerte()).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('borne l’attente avant ou après les en-têtes : %s', async entetesRecus => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const attente = () => new Promise((_ok, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Délai', 'AbortError')), { once: true }));
      return entetesRecus ? Promise.resolve({ ok: true, json: attente }) : attente();
    });
    vi.stubGlobal('fetch', fetch); lancer();
    await vi.advanceTimersByTimeAsync(14_999); expect(alerte()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1); expect(alerte()?.children).toContain('15 secondes');
    expect(carte()).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(props().find(p => p.type === 'submit')?.disabled).toBe(false);
  });
});
