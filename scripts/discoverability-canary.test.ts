import { describe, it, expect } from 'vitest';
import {
  validate402Envelope,
  endpointsFromManifest,
  runDiscoverabilityCanary,
} from './discoverability-canary.js';

function envelope(overrides: Record<string, unknown> = {}): string {
  const base = {
    x402Version: 2,
    resource: { url: 'https://api.ibanforge.com/v1/iban/validate' },
    accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '5000', payTo: '0x' + '1'.repeat(40) }],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(base)).toString('base64');
}

describe('validate402Envelope — juge une réponse comme un crawler de registre', () => {
  it('accepte une enveloppe v2 complète', () => {
    expect(validate402Envelope(402, envelope())).toEqual([]);
  });

  it('rejette le statut non-402 — le défaut historique (405 sur GET nu)', () => {
    expect(validate402Envelope(405, envelope())[0]).toContain('405');
    expect(validate402Envelope(400, envelope())[0]).toContain('400');
  });

  it('rejette un en-tête absent ou indécodable', () => {
    expect(validate402Envelope(402, null)[0]).toContain('absent');
    expect(validate402Envelope(402, '%%%pas-du-base64-json%%%')[0]).toContain('indécodable');
  });

  it('rejette une enveloppe v1 (pas de version 2, amount absent)', () => {
    const v1 = envelope({ x402Version: 1, accepts: [{ network: 'base', payTo: '0x' + '1'.repeat(40) }] });
    const faults = validate402Envelope(402, v1);
    expect(faults.join(' ')).toContain('x402Version=1');
    expect(faults.join(' ')).toContain('amount');
    expect(faults.join(' ')).toContain('CAIP-2');
  });

  it('rejette une resource en http:// — le piège Railway du 17/08', () => {
    const bad = envelope({ resource: { url: 'http://api.ibanforge.com/v1/iban/validate' } });
    expect(validate402Envelope(402, bad).join(' ')).toContain('non https');
  });
});

describe('endpointsFromManifest — jamais de liste en dur', () => {
  it('lit resource+method et ignore les entrées non-https', () => {
    const eps = endpointsFromManifest({
      endpoints: [
        { resource: 'https://api.ibanforge.com/v1/iban/validate', method: 'post' },
        { url: 'https://api.ibanforge.com/v1/bic/DEUTDEFF', method: 'GET' },
        { resource: 'ftp://nope' },
      ],
    });
    expect(eps).toEqual([
      { resource: 'https://api.ibanforge.com/v1/iban/validate', method: 'POST' },
      { resource: 'https://api.ibanforge.com/v1/bic/DEUTDEFF', method: 'GET' },
    ]);
  });

  it('rend une liste vide sur un manifeste inattendu', () => {
    expect(endpointsFromManifest({})).toEqual([]);
    expect(endpointsFromManifest(null)).toEqual([]);
  });
});

/** Un faux fetch piloté par table url→réponse. */
function fakeFetch(routes: Record<string, { status: number; header?: string; body?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([k]) => url.startsWith(k))?.[1];
    if (!hit) throw new Error(`fake fetch: pas de route pour ${url}`);
    return new Response(hit.body ?? '{}', {
      status: hit.status,
      headers: hit.header ? { 'payment-required': hit.header } : {},
    });
  }) as typeof fetch;
}

describe('runDiscoverabilityCanary', () => {
  const manifest = JSON.stringify({
    endpoints: [
      { resource: 'https://api.ibanforge.com/v1/iban/validate', method: 'POST' },
      { resource: 'https://api.ibanforge.com/v1/bic/DEUTDEFF', method: 'GET' },
    ],
  });
  const bazaarPage = (n: number) =>
    JSON.stringify({
      items: Array.from({ length: n }, (_, i) => ({ resource: `https://api.ibanforge.com/v1/r${i}` })),
      pagination: { total: n },
    });

  it('tout vert quand chaque sonde reçoit un 402 v2 et que le Bazaar liste 5 ressources', async () => {
    const f = fakeFetch({
      'https://api.ibanforge.com/.well-known/x402': { status: 200, body: manifest },
      'https://api.ibanforge.com/v1/': { status: 402, header: envelope() },
      'https://api.cdp.coinbase.com/': { status: 200, body: bazaarPage(5) },
    });
    const out = await runDiscoverabilityCanary(f);
    expect(out).toContain('Tout vert');
    expect(out).not.toContain('🚨');
    expect(out).toContain('✓ Bazaar CDP : 5 ressources');
  });

  it("alerte quand une sonde retombe sur l'ancien 405 ou que le Bazaar maigrit", async () => {
    const f = fakeFetch({
      'https://api.ibanforge.com/.well-known/x402': { status: 200, body: manifest },
      'https://api.ibanforge.com/v1/iban/validate': { status: 405 },
      'https://api.ibanforge.com/v1/bic/DEUTDEFF': { status: 402, header: envelope() },
      'https://api.cdp.coinbase.com/': { status: 200, body: bazaarPage(3) },
    });
    const out = await runDiscoverabilityCanary(f);
    expect(out).toContain('🚨 GET /v1/iban/validate');
    expect(out).toContain('405');
    expect(out).toContain('🚨 Bazaar CDP : 3/5');
    expect(out).toContain('micro-règlement');
    expect(out).not.toContain('Tout vert');
  });

  it('alerte si le manifeste ne publie plus rien à sonder', async () => {
    const f = fakeFetch({
      'https://api.ibanforge.com/.well-known/x402': { status: 200, body: '{"endpoints":[]}' },
    });
    expect(await runDiscoverabilityCanary(f)).toContain("rien à sonder");
  });
});
