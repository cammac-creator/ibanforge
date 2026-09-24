import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MCP_DAILY_LIMIT } from '../src/lib/mcp-limits.js';
import { MCP_TOOLS } from '../src/mcp/inventory.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../src/lib/tiers.js';
import {
  REST_TRIAL_WEEKLY_LIMIT,
  TRIAL_RESET,
  TRIAL_FREE_KEY_HINT,
  TRIAL_DOCS_URL,
  trialResetsAt,
} from '../src/lib/trial.js';

// Export autonome : le site ne charge ni serveur MCP, ni base de données.
const root = new URL('../', import.meta.url);
const installedSource = readFileSync(new URL('mcp/src/index.ts', root), 'utf8');
const installed = [...installedSource.matchAll(/^ {4}name: '([a-z_]+)',/gm)].map((m) => m[1]);
const remote = MCP_TOOLS.map((tool) => tool.name);
const catalogue = {
  remoteDaily: MCP_DAILY_LIMIT,
  remote,
  installed,
  tools: MCP_TOOLS.map(({ name, price }) => ({ name, price })),
  anonymousMonthly: ANONYMOUS_MONTHLY_LIMIT,
  claimedMonthly: FREE_TIER_MONTHLY_LIMIT,
  // L'essai sans clé, compté à la semaine ISO en UTC depuis le 24/09/2026.
  // Exporté pour que le site puisse le lire au lieu de le retaper ; aucune page
  // ne le lit encore, et onboarding-parity.test.ts le tient égal à la constante.
  restTrialWeekly: REST_TRIAL_WEEKLY_LIMIT,
  restTrialReset: TRIAL_RESET,
};
writeFileSync(
  new URL('frontend/data/onboarding.json', root),
  JSON.stringify(catalogue, null, 2) + '\n',
);

// Les exemples gardent le jeton d'attribution de l'essai, sans adresse e-mail.
// `resets_at` est celui d'une date fixe, pour que l'export soit reproductible.
const trial = {
  calls_used_this_week: 1,
  calls_left_this_week: REST_TRIAL_WEEKLY_LIMIT - 1,
  weekly_limit: REST_TRIAL_WEEKLY_LIMIT,
  resets: TRIAL_RESET,
  resets_at: trialResetsAt(new Date('2026-09-24T12:00:00Z')),
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
