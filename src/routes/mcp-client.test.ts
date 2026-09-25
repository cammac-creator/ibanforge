/**
 * Le client officiel valide le JSON Schema de tools/list contre la réponse.
 * Lire seulement un JSON-RPC 200 ne détecte pas un champ bancaire rejeté.
 */
import { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { mcpHttp } from './mcp-http.js';
import { EXAMPLE_IBANS } from '../lib/countries.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { HonoEnv } from '../types.js';
import { frozenSources } from '../lib/source-vintage.js';
import { getBicDB } from '../lib/db.js';

let source = 10;

async function withClient(run: (client: Client) => Promise<void>) {
  const app = new Hono<HonoEnv>();
  app.route('/', mcpHttp);
  const ip = `192.0.2.${source++}`;
  const client = new Client({ name: 'recette-contrat-local', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.example.test/mcp'), {
    // Vraie route et vraies données de référence ; aucun appel réseau externe.
    fetch: async (input, init) => {
      const request = new Request(input, init);
      request.headers.set('x-real-ip', ip);
      return app.request(request);
    },
  });
  try {
    await client.connect(transport);
    await client.listTools();
    await run(client);
  } finally {
    await client.close();
  }
}

const scenarios = [
  ['validation allemande', 'validate_iban', { iban: 'DE89370400440532013000' }],
  ['validation suisse', 'validate_iban', { iban: 'CH1000230000000012345' }],
  ['validation française', 'validate_iban', { iban: 'FR1420041010050500013M02606' }],
  ['validation britannique', 'validate_iban', { iban: 'GB29NWBK60161331926819' }],
  ['code suisse absent', 'validate_iban', { iban: 'CH9300762011623852957' }],
  ['entrée invalide', 'validate_iban', { iban: 'not-an-iban' }],
  [
    'lot multi-pays',
    'batch_validate_iban',
    { ibans: ['DE89370400440532013000', 'CH1000230000000012345', 'GB29NWBK60161331926819'] },
  ],
  ['BIC et adresse', 'lookup_bic', { bic: 'COBADEFFXXX' }],
  ['BIC introuvable', 'lookup_bic', { bic: 'ZZZZITMM' }],
  ['code allemand non attribué', 'validate_iban', { iban: 'DE23999999990000000000' }],
  ['carte composite néerlandaise', 'validate_iban', { iban: 'NL19BICK0123456789' }],
  ['hors SEPA', 'validate_iban', { iban: 'AE070331234567890123456' }],
  ['conformité sans banque', 'check_compliance', { iban: 'DE23999999990000000000' }],
  ['conformité carte composite', 'check_compliance', { iban: 'NL19BICK0123456789' }],
  ['clearing suisse', 'lookup_ch_clearing', { iid: '230' }],
  ['conformité allemande', 'check_compliance', { iban: 'DE89370400440532013000' }],
  ['conformité sans IBAN valide', 'check_compliance', { iban: 'not-an-iban' }],
  ['référence RF', 'validate_payment_reference', { reference: 'RF18539007547034' }],
  [
    'adresse structurée',
    'check_postal_address',
    { scheme: 'sps', address: { twn_nm: 'Lausanne', ctry: 'CH' } },
  ],
] as const;

describe('le contrat annoncé est accepté par un client MCP conforme', () => {
  for (const [country, iban] of Object.entries(EXAMPLE_IBANS)) {
    it(`exemple de découverte ${country}`, async () => {
      await withClient(async (client) => {
        const result = await client.callTool({ name: 'validate_iban', arguments: { iban } });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        expect(result.structuredContent).toBeDefined();
      });
    });
  }

  it('continue de refuser un verdict de type incorrect', async () => {
    await withClient(async (client) => {
      const list = await client.listTools();
      const schema = list.tools.find((tool) => tool.name === 'validate_iban')!.outputSchema!;
      const result = await client.callTool({
        name: 'validate_iban',
        arguments: { iban: 'DE89370400440532013000' },
      });
      const validate = new AjvJsonSchemaValidator().getValidator(schema);
      expect(
        validate({ ...(result.structuredContent as Record<string, unknown>), valid: 'true' }).valid,
      ).toBe(false);
    });
  });

  for (const [label, name, args] of scenarios) {
    it(label, async () => {
      await withClient(async (client) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        expect(result.structuredContent).toBeDefined();
      });
    });
  }

  it('lookup_bic rend la source de la ligne, son millésime et la trace du BIC8', async () => {
    // Choisi par requête : un BIC dont la ligne vient d'une source figée.
    const frozen = frozenSources()[0]!;
    const pick = getBicDB()
      .prepare(
        `SELECT bic8 FROM bic_entries WHERE source = ? AND bic11 = bic8 || 'XXX'
         AND institution IS NOT NULL AND institution != '' LIMIT 1`,
      )
      .get(frozen.source) as { bic8: string };
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'lookup_bic', arguments: { bic: pick.bic8 } });
      const data = result.structuredContent as Record<string, unknown>;
      expect(data.source).toBe(frozen.source);
      expect(data.source_as_of).toBe(frozen.as_of);
      expect(typeof data.source_name).toBe('string');
      expect(data).toHaveProperty('listed_in_current_source');
    });
  });

  it('conserve la provenance du BIC et le titulaire nommé par le registre', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'validate_iban',
        arguments: { iban: 'DE89370400440532013000' },
      });
      const data = result.structuredContent as Record<string, unknown>;
      expect(data.bic).toMatchObject({
        code: 'COBADEFFXXX',
        basis: 'national_register',
        source: expect.any(String),
      });
      expect(data.bank_code_check).toMatchObject({ institution: { name: expect.any(String) } });
    });
  });
});
