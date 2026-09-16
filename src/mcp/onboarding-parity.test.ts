import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mcpCard } from '../routes/mcp-card.js';
import { MCP_TOOLS } from './inventory.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';
import {
  REST_TRIAL_DAILY_LIMIT,
  TRIAL_FREE_KEY_HINT,
  TRIAL_DOCS_URL,
  TRIAL_RESET,
} from '../lib/trial.js';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const catalogue = JSON.parse(read('frontend/data/onboarding.json'));

describe('Prise en main : parité avec les contrats servis', () => {
  it('annonce les outils réellement disponibles dans chaque transport', () => {
    const remote = [
      ...read('src/routes/mcp-http.ts').matchAll(/registerTool\(\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);
    const installed = [...read('mcp/src/index.ts').matchAll(/^ {4}name: '([a-z_]+)',/gm)].map(
      (m) => m[1],
    );
    expect([...catalogue.remote].sort()).toEqual(remote.sort());
    expect([...catalogue.installed].sort()).toEqual(installed.sort());
    expect(catalogue.tools).toEqual(MCP_TOOLS.map(({ name, price }) => ({ name, price })));
    expect(catalogue.anonymousMonthly).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(catalogue.claimedMonthly).toBe(FREE_TIER_MONTHLY_LIMIT);
  });

  it('distingue le sous-ensemble indexable du catalogue HTTP complet', async () => {
    const app = new Hono().route('/', mcpCard);
    const response = await app.request('/.well-known/mcp.json');
    const card = await response.json();
    expect(card.tools_scope).toBe('read_only_data');
    expect(card.available_tools).toEqual(catalogue.remote);
    expect(card.tools.map((tool: { name: string }) => tool.name)).toEqual(
      MCP_TOOLS.filter((tool) => tool.readOnly).map((tool) => tool.name),
    );
  });

  it.each(['fr', 'en', 'de'])('publie le vrai bloc trial en %s, attribution comprise', (locale) => {
    const source = read(`frontend/content/${locale}/docs/index.mdx`);
    const block = source.match(/"trial": (\{[\s\S]*?\n\})/)?.[1];
    expect(block).toBeTruthy();
    expect(JSON.parse(block!)).toEqual({
      calls_used_today: 1,
      calls_left_today: REST_TRIAL_DAILY_LIMIT - 1,
      daily_limit: REST_TRIAL_DAILY_LIMIT,
      resets: TRIAL_RESET,
      free_key: TRIAL_FREE_KEY_HINT,
      docs: TRIAL_DOCS_URL,
    });
  });
});
