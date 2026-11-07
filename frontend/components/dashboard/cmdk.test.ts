// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandPalette } from './cmdk';

vi.mock('next-intl', () => ({ useLocale: () => 'fr', useTranslations: () => (key: string) => key }));
interface Reading { signal: AbortSignal; finish: (body: unknown) => void }
let host: HTMLDivElement, root: Root, readings: Reading[];
let bodyPending = false;
const payload = (name: string) => ({ rows: [{ email: `contact@${name}.example.net`, label: name, kind: 'client' }], partial: false });
const open = () => act(async () => { window.dispatchEvent(new Event('ibf-open-cmdk')); });
const finish = (n: number, body: unknown) => act(async () => { readings[n].finish(body); });
const close = () => act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="closeSearch"]')!.click(); });
beforeEach(async () => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom ne fournit pas encore ces méthodes ; le vrai dialogue est vérifié dans les navigateurs.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); readings = []; bodyPending = false;
  // Le transport ignore abort : une ancienne réponse doit aussi être rejetée par le composant.
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise(resolve => {
    if (bodyPending) {
      resolve({ ok: true, json: () => new Promise(finish => { readings.push({ signal: options.signal as AbortSignal, finish }); }) });
    } else readings.push({ signal: options.signal as AbortSignal, finish: body => resolve({ ok: true, json: async () => body }) });
  })));
  await act(async () => { root.render(createElement(CommandPalette)); });
});
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
describe('Recherche : délai, reprise et ancienne réponse', () => {
  it.each(['en-têtes', 'corps'])('cesse d’attendre les %s après quinze secondes, puis permet une nouvelle lecture', async phase => {
    bodyPending = phase === 'corps';
    await open(); expect(readings).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('searchUnavailable');
    expect(readings[0].signal.aborted).toBe(true);
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); });
    expect(readings).toHaveLength(2);
    await finish(1, payload('beta')); await finish(0, payload('ancienne'));
    expect(host.textContent).toContain('beta'); expect(host.textContent).not.toContain('ancienne');
    expect(host.querySelector('[role="alert"]')).toBeNull(); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(vi.getTimerCount()).toBe(0);
  });
  it('fermer annule la lecture ; rouvrir ne reçoit pas l’ancienne réponse', async () => {
    await open(); await close(); expect(readings[0].signal.aborted).toBe(true);
    await open(); await finish(0, payload('ancienne')); expect(host.textContent).not.toContain('ancienne');
    await finish(1, payload('beta')); expect(host.textContent).toContain('beta'); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(vi.getTimerCount()).toBe(0);
  });
});
