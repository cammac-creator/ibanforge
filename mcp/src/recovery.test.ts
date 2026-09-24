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
        expect(instructions).not.toContain('Free tier:');
        expect(instructions).toContain('https://api.ibanforge.com/.well-known/rate-limits.yml');
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
        expect(payload(result)._hint).toContain('POST https://api.ibanforge.com/v1/keys/generate');
        expect(payload(result)._hint).toContain('.well-known/rate-limits.yml');
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

/**
 * Le device grant vu du paquet publié, et le piège que ce fichier existe pour
 * attraper.
 *
 * 🚨 `apiCall` marque TOUT `!res.ok` en `_error: true`. Or le protocole RFC 8628
 * répond `authorization_pending` en **400** et `device_rate_limited` en **429** :
 * ce sont des réponses NORMALES, pas des pannes. Sans le rattrapage qui inspecte
 * le champ `error` du CORPS, `poll_api_key` rendrait `isError: true` au premier
 * tour et l'agent abandonnerait avant que l'humain n'ait cliqué, et
 * `request_api_key` présenterait un plafond partagé comme un service en panne.
 *
 * Ces deux tests sont les seuls qui l'attrapent, et ils travaillent sur `dist/`
 * par un vrai client stdio : un test qui importerait la source ne verrait pas ce
 * que le paquet publié fait réellement.
 */
describe('device grant — un 400 ou un 429 du protocole n’est pas une panne', () => {
  const OPENED = {
    device_code: 'ifd_' + 'a'.repeat(64),
    user_code: 'WDJB-MJHT',
    verification_uri: 'https://ibanforge.com/device',
    verification_uri_complete: 'https://ibanforge.com/device?code=WDJB-MJHT',
    expires_in: 900,
    interval: 5,
    message: 'Show the user_code and the verification_uri to a human.',
    display_to_human:
      'IBANforge needs one approval from you, and it takes about fifteen seconds.\n\n' +
      '  1. Open:  https://ibanforge.com/device?code=WDJB-MJHT\n' +
      '  2. Check the code shown on the page reads:  WDJB-MJHT\n' +
      '  3. Click "Get the key". No e-mail, no card, no account.',
  };

  // ── 31 ──────────────────────────────────────────────────────────────────────
  it('31. le 400 authorization_pending de l’API ne devient pas un isError', async () => {
    await connected(
      (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/keys/device') {
          res.writeHead(201).end(JSON.stringify(OPENED));
          return;
        }
        // Le premier tour du parcours honnête : personne n'a encore approuvé.
        res.writeHead(400).end(
          JSON.stringify({
            error: 'authorization_pending',
            message: 'Nobody has approved this code yet. Wait for the interval, then call again.',
            expires_in: 880,
            interval: 5,
          }),
        );
      },
      async (client) => {
        await client.callTool({ name: 'request_api_key', arguments: {} });
        const result = await client.callTool({ name: 'poll_api_key', arguments: {} });

        expect(
          result.isError,
          'un authorization_pending est arrivé comme un échec : l’agent abandonne au premier tour',
        ).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          status: 'authorization_pending',
          api_key: null,
          retry_in_seconds: 5,
        });
      },
    );
  });

  // ── 31bis ───────────────────────────────────────────────────────────────────
  it('31bis. le 429 device_rate_limited non plus', async () => {
    await connected(
      (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.writeHead(429).end(
          JSON.stringify({
            error: 'device_rate_limited',
            message: 'This network has already taken its free keys for today.',
            display_to_human: 'This network has already taken its free keys for today.',
          }),
        );
      },
      async (client) => {
        const result = await client.callTool({ name: 'request_api_key', arguments: {} });

        expect(
          result.isError,
          'un plafond partagé est arrivé comme une panne : l’agent ne prend pas le chemin de repli',
        ).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          status: 'device_rate_limited',
          user_code: null,
        });
        // Peuplé : c'est ce bloc qui envoie l'agent vers l'essai sans clé ou x402.
        expect(String(payload(result).display_to_human).length).toBeGreaterThan(0);
      },
    );
  });

  // ── 30, versant surface A ───────────────────────────────────────────────────
  it('30. le device_code ne sort JAMAIS de la sortie structurée', async () => {
    await connected(
      (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/keys/device') res.writeHead(201).end(JSON.stringify(OPENED));
        else res.writeHead(400).end('{"error":"authorization_pending","interval":5}');
      },
      async (client) => {
        const result = await client.callTool({ name: 'request_api_key', arguments: {} });
        // 🚨 Le corps HTTP le contient — c'est la fixture ci-dessus — donc ce
        // test mesure bien un filtrage, pas une absence de donnée. Le
        // `device_code` est le porteur UNIQUE de la clé, et une sortie d'outil
        // traverse le transcript du modèle, les journaux du client MCP et les
        // copier-coller de rapport d'incident.
        expect(OPENED.device_code).toContain('ifd_');
        expect(JSON.stringify(result.structuredContent)).not.toContain('ifd_');
        expect(JSON.stringify(result.content)).not.toContain('ifd_');
      },
    );
  });

  // ── Le relais reprend le dernier code sans argument ─────────────────────────
  it('poll_api_key sans argument reprend le dernier code, et l’oublie après le retrait', async () => {
    const polled: string[] = [];
    await connected(
      (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/keys/device') {
          res.writeHead(201).end(JSON.stringify(OPENED));
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          polled.push(JSON.parse(body || '{}').device_code ?? '');
          res.writeHead(200).end(
            JSON.stringify({
              api_key: 'ifk_test_only_fixture',
              key_prefix: 'ifk_test',
              tier: 'anonymous',
              monthly_limit: 25,
              message: 'Save this key — it will not be shown again.',
              config_line:
                'claude mcp add ibanforge -e IBANFORGE_API_KEY=ifk_test_only_fixture -- npx -y ibanforge-mcp',
            }),
          );
        });
      },
      async (client) => {
        await client.callTool({ name: 'request_api_key', arguments: {} });
        const first = await client.callTool({ name: 'poll_api_key', arguments: {} });
        expect(first.structuredContent).toMatchObject({
          status: 'approved',
          api_key: 'ifk_test_only_fixture',
        });
        // Le code mémorisé a bien été envoyé à la route, sans que l'agent le
        // repasse en argument.
        expect(polled).toEqual([OPENED.device_code]);

        // Une clé est remise exactement une fois : le code est oublié, et un
        // second appel sans argument ne redemande RIEN à la route.
        const second = await client.callTool({ name: 'poll_api_key', arguments: {} });
        expect(second.structuredContent).toMatchObject({ status: 'invalid_grant', api_key: null });
        expect(polled, 'le paquet a redemandé la clé après l’avoir déjà remise').toEqual([
          OPENED.device_code,
        ]);
      },
    );
  });
});
