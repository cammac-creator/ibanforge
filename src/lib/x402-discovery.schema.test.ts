import { describe, expect, it } from 'vitest';
import { buildBazaarInfo, buildBazaarSchema, discoveryForRoute } from './x402-discovery.js';

/**
 * Audit de production du 16/09/2026, I3 : le cœur x402 exige `info` ET `schema`
 * sur une extension bazaar, et l'API ne posait que `info` — donc « malformed »
 * dans les journaux à chaque 402, sur toutes les routes payantes. Le schéma
 * doit décrire exactement l'info qu'on émet.
 */
describe('bazaar extension: the schema describes the info block', () => {
  const routes = ['POST /v1/iban/validate', 'GET /v1/bic/:code', 'POST /v1/iban/compliance'];

  it.each(routes)('%s: info matches its own schema', (route) => {
    const d = discoveryForRoute(route);
    expect(d, route).not.toBeNull();
    const info = buildBazaarInfo(d!) as {
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    };
    const schema = buildBazaarSchema(d!) as {
      properties: {
        input: {
          properties: Record<string, unknown>;
          required: string[];
          additionalProperties: boolean;
        };
      };
      required: string[];
    };
    expect(schema.required).toEqual(['input']);
    // Every key emitted in info.input is declared by the schema (additionalProperties: false).
    for (const key of Object.keys(info.input))
      expect(Object.keys(schema.properties.input.properties), key).toContain(key);
    // Every required key of the schema is present in info.input.
    for (const key of schema.properties.input.required) expect(info.input, key).toHaveProperty(key);
    expect(schema.properties.input.additionalProperties).toBe(false);
    expect(info.output).toMatchObject({ type: 'json' });
  });

  it('a body route requires bodyType and body, a query route does not', () => {
    const body = buildBazaarSchema(discoveryForRoute('POST /v1/iban/validate')!) as {
      properties: { input: { required: string[] } };
    };
    const query = buildBazaarSchema(discoveryForRoute('GET /v1/bic/:code')!) as {
      properties: { input: { required: string[] } };
    };
    expect(body.properties.input.required).toEqual(['type', 'method', 'bodyType', 'body']);
    expect(query.properties.input.required).toEqual(['type', 'method']);
  });
});
