import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS } from '../src/mcp/inventory.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../src/lib/tiers.js';
import {
  REST_TRIAL_DAILY_LIMIT,
  TRIAL_RESET,
  TRIAL_FREE_KEY_HINT,
  TRIAL_DOCS_URL,
} from '../src/lib/trial.js';

// Export autonome : le site ne charge ni serveur MCP, ni base de données.
const root = new URL('../', import.meta.url);
const installedSource = readFileSync(new URL('mcp/src/index.ts', root), 'utf8');
const installed = [...installedSource.matchAll(/^ {4}name: '([a-z_]+)',/gm)].map((m) => m[1]);
const remote = MCP_TOOLS.map((tool) => tool.name);
const catalogue = {
  remote,
  installed,
  tools: MCP_TOOLS.map(({ name, price }) => ({ name, price })),
  anonymousMonthly: ANONYMOUS_MONTHLY_LIMIT,
  claimedMonthly: FREE_TIER_MONTHLY_LIMIT,
};
writeFileSync(
  new URL('frontend/data/onboarding.json', root),
  JSON.stringify(catalogue, null, 2) + '\n',
);

// Les exemples gardent le jeton d'attribution de l'essai, sans adresse e-mail.
const trial = {
  calls_used_today: 1,
  calls_left_today: REST_TRIAL_DAILY_LIMIT - 1,
  daily_limit: REST_TRIAL_DAILY_LIMIT,
  resets: TRIAL_RESET,
  free_key: TRIAL_FREE_KEY_HINT,
  docs: TRIAL_DOCS_URL,
};
for (const locale of ['fr', 'en', 'de']) {
  const path = new URL(`frontend/content/${locale}/docs/index.mdx`, root);
  const source = readFileSync(path, 'utf8');
  const updated = source.replace(
    /"trial": \{[\s\S]*?\n\}/,
    `"trial": ${JSON.stringify(trial, null, 2)}`,
  );
  if (source === updated && !source.includes(JSON.stringify(trial.free_key))) {
    throw new Error(`Exemple trial introuvable : ${fileURLToPath(path)}`);
  }
  writeFileSync(path, updated);
}
