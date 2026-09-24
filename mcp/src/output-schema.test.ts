/**
 * Les VRAIES réponses de l'API, rejouées à travers le client MCP officiel.
 *
 * Pourquoi ce fichier existe (risque R3, reproduit le 24/09/2026). Chaque outil
 * de ce paquet déclare un `outputSchema`, et le client officiel
 * (`@modelcontextprotocol/sdk`) valide `structuredContent` contre lui : au
 * moindre écart, `callTool` lève `MCP error -32602: Structured content does not
 * match the tool's output schema` et l'agent n'a plus rien. Or le schéma
 * déclarait non nullables des champs que l'API sert à `null` tous les jours :
 * `bic` d'un code banque non attribué, `lei` d'un BIC sans LEI, `risk_score`
 * d'un IBAN invalide… et une classification `register` que l'énumération
 * ignorait. Mesuré ce jour-là contre les vraies routes : plus de la moitié des
 * réponses refusées, précisément celles qui comptent le plus (« ce code banque
 * n'existe pas »).
 *
 * `index.test.ts` ne pouvait pas le voir : ses charges utiles sont écrites à la
 * main, et une charge utile écrite à la main a la forme que l'on croit, pas
 * celle que l'API rend. Celles-ci sont des réponses réelles, produites par le
 * code de l'API (voir `_provenance` dans `mcp/fixtures/api-answers.json`) ; le
 * faux serveur ne fait que les rendre.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../dist/index.js');

type Answer = Record<string, unknown>;
const FIXTURES = JSON.parse(readFileSync(resolve(HERE, '../fixtures/api-answers.json'), 'utf8')) as {
  es_emi_iban: string;
  answers: Record<string, Answer>;
};
const A = FIXTURES.answers;
const ES_EMI = FIXTURES.es_emi_iban;

/**
 * Cas SYNTHÉTIQUE, le seul du fichier : la réponse italienne réelle, dont la
 * ville du BIC passe de `""` à `null`. C'est le changement que la 1.8.0 prévoit
 * (« Vérité champ par champ », `bic.city` vide → null) ; le schéma doit
 * l'accepter avant que l'API ne le serve, sinon ce sera R3 une seconde fois.
 */
const IT60_CITY_NULL = 'IT60X0542811101000000123456';
const it60CityNull: Answer = {
  ...A.validate_it60,
  bic: { ...(A.validate_it60.bic as Answer), city: null },
};

/** Réponse rendue pour une requête : chemin, méthode et IBAN du corps. */
function answerFor(method: string, url: string, body: string): Answer | undefined {
  const iban = body ? (JSON.parse(body) as { iban?: string }).iban : undefined;
  if (method === 'POST' && url === '/v1/iban/validate') {
    if (iban === 'DE89370400440532013000') return A.validate_de89;
    if (iban === 'CH9300762011623852957') return A.validate_ch93;
    if (iban === ES_EMI) return A.validate_es_emi;
    if (iban === IT60_CITY_NULL) return it60CityNull;
  }
  if (method === 'POST' && url === '/v1/iban/batch') return A.batch_mix;
  if (method === 'POST' && url === '/v1/iban/compliance') {
    if (iban === 'CH9300762011623852957') return A.compliance_ch93;
    if (iban === 'not-an-iban') return A.compliance_invalid;
    if (iban === 'RU0204452560040702810412345678901') return A.compliance_ru;
  }
  if (method === 'GET' && url === '/v1/bic/UBSWCHZH') return A.bic_without_lei;
  if (method === 'GET' && url === '/v1/bic/ZZZZDEFFXXX') return A.bic_not_found;
  if (method === 'GET' && url === '/v1/ch/clearing/83037') return A.clearing_no_bic;
  if (method === 'GET' && url === '/v1/ch/clearing/80808') return A.clearing_no_building_number;
  if (method === 'GET' && url === '/v1/reference/validate?reference=RF00') return A.reference_unrecognised;
  return undefined;
}

let api: HttpServer;
let client: Client;

beforeAll(async () => {
  api = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk);
    });
    req.on('end', () => {
      const answer = answerFor(req.method ?? '', req.url ?? '', raw);
      res.setHeader('content-type', 'application/json');
      if (!answer) {
        res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.writeHead(200).end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((ok) => api.listen(0, '127.0.0.1', ok));
  const addr = api.address();
  if (typeof addr === 'string' || addr === null) throw new Error('no port');

  client = new Client({ name: 'output-schema-test', version: '1' }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      env: {
        ...process.env,
        IBANFORGE_API_BASE: `http://127.0.0.1:${addr.port}`,
        IBANFORGE_API_KEY: '',
      } as Record<string, string>,
    }),
  );
  // C'est ici que le client met en cache un validateur par outil : sans
  // listTools, callTool ne vérifie rien et le test passerait à tort.
  await client.listTools();
}, 30_000);

