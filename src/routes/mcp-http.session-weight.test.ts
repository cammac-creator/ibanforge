/**
 * Ce que pèse une session MCP (SEC-04#1, audit du 10.11.2026) : la garde citée
 * dans src/lib/mcp-limits.ts. Elle n'affirme qu'un plafond, et ne remplace pas
 * la mesure qui y est écrite.
 *
 * Le plafond du magasin (300 par défaut) avait été jugé dangereux sur le poids
 * mesuré en septembre, 2,77 Mo par session. Ce fichier refait la mesure par la
 * même méthode (ramasse-miettes forcé deux fois) sur soixante vraies sessions
 * sans clé, ouvertes par le vrai gestionnaire POST /mcp, et vérifie qu'une
 * session ne pèse pas plus que le chiffre de septembre. En novembre elle en
 * pesait environ quatorze fois moins ; si une version du SDK la fait grossir
 * au-delà, ce test le dit avant la production.
 *
 * Limite assumée : le ramasse-miettes n'est forcé que si le moteur le permet
 * (`--expose-gc` posé à l'exécution). Sans lui, le tas mesuré compte aussi des
 * déchets : la mesure est alors plus haute que la vérité, jamais plus basse, et
 * le test peut échouer à tort, jamais passer à tort.
 *
 * Fichier à part : soixante McpServer restent dans le magasin du module le
 * temps du test, et rien de ce fichier ne doit les partager avec un autre.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Hono } from 'hono';
import { mcpHttp, mcpSessions } from './mcp-http.js';
import { MCP_SESSIONS_PER_IP_DAY } from '../lib/mcp-limits.js';
import type { HonoEnv } from '../types.js';

/** Le poids mesuré le 01.09.2026 (audit SEC-01 / MCP-08), en Mio, arrondi au-dessus. */
const SEPTEMBER_SESSION_HEAP_BYTES = Math.ceil(2.77 * 1024 * 1024);
const SESSIONS = 60;

/** Force deux passages du ramasse-miettes si le moteur le permet. */
function collect(): boolean {
  try {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as (() => void) | undefined;
    if (typeof gc !== 'function') return false;
    gc();
    gc();
    return true;
  } catch {
    return false;
  }
}

const app = new Hono<HonoEnv>();
app.route('/', mcpHttp);

async function initialize(ip: string): Promise<void> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-real-ip': ip,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest-poids', version: '1.0.0' },
      },
    }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('mcp-session-id')).toBeTruthy();
  await res.text();
}

afterAll(() => {
  // Ferme les transports : rien ne reste au fichier suivant.
  mcpSessions.sweep(Date.now() + 24 * 60 * 60 * 1000);
});

describe('SEC-04#1 : le poids d’une session MCP', () => {
  it(`${SESSIONS} sessions sans clé ne pèsent pas plus que ${SESSIONS} fois le poids de septembre`, async () => {
    // Une première session hors mesure : ce qu'un module charge une fois
    // (schémas, SDK) n'est pas le poids d'une session.
    await initialize('192.0.2.250');

    const forced = collect();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < SESSIONS; i++) {
      // Le plafond quotidien par adresse (30) impose plusieurs sources.
      await initialize(`192.0.2.${Math.floor(i / MCP_SESSIONS_PER_IP_DAY) + 1}`);
    }
    collect();
    const grown = process.memoryUsage().heapUsed - before;

    expect(mcpSessions.keylessCount()).toBeGreaterThanOrEqual(SESSIONS);
    expect(
      grown / SESSIONS,
      `tas gagné ${(grown / 1024 / 1024).toFixed(1)} Mio pour ${SESSIONS} sessions` +
        ` (ramasse-miettes forcé : ${forced ? 'oui' : 'non'})`,
    ).toBeLessThanOrEqual(SEPTEMBER_SESSION_HEAP_BYTES);
  }, 60_000);
});
