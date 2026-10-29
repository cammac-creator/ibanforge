import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { stateGuaranteeForHeadOffice } from '../lib/ch-state-guarantee.js';

/**
 * Le transport stdio (`src/mcp/server.ts`, `npm run mcp`), exécuté pour de vrai.
 *
 * Le module ne s'importe pas : il appelle main() au chargement et prendrait
 * l'entrée et la sortie du lanceur de tests (voir tool-contracts.test.ts). Il
 * tourne donc ici comme un client l'utilise : un processus enfant lancé par le
 * client stdio du SDK, sous le même Node que les tests (le module natif de
 * better-sqlite3 est compilé pour lui). L'enfant reçoit la base de statistiques
 * privée de ce fichier (`STATS_DB_PATH`, test/hermetic-stats.ts), jamais le
 * `data/stats.sqlite` de la copie.
 *
 * Ce que ce fichier tient (29.10.2026) : `lookup_ch_clearing` sur stdio rend le
 * bloc `state_guarantee` que REST et le transport HTTP rendent, à l'agence et au
 * QR-IID par leur siège, et rien pour une banque qui n'est pas cantonale. Le
 * client du SDK valide aussi chaque réponse contre l'`outputSchema` annoncé.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const START_TIMEOUT_MS = 60_000;

let client: Client;
let stderr = '';

beforeAll(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX_CLI, join(ROOT, 'src', 'mcp', 'server.ts')],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), STATS_DB_PATH: process.env.STATS_DB_PATH as string },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  client = new Client({ name: 'ibanforge-stdio-runtime-test', version: '0.0.0' });
  await client.connect(transport);
  // La liste des outils arme la validation des réponses contre leur outputSchema.
  await client.listTools();
}, START_TIMEOUT_MS);

afterAll(async () => {
  await client?.close();
});

async function lookupChClearing(iid: string): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: 'lookup_ch_clearing', arguments: { iid } });
  expect(result.isError ?? false, stderr).toBe(false);
  const structured = result.structuredContent as Record<string, unknown>;
  // Le texte et le contenu structuré disent la même chose.
  const [first] = result.content as Array<{ type: string; text: string }>;
  expect(JSON.parse(first.text)).toEqual(structured);
  return structured;
}

describe('stdio, exécuté : lookup_ch_clearing et la garantie de l’État', () => {
  it('annonce le bloc dans le schéma de sortie de l’outil', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'lookup_ch_clearing');
    expect(tool?.outputSchema?.properties).toHaveProperty('state_guarantee');
  });

  it('une agence de la ZKB (702) reçoit l’entrée de son siège', async () => {
    const answer = await lookupChClearing('702');
    expect(answer.found).toBe(true);
    expect(answer.state_guarantee).toEqual(stateGuaranteeForHeadOffice('00700'));
    expect(answer.state_guarantee).toMatchObject({ guaranteed: true, canton: 'ZH' });
  });

  it('le QR-IID de la BEKB (30790) reçoit l’entrée de la BEKB, sans garantie et avec sa note', async () => {
    const answer = await lookupChClearing('30790');
    expect(answer.state_guarantee).toEqual(stateGuaranteeForHeadOffice('00790'));
    expect(answer.state_guarantee).toMatchObject({ guaranteed: false, canton: 'BE' });
    expect((answer.state_guarantee as { note?: string }).note).toContain('T1-1');
  });

  it('une banque qui n’est pas cantonale (UBS, 230) n’a pas la clé', async () => {
    const answer = await lookupChClearing('230');
    expect(answer.found).toBe(true);
    expect(answer).not.toHaveProperty('state_guarantee');
  });
});
