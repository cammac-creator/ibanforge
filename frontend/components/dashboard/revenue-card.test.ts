// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RevenueCard } from './revenue-card';

vi.mock('next-intl', () => ({ useLocale: () => 'fr', useTranslations: () => (key: string) => key }));
vi.mock('@/components/dashboard/info-dot', () => ({ InfoDot: () => null }));

interface Reading {
  mode: string;
  signal: AbortSignal;
  finish: (body: unknown, status?: number) => void;
  fail: () => void;
}
const payload = (amount: number) => ({
  network: 'base', asset: 'USDC', balance_usdc: amount, read_at: '2026-11-06T12:00:00Z',
  total_received_usdc: amount + 1, received_external_usdc: null, received_internal_usdc: null,
  internal_payers_configured: false, transaction_count: 0, recent: [], chunks_total: 1,
  chunks_attempted: 1, chunks_failed: 0, chunks_skipped: 0, scan_complete: true,
  block_range: { from: 1, to: 10 },
});
let host: HTMLDivElement;
let root: Root;
let readings: Reading[];
const balance = () => host.querySelector('[data-wallet-balance]')?.textContent;
const button = () => host.querySelector('button')!;
const render = (key: string) => act(async () => { root.render(createElement(RevenueCard, { refreshKey: key })); });
const finish = (n: number, amount: number) => act(async () => { readings[n].finish(payload(amount)); });
const click = () => act(async () => { button().click(); });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); readings = [];
  // Le transport ignore volontairement abort : le composant doit aussi rejeter les réponses dépassées.
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => new Promise((resolve, reject) => {
    readings.push({ mode: new URL(url, 'http://localhost').searchParams.get('mode')!, signal: options.signal as AbortSignal,
      finish: (body, status = 200) => resolve({ ok: status === 200, json: async () => body }),
      fail: () => reject(new Error('Échec fictif')) });
  })));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('Portefeuille : lectures indépendantes et actualisation volontaire', () => {
  it('relit le solde au changement de refreshKey, sans ouvrir l’historique', async () => {
    await render('premier'); await finish(0, 7.5); expect(balance()).toContain('7,5');
    await render('premier'); expect(readings).toHaveLength(1);
    await render('suivant'); expect(readings.map(r => r.mode)).toEqual(['balance', 'balance']);
    await finish(1, 9.5); expect(balance()).toContain('9,5');
  });
  it('ignore une ancienne réponse de solde même si son annulation n’est pas honorée', async () => {
    await render('premier'); await render('suivant'); expect(readings[0].signal.aborted).toBe(true);
    await finish(1, 9.5); await finish(0, 1.5); expect(balance()).toContain('9,5');
  });
  it('garde le solde pendant la lecture lente puis après son échec', async () => {
    await render('premier'); await finish(0, 7.5); await click();
    expect(readings[0].signal.aborted).toBe(false); expect(balance()).toContain('7,5');
    expect(button().disabled).toBe(true);
    await act(async () => readings[1].fail());
    expect(balance()).toContain('7,5'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button().disabled).toBe(false);
  });
  it('actualise le solde indépendamment et conserve l’historique daté quand sa relecture échoue', async () => {
    await render('premier'); await finish(0, 7.5); await click(); await finish(1, 10);
    expect(host.textContent).toContain('11 USDC'); expect(balance()).toContain('7,5');
    await render('suivant'); expect(readings.map(r => r.mode)).toEqual(['balance', 'full', 'balance', 'full']);
    expect(host.textContent).toContain('11 USDC');
    await finish(2, 12.5); await act(async () => readings[3].finish({}, 503));
    expect(balance()).toContain('12,5'); expect(host.textContent).toContain('11 USDC');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('empêche un ancien historique de remplacer le nouveau ou le solde', async () => {
    await render('premier'); await finish(0, 7.5); await click(); await render('suivant');
    expect(readings[1].signal.aborted).toBe(true);
    await finish(2, 12.5); await finish(3, 20); await finish(1, 1);
    expect(balance()).toContain('12,5'); expect(host.textContent).toContain('21 USDC');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('un historique illisible ne retire pas le précédent et ne répare pas un solde inconnu', async () => {
    await render('premier'); await finish(0, 7.5); await click(); await finish(1, 10);
    await render('suivant'); await act(async () => { readings[2].finish({}); readings[3].finish({}); });
    expect(balance()).toContain('—'); expect(host.textContent).toContain('11 USDC');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await click(); await finish(4, 20); expect(balance()).toContain('—');
  });
  it('annule les deux lectures à la sortie et ignore leur fin tardive', async () => {
    await render('premier'); await click(); await act(async () => root.unmount());
    expect(readings.every(r => r.signal.aborted)).toBe(true);
    await finish(0, 7.5); await finish(1, 10); expect(host.textContent).toBe('');
    root = createRoot(host);
  });
  it('refuse un corps arrivé après son délai même si fetch ignore l’annulation', async () => {
    vi.useFakeTimers(); await render('premier'); await click();
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(readings[0].signal.aborted).toBe(true); expect(readings[1].signal.aborted).toBe(false);
    await finish(0, 7.5); expect(balance()).toContain('—');
    await act(async () => vi.advanceTimersByTime(45_000)); await finish(1, 10);
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain('11 USDC');
  });
});
