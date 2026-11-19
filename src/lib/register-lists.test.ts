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
  partialRegisterBicNames,
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
    // Six of these countries pair the BIC from a partial list of their central
    // bank, three from a list published by a private company (e-nettet A/S):
    // neither is "the country register", and a partial list does not make a BIC
    // settlement-grade (review of 19/11/2026).
    expect(text).toContain('a register or a list published in the country prints this BIC');
    expect(text).not.toMatch(/the country register publishes|settlement-grade/);
  });

  it('OpenAPI: names every such country', () => {
    const text = JSON.stringify(buildSpec());
    expect(text).not.toContain("national_register: the country's own register publishes");
    const at = text.indexOf(
      'national_register: a register or a list published in the country prints this BIC',
    );
    expect(at).toBeGreaterThan(-1);
    const sentence = text.slice(at, text.indexOf('curated_map:', at));
    for (const cc of nationalRegisterBicCountries()) {
      expect(sentence, cc).toContain(getCountryName(cc) ?? cc);
    }
  });

  // bic.authoritative said "San Marino is where they part" while eight other
  // lists part the same way (review of 19/11/2026).
  it('OpenAPI: says where bic.authoritative and bank_code_check.authoritative part', () => {
    const text = JSON.stringify(buildSpec());
    expect(text).not.toContain('San Marino is where they part');
    expect(text).toContain(`They part in ${partialRegisterBicNames()}`);
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
    // Où les deux drapeaux se séparent : la liste lue dans le code, plus trois pays
    // tapés à la main (18.11.2026 : six listes partielles les avaient rejoints).
    expect(source).toContain('${partialRegisterBicNames()}');
    expect(source).not.toMatch(/San Marino, Montenegro and Serbia are where/);
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

/**
 * La page de documentation de `validate` (/docs/iban-validate, trois langues) est écrite
 * à la main : sa liste des pays `national_register` s'était arrêtée à la Serbie, et
 * disait Saint-Marin, le Monténégro et la Serbie « seuls » à séparer les deux drapeaux,
 * quand Israël, la Mongolie, la Russie, puis le Danemark, les îles Féroé et le Groenland
 * les avaient rejoints (relecture de la PR 639, 18.11.2026). Le test lit la page, au
 * moment de l'exécution : le site n'importe rien d'ici.
 */
describe('bic.basis, as the documentation page describes it', () => {
  it('the list of the countries where the two flags part is built from the code', () => {
    const names = partialRegisterBicNames();
    for (const cc of ['SM', 'ME', 'RS', 'IL', 'MN', 'RU', 'DK', 'FO', 'GL'])
      expect(names, cc).toContain(getCountryName(cc) ?? cc);
  });

  it.each(['en', 'fr', 'de'])(
    '%s: the basis row names every country whose register or list pairs the BIC',
    (locale) => {
      const page = readFileSync(
        join(ROOT, 'frontend', 'content', locale, 'docs', 'iban-validate.mdx'),
        'utf8',
      );
      const row = page.split('\n').find((line) => line.startsWith('| `basis` |'));
      expect(row).toBeDefined();
      for (const cc of nationalRegisterBicCountries()) expect(row, cc).toMatch(word(cc));
      expect(page).not.toMatch(/seuls endroits|einzigen Stellen|are the places where this flag/);
    },
  );

  // The paragraph under the table lists the same countries by name. Several of them
  // are served from a partial list, and three from the list of an infrastructure
  // operator: its opening sentence may not call every source "the country's own
  // register" (review of 18.11.2026, where the row was right and this sentence not).
  it.each(['en', 'fr', 'de'])(
    '%s: the paragraph on the national_register basis does not call every list a national register',
    (locale) => {
      const page = readFileSync(
        join(ROOT, 'frontend', 'content', locale, 'docs', 'iban-validate.mdx'),
        'utf8',
      );
      const bullet = page
        .split('\n')
        .find((line) =>
          line.startsWith('- **`basis: "national_register"`, `authoritative: true`**'),
        );
      expect(bullet).toBeDefined();
      const opening = bullet!.slice(0, bullet!.indexOf('**', bullet!.indexOf('** —') + 2));
      expect(opening).not.toMatch(
        /the country's own register publishes|le registre national du pays publie|das nationale Register des Landes veröffentlicht/,
      );
      expect(opening).toMatch(/a register or a list|un registre ou une liste|Register oder eine/);
    },
  );
});

/**
 * The data-sources page said "San Marino is where the two authority flags part
 * company" while eight other lists pair the BIC the same way (review of
 * 19/11/2026). The sentence now names them all, in three languages, and follows
 * the code when a list joins.
 */
describe('the data-sources page names every list that pairs the BIC', () => {
  const MARKER = {
    en: 'where the two authority flags part company',
    fr: "drapeaux d'autorité se séparent",
    de: 'Autoritäts-Flags auseinandergehen',
  } as const;
  const partialPairing = nationalRegisterBicCountries().filter(
    (cc) => !authoritativeCountries().includes(cc),
  );

  it.each(['en', 'fr', 'de'] as const)('%s', (locale) => {
    const page = readFileSync(
      join(ROOT, 'frontend', 'content', locale, 'docs', 'data-sources.mdx'),
      'utf8',
    );
    const line = page.split('\n').find((l) => l.includes(MARKER[locale]));
    expect(line, `${locale}: no sentence on the two flags`).toBeDefined();
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    for (const cc of partialPairing) {
      const name = locale === 'en' ? (getCountryName(cc) ?? cc) : (names.of(cc) ?? cc);
      expect(line!.toLowerCase(), `${locale}: ${cc}`).toContain(name.toLowerCase());
    }
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
