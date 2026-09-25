import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { BANK_CODE_CHECK_SCHEMA } from './bank-code-schema.js';
import { registerCoverage } from './enrich.js';
import { IBAN_LENGTHS, getCountryName } from './countries.js';
import { BIC_BASIS_SCHEMA } from '../mcp/output-schemas.js';
import { buildSpec } from '../routes/openapi.js';
import { artifacts } from '../routes/artifacts.js';
import { mcpHttp } from '../routes/mcp-http.js';
import type { HonoEnv } from '../types.js';
import {
  authoritativeCountInWords,
  authoritativeCountries,
  authoritativeVerdictSentence,
  codesAnd,
  hasInstitutionDepth,
  nationalRegisterBicCountries,
  registerCountriesWithInstitution,
} from './register-lists.js';

/**
 * Every served text that names the countries whose register settles a
 * negative, held to the code that decides it.
 *
 * On 25/09/2026 Czechia became the eighth such country and six served texts
 * kept saying seven — the OpenAPI/x402 description of
 * `bank_code_check.authoritative` ("in all seven"), the `institution` and
 * `street` descriptions, the MCP output schema and the OpenAPI description of
 * `bic.basis`, both MCP `validate_iban` descriptions ("everywhere else treat it
 * as UNAVAILABLE") and the public roadmap. They are now built from
 * register-lists.ts; this file fails the day a country joins NATIONAL_REGISTERS
 * and one of them does not follow.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const authoritative = authoritativeCountries();
const word = (cc: string) => new RegExp(`\\b${cc}\\b`);

describe('the list itself', () => {
  it('is every country whose register is authoritative, and nothing else', () => {
    const expected = Object.keys(IBAN_LENGTHS)
      .filter((cc) => registerCoverage(cc).basis === 'authoritative')
      .sort();
    expect([...authoritative].sort()).toEqual(expected);
    expect(authoritative).toContain('CZ');
    expect(authoritative).not.toContain('FI');
  });

  it('declares how deep every register goes, before any contract can describe it', () => {
    for (const cc of registerCountriesWithInstitution()) {
      expect(hasInstitutionDepth(cc), `${cc}: add it to INSTITUTION_DEPTH`).toBe(true);
    }
  });
});

describe('bank_code_check, as OpenAPI and x402 serve it', () => {
  const props = BANK_CODE_CHECK_SCHEMA.properties;

  it('names every authoritative country, and counts them', () => {
    const text = props.authoritative.description;
    const clause = text.slice(0, text.indexOf('This is the flag'));
    for (const cc of authoritative) expect(clause, cc).toMatch(word(cc));
    expect(text).toContain(`in all ${authoritativeCountInWords()}.`);
    expect(text).not.toMatch(/in all (seven|six)\b/);
  });

  it('says how deep every register goes in `institution`', () => {
    const text = props.institution.description;
    for (const cc of authoritative) expect(text, cc).toMatch(new RegExp(`[(/]${cc}[)/]`));
    // The Czech names are served as the ČNB writes them; the contract says so.
    expect(text).toContain('for CZ means Czech diacritics');
  });

  it('lists every name-only register in `street`', () => {
    const text = props.institution.properties.street.description;
    for (const cc of ['DE', 'BE', 'SK', 'CZ']) expect(text, cc).toMatch(word(cc));
  });
});

describe('bic.basis, as the MCP output schema and OpenAPI serve it', () => {
  it('MCP: names every country whose register pairs the BIC', () => {
    const text = BIC_BASIS_SCHEMA.description ?? '';
    for (const cc of nationalRegisterBicCountries()) expect(text, cc).toMatch(word(cc));
  });

  it('OpenAPI: names every such country', () => {
    const text = JSON.stringify(buildSpec());
    const at = text.indexOf("national_register: the country's own register publishes");
    expect(at).toBeGreaterThan(-1);
    const sentence = text.slice(at, text.indexOf('curated_map:', at));
    for (const cc of nationalRegisterBicCountries()) {
      expect(sentence, cc).toContain(getCountryName(cc) ?? cc);
    }
  });
});

describe('validate_iban, as both MCP servers describe it', () => {
  it('names every authoritative country in the one sentence both servers use', () => {
    const sentence = authoritativeVerdictSentence();
    for (const cc of authoritative) expect(sentence, cc).toMatch(word(cc));
  });

  it('the stdio server builds its lists from that module', () => {
    // src/mcp/server.ts starts a stdio transport on import, so its source is
    // read rather than run: no hand-typed list may come back.
    const source = readFileSync(join(ROOT, 'src/mcp/server.ts'), 'utf8');
    expect(source).toContain('${authoritativeVerdictSentence()}');
    expect(source).toContain('${nationalRegisterBicCodes()}');
    expect(source).not.toMatch(/SK against the Národná banka Slovenska prevodník\)/);
    expect(source).not.toMatch(/today CH, LI, DE, AT, BE, BG, SK and SM/);
  });

  it('the hosted server serves every authoritative country in tools/list', async () => {
    const app = new Hono<HonoEnv>();
    app.route('/', mcpHttp);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-real-ip': '198.51.100.231',
    };
    const init = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vitest-register-lists', version: '1.0.0' },
        },
      }),
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get('mcp-session-id') ?? '';
    const list = await app.request('/mcp', {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    expect(list.status).toBe(200);
    const body = await list.text();
    const frame = body.startsWith('{') ? body : (/^data:\s*(\{.*\})$/m.exec(body)?.[1] ?? '{}');
    const tools = (JSON.parse(frame) as { result?: { tools?: Array<Record<string, unknown>> } })
      .result?.tools;
    const validate = tools?.find((t) => t.name === 'validate_iban');
    expect(validate).toBeDefined();
    const description = String(validate?.description);
    expect(description).toContain(authoritativeVerdictSentence());
    const basis = JSON.stringify(validate?.outputSchema);
    for (const cc of nationalRegisterBicCountries()) expect(basis, cc).toMatch(word(cc));
  });
});

describe('the public roadmap', () => {
  it('names the authoritative countries, and never Finland among them', async () => {
    const res = await artifacts.request('/roadmap.md');
    expect(res.status).toBe(200);
    const text = await res.text();
    const line = text
      .split('\n- ')
      .find((block) => block.startsWith('**National bank-code registers**'));
    expect(line).toBeDefined();
    const authoritativePart = line!.slice(0, line!.indexOf('answered'));
    expect(authoritativePart).toContain(codesAnd(authoritative));
    expect(authoritativePart).not.toMatch(/\bFI\b/);
  });
});
