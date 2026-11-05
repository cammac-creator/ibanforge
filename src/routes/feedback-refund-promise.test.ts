import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * La boîte à retours ne promet aucun remboursement.
 *
 * Les conditions (§3) disent les appels consommés non remboursables, alors que
 * l'outil `send_feedback`, la route `POST /v1/feedback`, l'OpenAPI et les
 * fiches recopiées promettaient de rembourser une erreur de donnée on-chain.
 * Décision de Claude-Alain du 05.11.2026 : la promesse est retirée, les
 * conditions restent. Ce test tient toutes les surfaces où elle était écrite,
 * parce qu'une seule copie oubliée suffit à la faire revivre.
 */

const ROOT = join(import.meta.dirname, '..', '..');

const SURFACES = [
  'README.md',
  'mcp/README.md',
  'mcp/src/index.ts',
  'src/app.ts',
  'src/mcp/inventory.ts',
  'src/mcp/server.ts',
  'src/routes/feedback.ts',
  'src/routes/mcp-http.ts',
  'src/routes/openapi.ts',
  'integrations/postman/ibanforge.postman_collection.json',
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'frontend/public/.well-known/mcp.json',
  'frontend/messages/en.json',
  'frontend/messages/fr.json',
  'frontend/messages/de.json',
  'frontend/content/en/docs/mcp.mdx',
  'frontend/content/fr/docs/mcp.mdx',
  'frontend/content/de/docs/mcp.mdx',
];

const PROMISE = [
  /refunded on-chain/i,
  /claim(?:ing)? (?:an? |the )?(?:x402 )?refunds?/i,
  /refund claim/i,
  /x402 refund/i,
  /a refund is owed/i,
  /remboursée? on-chain/i,
  /remboursement x402/i,
  /on-chain erstattet/i,
  /x402-Erstattung/i,
];

it.each(SURFACES)('%s ne promet aucun remboursement pour un retour', (file) => {
  const source = readFileSync(join(ROOT, file), 'utf8');
  for (const pattern of PROMISE) {
    expect(source).not.toMatch(pattern);
  }
});
