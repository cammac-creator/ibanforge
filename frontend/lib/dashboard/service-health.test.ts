import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeServiceHealth, readServiceHealth, recordedActivityAge } from './service-health';

const healthy = { status: 'ok', version: '1.2.3', uptime_seconds: 600, bic_database_entries: 123 };
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('Sonde de santé : une réponse valide, pas simplement HTTP 200', () => {
  it('accepte la réponse minimale et le contrat complet', () => {
    expect(readServiceHealth(healthy)?.bic_database_entries).toBe(123);
    expect(
      readServiceHealth({ ...healthy, databases: { bic: 'ok', stats: 'ok', compliance: 'ok' } })
        ?.version,
    ).toBe('1.2.3');
  });
  it.each([
    null,
    {},
    'ok',
    { ...healthy, status: 'error' },
    { ...healthy, version: '' },
    { ...healthy, uptime_seconds: -1 },
    { ...healthy, uptime_seconds: Infinity },
    { ...healthy, bic_database_entries: '123' },
    { ...healthy, bic_database_entries: 0.5 },
    { ...healthy, databases: { bic: 'ok', stats: 'error', compliance: 'ok' } },
  ])('refuse les réponses incohérentes : %j', (payload) => {
    expect(readServiceHealth(payload)).toBeNull();
  });
  it('mesure uniquement une réponse valide', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(healthy)));
    const result = await probeServiceHealth('https://example.net/health', signal());
    expect(result.kind).toBe('reachable');
    expect(result.health?.version).toBe('1.2.3');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
  it.each([
    [200, { status: 'error' }, 'reported-error'],
    [503, healthy, 'reported-error'],
    [200, { status: 'ok' }, 'unverified'],
  ])(
    'distingue un échec déclaré d’une lecture inconnue (%s, %j)',
    async (status, payload, kind) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload, { status })));
      expect(await probeServiceHealth('https://example.net/health', signal())).toEqual({
        kind,
        health: null,
        elapsedMs: null,
      });
    },
  );
  it('ne conserve ni vitesse verte ni ancienne version après une coupure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(healthy))
      .mockRejectedValueOnce(new TypeError('Network error'));
    vi.stubGlobal('fetch', fetcher);
    expect((await probeServiceHealth('https://example.net/health', signal())).kind).toBe(
      'reachable',
    );
    expect(await probeServiceHealth('https://example.net/health', signal())).toEqual({
      kind: 'unverified',
      health: null,
      elapsedMs: null,
    });
  });
  it('transmet le signal d’annulation et refuse le HTML même servi en 200', async () => {
    const abort = signal();
    const fetcher = vi.fn().mockResolvedValue(new Response('<html>proxy</html>'));
    vi.stubGlobal('fetch', fetcher);
    expect((await probeServiceHealth('https://example.net/health', abort)).kind).toBe('unverified');
    expect(fetcher).toHaveBeenCalledWith('https://example.net/health', {
      signal: abort,
      cache: 'no-store',
    });
  });
});

describe('Activité connue à l’ouverture : l’absence de donnée n’est pas zéro minute', () => {
  const readAt = Date.parse('2026-11-06T12:00:00Z');
  it.each([
    undefined,
    null,
    '',
    'invalide',
    '2026-11-06',
    '2026-11-07 00:00:00',
    '2026-02-30 12:00:00',
  ])('laisse inconnue une date absente ou future : %s', (last) => {
    expect(recordedActivityAge(last, readAt)).toBeNull();
  });
  it.each(['2026-11-06 11:00:00', '2026-11-06T11:00:00Z', '2026-11-06T12:00:00+01:00'])(
    'respecte UTC et le décalage explicite : %s',
    (last) => {
      expect(recordedActivityAge(last, readAt)).toBe(60);
    },
  );
  it('reste neutre avant de connaître le repère de lecture', () => {
    expect(recordedActivityAge('2026-11-06 11:00:00', null)).toBeNull();
  });
});