afterAll(async () => {
  await client?.close();
  await new Promise<void>((ok) => api?.close(() => ok()));
});

/** Appelle l'outil ; un refus du client officiel fait échouer le test avec son message. */
async function structured(name: string, args: Record<string, unknown>): Promise<Answer> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError, `${name} answered isError`).toBeFalsy();
  expect(res.structuredContent, `${name} returned no structuredContent`).toBeDefined();
  return res.structuredContent as Answer;
}

describe('the official MCP client accepts what the API really serves', () => {
  it('a resolved German IBAN (control: accepted before and after the fix)', async () => {
    const sc = await structured('validate_iban', { iban: 'DE89370400440532013000' });
    expect((sc.bic as Answer).code).toBe('COBADEFFXXX');
  });

  it('an unallocated Swiss bank code: bic null, clearing null', async () => {
    const sc = await structured('validate_iban', { iban: 'CH9300762011623852957' });
    expect(sc.valid).toBe(true);
    expect(sc.bic).toBeNull();
    expect(sc.clearing).toBeNull();
    expect((sc.bank_code_check as Answer).reason).toBe('not_allocated');
  });

  it('an e-money institution named by the EBA register: classification register, bic null', async () => {
    const sc = await structured('validate_iban', { iban: ES_EMI });
    expect(sc.bic).toBeNull();
    expect((sc.issuer as Answer).classification).toBe('register');
    expect((sc.issuer as Answer).type).toBe('emi');
  });

  it('a BIC city that 1.8.0 will serve as null (synthetic case)', async () => {
    const sc = await structured('validate_iban', { iban: IT60_CITY_NULL });
    expect((sc.bic as Answer).city).toBeNull();
  });

  it('a batch whose items carry bic null', async () => {
    const sc = await structured('batch_validate_iban', {
      ibans: ['CH9300762011623852957', 'DE89370400440532013000', ES_EMI],
    });
    const results = sc.results as Answer[];
    expect(results[0].bic).toBeNull();
    expect(results[2].bic).toBeNull();
  });

  it('a compliance check with no bank to screen: bic null', async () => {
    const sc = await structured('check_compliance', { iban: 'CH9300762011623852957' });
    expect(sc.bic).toBeNull();
    expect(((sc.compliance as Answer).sanctions as Answer).bank_screened).toBe(false);
  });

  it('a compliance check on an invalid IBAN: risk_score null, risk_level unassessable', async () => {
    const sc = await structured('check_compliance', { iban: 'not-an-iban' });
    const compliance = sc.compliance as Answer;
    expect(compliance.risk_score).toBeNull();
    expect(compliance.risk_level).toBe('unassessable');
  });

  it('a compliance check on a country the FATF suspended: fatf_status suspended', async () => {
    const sc = await structured('check_compliance', { iban: 'RU0204452560040702810412345678901' });
    expect(((sc.compliance as Answer).sanctions as Answer).fatf_status).toBe('suspended');
  });

  it('a BIC found without an LEI: lei null, address null', async () => {
    const sc = await structured('lookup_bic', { bic: 'UBSWCHZH' });
    expect(sc.found).toBe(true);
    expect(sc.lei).toBeNull();
    expect(sc.address).toBeNull();
  });

  it('a BIC that is not found: institution, city and lei null', async () => {
    const sc = await structured('lookup_bic', { bic: 'ZZZZDEFFXXX' });
    expect(sc.found).toBe(false);
    expect(sc.institution).toBeNull();
    expect(sc.city).toBeNull();
  });

  it('a Swiss IID with no BIC and no QR-IID', async () => {
    const sc = await structured('lookup_ch_clearing', { iid: '83037' });
    expect(sc.bic).toBeNull();
    expect(sc.qr_iid).toBeNull();
  });

  it('a Swiss IID whose address has no building number', async () => {
    const sc = await structured('lookup_ch_clearing', { iid: '80808' });
    expect((sc.address as Answer).building_number).toBeNull();
  });

  it('a reference no scheme recognises: scheme, valid and source null', async () => {
    const sc = await structured('validate_payment_reference', { reference: 'RF00' });
    expect(sc.status).toBe('unrecognised');
    expect(sc.scheme).toBeNull();
    expect(sc.valid).toBeNull();
    expect(sc.source).toBeNull();
  });
});
