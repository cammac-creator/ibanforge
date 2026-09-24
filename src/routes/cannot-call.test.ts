import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import {
  CANNOT_CALL_TITLE,
  CONNECTOR_HINT,
  NO_SIMULATION_RULE,
  READ_ONLY_ANSWERS,
  cannotCallJson,
  cannotCallLines,
} from '../lib/positioning.js';

/**
 * The block for the assistant that can read a page but cannot call the API,
 * held on every surface that carries it (second test of the assistants,
 * 24/09/2026: DeepSeek could only GET, found no real answer, and simulated).
 *
 * Written once in src/lib/positioning.ts. The API surfaces import it; the three
 * static files cannot, so they are compared to it byte for byte. And every
 * address it names must lead somewhere: a dead link in a block whose whole
 * point is "open this instead of guessing" would send the reader back to
 * guessing.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** The static files that carry the block verbatim, under the same heading. */
const STATIC_SURFACES = ['README.md', 'frontend/public/llms.txt', 'frontend/public/llms-full.txt'];

const app = buildApp();

describe('the static surfaces carry the block verbatim', () => {
  it.each(STATIC_SURFACES)('%s', (rel) => {
    const text = read(rel);
    expect(text, `${rel}: heading`).toContain(`## ${CANNOT_CALL_TITLE}\n`);
    expect(text, `${rel}: resync the block from cannotCallLines()`).toContain(
      cannotCallLines().join('\n'),
    );
  });
});

describe('the API surfaces serve it', () => {
  it('/llms.txt', async () => {
    const text = await (await app.request('/llms.txt')).text();
    expect(text).toContain(`## ${CANNOT_CALL_TITLE}\n\n${cannotCallLines().join('\n')}`);
  });

  it('GET /v1', async () => {
    const body = (await (await app.request('/v1')).json()) as { if_you_cannot_call?: unknown };
    expect(body.if_you_cannot_call).toEqual(JSON.parse(JSON.stringify(cannotCallJson())));
  });

  it('the MCP server card', async () => {
    const card = (await (await app.request('/.well-known/mcp/server-card.json')).json()) as {
      if_you_cannot_call?: unknown;
    };
    expect(card.if_you_cannot_call).toEqual(JSON.parse(JSON.stringify(cannotCallJson())));
  });
});

describe('every address of the block leads somewhere', () => {
  it('names full addresses, never a route to complete', () => {
    for (const { url } of READ_ONLY_ANSWERS) expect(url).toMatch(/^https:\/\//);
    expect(CONNECTOR_HINT).toContain('https://api.ibanforge.com/mcp');
    expect(CONNECTOR_HINT).toContain('https://ibanforge.com/docs/mcp');
  });

  it('the API address answers a plain GET, on this code', async () => {
    const api = READ_ONLY_ANSWERS.filter((a) => a.url.startsWith('https://api.ibanforge.com/'));
    expect(api.length).toBeGreaterThan(0);
    for (const { url } of api) {
      const res = await app.request(new URL(url).pathname);
      expect(res.status, url).toBe(200);
    }
  });

  it('each page of the site exists in the repository, in the three languages', () => {
    const site = [...READ_ONLY_ANSWERS.map((a) => a.url), 'https://ibanforge.com/docs/mcp'].filter(
      (u) => u.startsWith('https://ibanforge.com/'),
    );
    expect(site.length).toBeGreaterThan(2);
    for (const url of site) {
      const path = new URL(url).pathname;
      const blog = /^\/blog\/([a-z0-9-]+)$/.exec(path);
      const doc = /^\/docs\/([a-z0-9-]+)$/.exec(path);
      const country = /^\/iban\/([a-z]{2})$/.exec(path);
      if (blog) {
        for (const lang of ['en', 'fr', 'de'])
          expect(existsSync(join(ROOT, `frontend/content/${lang}/blog/${blog[1]}.mdx`)), url).toBe(
            true,
          );
      } else if (doc) {
        for (const lang of ['en', 'fr', 'de'])
          expect(existsSync(join(ROOT, `frontend/content/${lang}/docs/${doc[1]}.mdx`)), url).toBe(
            true,
          );
      } else if (country) {
        expect(existsSync(join(ROOT, 'frontend/app/[locale]/iban/[cc]/page.tsx')), url).toBe(true);
        const data = JSON.parse(read('frontend/data/countries.json')) as {
          countries: Record<string, unknown>;
        };
        expect(data.countries[country[1].toUpperCase()], url).toBeDefined();
      } else {
        throw new Error(`${url}: no rule says where this page lives; add one`);
      }
    }
  });
});

describe('what the block may not say', () => {
  const text = [...cannotCallLines(), CANNOT_CALL_TITLE].join('\n');

  it('carries no allowance figure, so the guards on the trial need not follow it', () => {
    expect(text).not.toMatch(/\b\d+\s*(calls?|requests?|validations?|checks?)\b/i);
    expect(text).not.toMatch(/\b(a|per) (day|week|month)\b/i);
  });

  it('writes no verdict down: the address says it, dated', () => {
    expect(text).not.toMatch(/not_allocated|allocated to nobody|nobody holds/);
  });

  it('is plain text, the same bytes in JSON, a text file and a README', () => {
    expect(text).not.toMatch(/`|\*\*|\]\(|\?src=/);
  });

  it('asks not to simulate', () => {
    expect(NO_SIMULATION_RULE).toMatch(/Do not simulate/);
  });
});
