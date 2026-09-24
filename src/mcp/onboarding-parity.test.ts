import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mcpCard } from '../routes/mcp-card.js';
import { MCP_DAILY_LIMIT } from '../lib/mcp-limits.js';
import { MCP_TOOLS } from './inventory.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';
import {
  REST_TRIAL_WEEKLY_LIMIT,
  TRIAL_FREE_KEY_HINT,
  TRIAL_DOCS_URL,
  TRIAL_RESET,
  trialResetsAt,
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
    expect(catalogue.remoteDaily).toBe(MCP_DAILY_LIMIT);
    expect(catalogue.anonymousMonthly).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(catalogue.claimedMonthly).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(catalogue.restTrialWeekly).toBe(REST_TRIAL_WEEKLY_LIMIT);
    expect(catalogue.restTrialReset).toBe(TRIAL_RESET);
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

  // Le bloc tel que la route le sert à un premier appel, un jeudi : les champs
  // de la semaine depuis le 24/09/2026, et l'instant de remise à zéro d'une
  // date fixe pour que l'exemple ne change pas d'une semaine à l'autre.
  const EXPECTED_TRIAL = {
    calls_used_this_week: 1,
    calls_left_this_week: REST_TRIAL_WEEKLY_LIMIT - 1,
    weekly_limit: REST_TRIAL_WEEKLY_LIMIT,
    resets: TRIAL_RESET,
    resets_at: trialResetsAt(new Date('2026-09-24T12:00:00Z')),
    free_key: TRIAL_FREE_KEY_HINT,
    docs: TRIAL_DOCS_URL,
  };

  it.each(['fr', 'en', 'de'])('publie le vrai bloc trial en %s, attribution comprise', (locale) => {
    const source = read(`frontend/content/${locale}/docs/index.mdx`);
    const block = source.match(/"trial": (\{[\s\S]*?\n\})/)?.[1];
    expect(block).toBeTruthy();
    expect(JSON.parse(block!)).toEqual(EXPECTED_TRIAL);
  });

  // Même bloc dans la page Prise en main, recopié à la main au milieu d'une
  // réponse plus longue : le bloc ENTIER est tenu égal, pas seulement le conseil.
  it.each(['fr', 'en', 'de'])('recopie le bloc trial entier dans onboarding (%s)', (locale) => {
    const source = read(`frontend/content/${locale}/docs/onboarding.mdx`);
    const block = source.match(/\n( +)"trial": (\{[\s\S]*?\n\1\})/)?.[2];
    expect(block, 'bloc trial introuvable dans onboarding.mdx').toBeTruthy();
    expect(JSON.parse(block!)).toEqual(EXPECTED_TRIAL);
  });

  // La page Prise en main recopie le même bloc à la main, au milieu d'une réponse
  // plus longue que `scripts/export-onboarding.ts` ne réécrit pas. Le 24/09/2026 le
  // conseil a changé et cette copie serait restée à l'ancienne phrase sans que rien
  // ne rougisse : elle est tenue égale à la constante servie, ligne pour ligne.
  it.each(['fr', 'en', 'de'])(
    'recopie mot pour mot le conseil servi dans onboarding (%s)',
    (locale) => {
      const source = read(`frontend/content/${locale}/docs/onboarding.mdx`);
      const lines = source.split('\n').filter((line) => line.trim().startsWith('"free_key":'));
      expect(lines).toEqual([`    "free_key": ${JSON.stringify(TRIAL_FREE_KEY_HINT)},`]);
    },
  );
});
