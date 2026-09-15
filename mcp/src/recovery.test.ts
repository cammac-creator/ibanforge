/** Recettes du paquet construit, via un vrai client MCP et un serveur REST local. */
import { createServer, type RequestListener } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { requestTimeout } from './api-client.js';

const IBAN = 'DE89370400440532013000';
const DIST = fileURLToPath(new URL('../dist/index.js', import.meta.url));

async function connected(
  handler: RequestListener,
  run: (client: Client) => Promise<void>,
  env: Record<string, string> = {},
) {
  const api = createServer(handler);
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address() as { port: number };
  const client = new Client({ name: 'recette-locale', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST],
    env: {
      IBANFORGE_API_BASE: `http://127.0.0.1:${address.port}/`,
      IBANFORGE_API_KEY: '',
      IBANFORGE_TIMEOUT_MS: '500',
      ...env,
    },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}

function payload(result: { content: unknown }) {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe('un agent peut comprendre et reprendre un appel refusé', () => {
  it('annonce l’accès REST réellement utilisé dès la connexion', async () => {
    await connected(
      (_req, res) => res.end('{}'),
      async (client) => {
        const instructions = client.getInstructions()!;
        expect(instructions).toContain('This installed MCP server calls the REST API');
        expect(instructions).not.toContain('10 tool calls/IP/day here');
        expect(instructions).toContain('does not sign x402');
        expect(instructions).toContain('no body at all');
      },
    );
  });
  it('conserve la cause et ne contourne pas une clé épuisée par le format gratuit', async () => {
    const paths: string[] = [];
    await connected(
      (req, res) => {
        paths.push(req.url!);
        expect(req.headers.authorization).toBe('Bearer ifk_test_key');
        res.writeHead(402, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            error: 'payment_required',
            cause: { reason: 'quota_exhausted', detail: 'This key has no requests remaining.' },
          }),
        );
      },
      async (client) => {
        const result = await client.callTool({ name: 'validate_iban', arguments: { iban: IBAN } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(payload(result)).toMatchObject({
          status: 402,
          _hint: 'This key has no requests remaining.',
        });
      },
      { IBANFORGE_API_KEY: 'ifk_test_key' },
    );
    expect(paths).toEqual(['/v1/iban/validate']);
  });

  it('signale le repli anonyme en données lisibles par une machine', async () => {
    await connected(
      (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/iban/validate') res.writeHead(402).end('{"error":"payment_required"}');
        else res.end(JSON.stringify({ iban: IBAN, valid: true }));
      },
      async (client) => {
        const result = await client.callTool({ name: 'validate_iban', arguments: { iban: IBAN } });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          _degraded: true,
          _scope: 'format_only',
          _upstream_error: { status: 402 },
          valid: true,
        });
        expect(payload(result)._note).toContain('basic format validation only');
      },
    );
  });

  it('ne transforme pas un lot refusé en cent appels gratuits', async () => {
    let calls = 0;
    await connected(
      (_req, res) => {
        calls++;
        res
          .writeHead(402, { 'content-type': 'application/json' })
          .end('{"error":"payment_required"}');
      },
      async (client) => {
        const result = await client.callTool({
          name: 'batch_validate_iban',
          arguments: { ibans: Array(100).fill(IBAN) },
        });
        expect(result.isError).toBe(true);
        expect(payload(result)._hint).toContain('25 REST calls/month');
        expect(payload(result)._hint).toContain('does not sign x402');
      },
    );
    expect(calls).toBe(1);
  });

  it('refuse un lot mixte avant le réseau', async () => {
    let calls = 0;
    await connected(
      (_req, res) => {
        calls++;
        res.end('{}');
      },
      async (client) => {
        const result = await client.callTool({
          name: 'batch_validate_iban',
          arguments: { ibans: [IBAN, 42] },
        });
        expect(result.isError).toBe(true);
        expect(payload(result).error).toBe('invalid_input');
      },
    );
    expect(calls).toBe(0);
  });

  it('transmet Retry-After sans annoncer une limite inventée ni rejouer le POST', async () => {
    let calls = 0;
    await connected(
      (_req, res) => {
        calls++;
        res
          .writeHead(429, { 'retry-after': '37', 'content-type': 'application/json' })
          .end('{"error":"rate_limited","_error":false,"status":200}');
      },
      async (client) => {
        const result = await client.callTool({ name: 'validate_iban', arguments: { iban: IBAN } });
        expect(result.isError).toBe(true);
        expect(payload(result)).toMatchObject({ _error: true, status: 429, retry_after: 37 });
        expect(payload(result)._hint).not.toContain('100 req/min');
      },
    );
    expect(calls).toBe(1);
  });

  for (const body of ['<html>Service unavailable</html>', 'null', '[]', '']) {
    it(`une réponse 200 impropre reste une erreur : ${body || 'vide'}`, async () => {
      await connected(
        (_req, res) => {
          res.writeHead(200).end(body);
        },
        async (client) => {
          const result = await client.callTool({
            name: 'lookup_bic',
            arguments: { bic: 'COBADEFFXXX' },
          });
          expect(result.isError).toBe(true);
          expect(payload(result)).toMatchObject({ status: 200, error: 'invalid_response' });
        },
      );
    });
  }

  for (const bodyStarted of [false, true]) {
    it(`borne l'attente ${bodyStarted ? 'du corps incomplet' : 'des en-têtes'} sans repli`, async () => {
      let calls = 0;
      await connected(
        (_req, res) => {
          calls++;
          if (bodyStarted) res.writeHead(200, { 'content-type': 'application/json' }).write('{');
        },
        async (client) => {
          const result = await client.callTool({
            name: 'validate_iban',
            arguments: { iban: IBAN },
          });
          expect(result.isError).toBe(true);
          expect(payload(result)).toMatchObject({ status: 0, error: 'request_timeout' });
        },
        { IBANFORGE_TIMEOUT_MS: '100' },
      );
      expect(calls).toBe(1);
    });
  }

  it('ne rejoue pas une création d’audit après une rupture réseau', async () => {
    let calls = 0;
    await connected(
      (req) => {
        calls++;
        req.socket.destroy();
      },
      async (client) => {
        const result = await client.callTool({
          name: 'audit_creditor_file',
          arguments: {
            filename: 'creditors.csv',
            file_base64: Buffer.from('iban\n' + IBAN).toString('base64'),
          },
        });
        expect(result.isError).toBe(true);
        expect(payload(result).error).toBe('transport_error');
      },
    );
    expect(calls).toBe(1);
  });

  it('ignore un délai absent ou incohérent', () => {
    for (const value of [undefined, '', 'Infinity', '-1', '0', 'invalid', '120001']) {
      expect(requestTimeout(value)).toBe(30_000);
    }
    expect(requestTimeout('4500')).toBe(4500);
  });
});
