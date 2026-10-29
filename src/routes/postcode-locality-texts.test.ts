/**
 * NPA et localité (29.10.2026) : les textes qui décrivent l'avertissement de la
 * QR-facture et de l'audit disent aussi ce qui n'en reçoit pas.
 *
 * Relecture de la PR 470 : chaque description de `check_swiss_qr_bill` et la
 * ligne de méthode du classeur d'audit annonçaient « un avertissement quand le
 * couple n'est pas répertorié ». Faux pour un NPA absent du répertoire dont la
 * localité y figure sous un autre NPA de la même zone postale (une case postale,
 * probablement, comme 2501 Biel, l'exemple de SIX) : la réponse est
 * `not_verifiable`, sans avertissement. Un lecteur qui ne voit aucun
 * avertissement doit savoir que ce silence ne vaut pas vérification.
 *
 * Ce fichier lit le texte de CHAQUE surface, isolé sur cet outil ou cette
 * route : un `not_verifiable` cherché dans tout un fichier passerait déjà grâce
 * à `check_postal_address` ou au schéma de `/v1/address/check`.
 *  - stdio (`src/mcp/server.ts`) : lu comme texte, comme
 *    `src/mcp/tool-contracts.test.ts`, parce que l'importer démarrerait le
 *    serveur ;
 *  - `/mcp` et `/mcp/directory` : la description SERVIE par `tools/list` ;
 *  - OpenAPI : `buildSpec()` ;
 *  - Postman : la requête de la QR-facture ;
 *  - classeur d'audit : la ligne qui porte ©swisstopo, en, fr et de.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildApp } from '../app.js';
import { buildSpec } from './openapi.js';
import { auditTable, buildWorkbook } from '../lib/audit-file.js';
import { closeAll } from '../lib/db.js';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

afterAll(() => closeAll());

/** Ce que doit dire chaque description de l'outil ou de la route. */
function expectNotVerifiableNamed(where: string, text: string): void {
  // Garde contre une isolation ratée : on lit bien le texte de la QR-facture.
  expect(text, `${where} : texte de la QR-facture`).toContain('postcode_town_mismatch');
  expect(text, `${where} : l'état nommé`).toContain('not_verifiable');
  expect(text, `${where} : sans avertissement`).toMatch(/not_verifiable,? without a warning/);
  expect(text, `${where} : le silence n'est pas une vérification`).toContain(
    'the absence of a warning does not mean the pair was verified',
  );
  expect(text, `${where} : la case postale, probable seulement`).toContain(
    'likely a post-office box postcode',
  );
}

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
} as const;

async function rpc(path: string, ip: string, body: unknown, sid?: string): Promise<Response> {
  return buildApp().request(path, {
    method: 'POST',
    headers: { ...HEADERS, 'x-real-ip': ip, ...(sid ? { 'mcp-session-id': sid } : {}) },
    body: JSON.stringify(body),
  });
}

async function parse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const frame = text.match(/^data:\s*(\{.*\})$/m);
  return JSON.parse(frame ? frame[1]! : text) as Record<string, unknown>;
}

/** La description de `check_swiss_qr_bill` que l'adresse sert. */
async function servedDescription(path: string, ip: string): Promise<string> {
  const init = await rpc(path, ip, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest-postcode-locality-texts', version: '1.0.0' },
    },
  });
  const sid = init.headers.get('mcp-session-id') ?? undefined;
  expect(sid, `${path} ouvre une session`).toBeTruthy();
  await init.text();
  const list = await parse(
    await rpc(path, ip, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid),
  );
  const tools = (list.result as { tools: Array<{ name: string; description: string }> }).tools;
  const tool = tools.find((t) => t.name === 'check_swiss_qr_bill');
  expect(tool, `${path} sert check_swiss_qr_bill`).toBeDefined();
  return tool!.description;
}

describe('check_swiss_qr_bill and POST /v1/ch/qr-bill/check: not_verifiable is named, without a warning', () => {
  it('stdio (src/mcp/server.ts)', () => {
    const src = read('src/mcp/server.ts');
    const at = src.indexOf("'check_swiss_qr_bill',");
    expect(at).toBeGreaterThan(-1);
    const end = src.indexOf('inputSchema', at);
    expect(end).toBeGreaterThan(at);
    expectNotVerifiableNamed('stdio', src.slice(at, end));
  });

  it('hosted /mcp, as served', async () => {
    expectNotVerifiableNamed('/mcp', await servedDescription('/mcp', '198.18.4.70'));
  });

  it('/mcp/directory, as served', async () => {
    expectNotVerifiableNamed(
      '/mcp/directory',
      await servedDescription('/mcp/directory', '198.18.4.71'),
    );
  });

  it('OpenAPI', () => {
    const op = buildSpec().paths['/v1/ch/qr-bill/check'].post;
    expectNotVerifiableNamed('openapi', op.description);
  });

  it('Postman', () => {
    const collection = JSON.parse(read('integrations/postman/ibanforge.postman_collection.json'));
    const found: string[] = [];
    const walk = (items: Array<Record<string, unknown>>): void => {
      for (const it of items) {
        if (Array.isArray(it.item)) walk(it.item as Array<Record<string, unknown>>);
        const req = it.request as { url?: unknown; description?: unknown } | undefined;
        if (!req || !JSON.stringify(req.url ?? '').includes('qr-bill')) continue;
        const d = req.description;
        found.push(typeof d === 'string' ? d : String((d as { content?: string })?.content ?? ''));
      }
    };
    walk(collection.item);
    expect(found).toHaveLength(1);
    expectNotVerifiableNamed('postman', found[0]!);
  });
});

describe('the audit workbook: its method line says that no warning is not a verification', () => {
  const PHRASES = {
    en: ['stays unverified, without a warning', 'the absence of a warning does not mean'],
    fr: [
      'reste non vérifié, sans avertissement',
      "l'absence d'avertissement ne vaut pas vérification",
    ],
    de: ['bleibt ungeprüft, ohne Warnung', 'das Fehlen einer Warnung ist keine Bestätigung'],
  } as const;

  it.each(['en', 'fr', 'de'] as const)('%s', (lang) => {
    const res = auditTable(
      ['Name', 'IBAN', 'Rue', 'NPA', 'Ville', 'Pays'],
      [['Société Alpha', 'CH1000230000000012345', 'Rue du Lac 1268', '2501', 'Biel', 'CH']],
    );
    const wb = XLSX.read(buildWorkbook(res, lang), { type: 'buffer' });
    const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[1]!]!, {
      header: 1,
    });
    const line = summary.map((r) => String(r[0] ?? '')).find((s) => s.includes('©swisstopo'));
    expect(line, lang).toBeDefined();
    for (const phrase of PHRASES[lang]) expect(line, lang).toContain(phrase);
    // L'ancienne promesse, un avertissement pour tout couple absent, a disparu.
    expect(line).not.toMatch(
      /a warning when the pair is not listed|un avertissement quand le couple n'y figure pas|eine Warnung, wenn das Paar dort nicht verzeichnet ist/,
    );
  });
});
