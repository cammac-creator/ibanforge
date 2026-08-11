# Dashboard analytics evolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dashboard's analysis from traffic-watching into client/money-watching, make the measurement chain self-diagnosing, and add an auto-written weekly digest.

**Architecture:** One new admin endpoint aggregates activation per email (backend does all math). Reliability = freshness witness + expected band + event annotations, all served by existing stats routes. Digest = VPS cron script that reads a single new admin facts endpoint (backend computes WoW deltas), has Claude write French prose, stores via admin POST, shows on dashboard.

**Tech Stack:** Hono + better-sqlite3 (backend), Next.js App Router server components (frontend), Python cron on VPS (digest), vitest.

## Global Constraints

- Repo is PUBLIC: no real activity figures, no client names/emails anywhere (fixtures: `acme@example.com`, `Société Alpha`). Applies to code, comments, tests, commits.
- `git fetch` + rebase before EVERY push. Never push during an npm publish.
- `npm run check` (typecheck + lint + test) green before every push.
- Railway deploys on push; Vercel frontend requires `vercel alias set <url> ibanforge.com` + same for `www.ibanforge.com` after promotion checks.
- Admin auth: `isAdminAuthorized(c.req.header('X-Admin-Secret'))` (src/routes/api-keys.ts). Stats auth: Bearer `STATS_TOKEN` (src/routes/stats.ts `checkAuth`).
- Internal accounts excluded via `isInternalEmail` (src/lib/internal-accounts.ts).
- New tables are created in `src/lib/db.ts` inside the existing `CREATE TABLE IF NOT EXISTS` block (idempotent boot migration).
- All dates handled in UTC, `datetime('now')` conventions as existing code.

---

### Task A1: `src/lib/activation.ts` — per-email activation aggregation

**Files:**
- Create: `src/lib/activation.ts`
- Test: `src/lib/activation.test.ts`

**Interfaces:**
- Consumes: `getStatsDB()` from `./db.js`, `isInternalEmail` from `./internal-accounts.js`.
- Produces (used by Task A2 route and Task B page):

```ts
export interface ActivationClient {
  email: string;
  keys: Array<{ key_prefix: string; role: 'free' | 'paid'; active: number }>;
  signup_at: string;            // min(created_at) over keys
  source: string;               // first non-null source, else 'direct'
  first_call_at: string | null; // min(created_at) in request_log over key prefixes
  last_seen_at: string | null;
  calls_90d: number;            // request_log rows, any status 2xx, over prefixes
  free_used_month: number;      // api_usage current month over free keys
  free_quota: number;           // sum(monthly_limit ?? 200) over free keys
  paywall_hits: number;         // request_log status IN (402,429) over prefixes, 90d
  credits_total: number;        // sum over paid keys
  credits_remaining: number;
  packs: number;                // count of paid keys
  status: 'new' | 'active' | 'at-limit' | 'paying' | 'dormant' | 'silent';
}
export interface ActivationFunnel {
  period_days: number;
  signed_up: number; first_call: number; hit_limit: number; purchased: number;
  median_hours_signup_to_first_call: number | null;
  median_hours_first_call_to_purchase: number | null;
}
export interface ActivationSourceRow {
  source: string; signups: number; called: number; paying: number;
}
export interface ActivationCohort {
  week_start: string; // Monday YYYY-MM-DD
  signups: number; called_pct: number; paid_pct: number;
}
export interface ActivationResponse {
  clients: ActivationClient[];          // sorted: paying first, then by last_seen desc
  funnel: ActivationFunnel;             // over signups of the period
  sources: ActivationSourceRow[];
  cohorts: ActivationCohort[];          // last 8 ISO weeks, oldest first
}
export function getActivation(days = 30): ActivationResponse;
```

- Status rules (paid state wins over `used`, THE point of this task):
  - `paying`: packs > 0 and last_seen within 14 days.
  - `dormant`: packs > 0 and (no call ever or last_seen older than 14 days).
  - `at-limit`: no pack and (free_used_month >= free_quota or paywall_hits > 0).
  - `active`: no pack, has called within 14 days.
  - `new`: signup < 3 days ago and never called.
  - `silent`: never called, signup >= 3 days.
- Funnel steps counted independently over the same population (signups within period): a step is "reached at least this state ever".
- Medians computed in TS over hour-deltas; null when no sample.
- Cohort week_start = `date(created_at, 'weekday 1', '-7 days')` is WRONG in SQLite semantics — use `date(created_at, '-' || ((strftime('%w', created_at) + 6) % 7) || ' days')` (Monday of that week). Verify with a Wednesday fixture.

**Steps:**

- [ ] **A1.1 Write failing tests** covering: paid key with `used=0` must yield status `paying` (regression for the unused-lie); internal emails excluded; funnel counts on a seeded fixture (2 signups, 1 called, 1 purchased); cohort Monday computation from a Wednesday signup; sources rollup with null source → `direct`. Use an in-memory/dedicated temp sqlite via existing test conventions (see `src/lib/stats.ts` tests for the pattern — if none, create the DB through `getStatsDB()` with `STATS_DB_PATH` temp override as other tests do; check `src/routes/api-keys.test.ts` for the established fixture pattern and reuse it).
- [ ] **A1.2 Run tests** — expect failure (module not found).
- [ ] **A1.3 Implement `getActivation`** — 4 prepared queries (keys by email; request_log aggregates per prefix batched with `IN`; api_usage current month; paywall counts), then pure-TS assembly. No per-client N+1 queries.
- [ ] **A1.4 Run tests** — green.
- [ ] **A1.5 Commit** `feat(stats): per-email activation aggregation (paid state wins over used)`.

### Task A2: route `GET /v1/admin/activation` + clean revenue field

**Files:**
- Modify: `src/routes/api-keys.ts` (new admin route next to `/v1/admin/client-profiles`)
- Modify: `src/lib/stats.ts` `getStats()` (add `total_revenue_usdc_clean`)
- Test: `src/routes/api-keys.test.ts` (route auth + shape), `src/routes/stats.test.ts`

**Interfaces:**
- Produces: `GET /v1/admin/activation?days=30|90` → `ActivationResponse` (401 without header). `getStats()` gains `total_revenue_usdc_clean: number` = `SELECT COALESCE(SUM(revenue_usdc),0) FROM daily_stats WHERE date >= '2026-04-18'` (excludes the pre-2026-04-17 phantom-settlement drift the tooltip already documents).

**Steps:**

- [ ] **A2.1 Failing test**: route returns 401 without secret, 200 shape with; `total_revenue_usdc_clean <= total_revenue_usdc`.
- [ ] **A2.2 Implement** route (clamp days to {30, 90}, default 30) + field.
- [ ] **A2.3 `npm run check`** green.
- [ ] **A2.4 Commit + fetch/rebase + push** `feat(admin): activation endpoint; clean revenue total` → Railway. Verify live: `curl -s -H "X-Admin-Secret: $S" https://api.ibanforge.com/v1/admin/activation?days=30 | jq '.funnel'` (secret read from `railway variables`, never echoed).

### Task B1: `components/dashboard/clients-table.tsx`

**Files:**
- Create: `frontend/components/dashboard/clients-table.tsx`
- Modify: `frontend/app/[locale]/dashboard/(protected)/page.tsx` (replace the "Clients & leads" table + its `classify`/`KeyRow` plumbing with the new component fed by `ActivationResponse`)

**Interfaces:**
- Props: `{ clients: ActivationClient[]; locale: string }` (types re-declared locally in the component file, as the page does for its other payloads).
- Rendering rules: one row per email — email + key count · source chip · signed-up age · first-call delay (h/j) · free usage bar `used/quota` · **credits bar `remaining/total` + badge PAYANT when packs > 0** · status pill (colors: paying #22c55e, dormant #f59e0b, at-limit #ef4444, active #3b82f6, new #a78bfa, silent #71717a). A paying client NEVER renders "unused".
- Keep the silent-pilots relance box logic? — replaced by `silent`/`dormant` pills; the amber "à relancer" banner now lists `dormant` paying clients + `silent` non-seeded clients (`SEEDED_PILOT_RE` still filters seeded outreach keys, imported from `@/lib/crm/build-contacts`).

**Steps:**

- [ ] **B1.1** Build component (server component, no state; overflow-x table like current one).
- [ ] **B1.2** Page: fetch `getJSON<ActivationResponse>('/v1/admin/activation?days=90', { 'X-Admin-Secret': ADMIN_SECRET })`, render `<ClientsTable/>`; delete `classify()`, `KeyRow`, `pilots` derivations that no longer have consumers (the KPI card "Clients pilotes" now counts `clients` with elevated quota from activation data: keep the card, value = clients whose free_quota > 200, "actifs" = those with a call this month approximated by last_seen within 30d — simpler and honest).
- [ ] **B1.3** `cd frontend && npm run build` green (build catches type drift).
- [ ] **B1.4** Commit `feat(dashboard): clients table reads activation (credits visible, no more unused lie)`.

### Task B2: `components/dashboard/activation-funnel.tsx` + sources + cohorts

**Files:**
- Create: `frontend/components/dashboard/activation-funnel.tsx` (props `{ funnel: ActivationFunnel }`: 4 steps horizontal bars with counts, pass-through % between steps, median delays under the arrows)
- Create: `frontend/components/dashboard/acquisition-panel.tsx` (props `{ sources: ActivationSourceRow[]; cohorts: ActivationCohort[]; locale: string }`: left = source bars with % called; right = 8-week grid, two mini-columns per week: called_pct, paid_pct)
- Modify: `frontend/app/[locale]/dashboard/(protected)/page.tsx` (activation funnel becomes the top block after the KPI row; HTTP business funnel moves below it; acquisition panel after the clients table)

**Steps:**

- [ ] **B2.1** Build both components (pure presentational, tabular-nums, same card idiom `rounded-xl border...` as page).
- [ ] **B2.2** Wire into page in the order above.
- [ ] **B2.3** `npm run build` green; commit.
- [ ] **B2.4** KPI revenue card switches to `total_revenue_usdc_clean` with hint updated (mention of the 2026-04-17 boundary), remove the "surestimé" apology.
- [ ] **B2.5** fetch/rebase, push, then deploy check: `vercel ls` → grab newest prod URL → smoke on `<url>/fr/dashboard` (302 to login is the healthy signal) → `vercel alias set <url> ibanforge.com` + `vercel alias set <url> www.ibanforge.com`. Commit message `feat(dashboard): activation funnel, acquisition panel, clean revenue KPI`.

### Task C1: freshness witness + events (backend)

**Files:**
- Modify: `src/lib/db.ts` (new table)
- Modify: `src/lib/stats.ts` (`getStats()` adds `last_write_at`; new `recordEvent`, `getEvents`)
- Modify: `src/routes/stats.ts` (`GET /stats/events?period=N`)
- Modify: `src/routes/api-keys.ts` (`POST /v1/admin/events` {label} → kind 'manual')
- Modify: `src/index.ts` (after `serve()` callback: `recordEvent('deploy', 'v' + pkg.version)`)
- Test: `src/lib/stats.test.ts` or colocated, `src/routes/stats.test.ts`

**Interfaces:**

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  kind TEXT NOT NULL CHECK (kind IN ('deploy','manual')),
  label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(created_at);
```

```ts
export function recordEvent(kind: 'deploy' | 'manual', label: string): void; // label truncated to 120 chars
export interface EventRow { created_at: string; kind: string; label: string }
export function getEvents(days = 90): EventRow[];
// getStats() adds: last_write_at: string | null  (SELECT MAX(created_at) FROM request_log)
```

- Deploy-event dedup: skip insert when the latest `deploy` event has the same label AND is < 6 h old (Railway restarts must not spam the chart).

**Steps:**

- [ ] **C1.1** Failing tests: recordEvent/getEvents roundtrip; deploy dedup within 6 h; `last_write_at` present; POST route 401/200 + label required (400 on empty), label length clamp.
- [ ] **C1.2** Implement all; `npm run check` green.
- [ ] **C1.3** Commit + push `feat(stats): freshness witness and event annotations`.

### Task C2: expected band in history (backend)

**Files:**
- Modify: `src/lib/stats.ts` `getStatsHistory` — widen the internal request_log query window to `days + 56`, compute per returned date `expected_min`/`expected_max` = min/max of `total_requests` over up to 8 prior same-weekday dates (fewer when history is short; both null when < 3 samples), then slice back to `days`.
- Test: colocated — seed 10 same-weekday days with known totals, assert band excludes the current day and nulls under 3 samples.

**Steps:**

- [ ] **C2.1** Failing test.
- [ ] **C2.2** Implement in JS post-processing (no SQL window functions needed).
- [ ] **C2.3** `npm run check`; commit + push `feat(stats): weekday expected band on history`.

### Task C3: reliability UI

**Files:**
- Modify: `frontend/components/dashboard/live-health-strip.tsx` (freshness display + red state)
- Modify: `frontend/components/stacked-bar-chart.tsx` (optional props `band?: Array<{min:number|null;max:number|null}>` aligned to data, `markers?: Array<{date:string;label:string;kind:string}>` → grey band overlay + vertical dashed lines with title tooltip)
- Modify: `frontend/app/[locale]/dashboard/(protected)/page.tsx` (getJSON returns `{ok, data, status}` so each block distinguishes fetch-failure from zero; failure state = explicit small error card "Bloc indisponible (HTTP xxx)" instead of zeros; pass band + events to the chart)
- Modify: page fetch list (add `/stats/events?period=…`)

**Interfaces:**
- `getJSON` becomes `fetchJSON<T>(path, headers): Promise<{ ok: boolean; status: number; data: T | null }>`; every consumer updated in the page file. Freshness rule in LiveHealthStrip props: `lastWriteAt: string | null` — red banner when older than 30 min AND current UTC hour in [6, 22).

**Steps:**

- [ ] **C3.1** Implement chart props (SVG/div overlay consistent with its current rendering approach — read the component first).
- [ ] **C3.2** Implement fetchJSON + per-block error states + wire band/markers/freshness.
- [ ] **C3.3** `npm run build`; commit; fetch/rebase push; promote alias apex+www after prod-URL smoke.

### Task D1: weekly digest storage + facts endpoint (backend)

**Files:**
- Modify: `src/lib/db.ts` (table `weekly_digest(week TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')), body_fr TEXT NOT NULL, facts_json TEXT NOT NULL)`)
- Create: `src/lib/weekly-facts.ts` (`getWeeklyFacts()` — see shape below; all WoW deltas computed HERE in tested TS)
- Modify: `src/routes/api-keys.ts` — `POST /v1/admin/digest` {week, body_fr, facts_json?} upsert; `GET /v1/admin/digest?limit=8` list desc; `GET /v1/admin/weekly-facts` → getWeeklyFacts()
- Test: `src/lib/weekly-facts.test.ts` + route tests

**Interfaces:**

```ts
export interface WeeklyFacts {
  week: string;            // ISO 'YYYY-Www' of LAST full week (Mon–Sun, UTC)
  range: { from: string; to: string };
  requests: { current: number; previous: number; delta_pct: number | null };
  billable_ok: { current: number; previous: number; delta_pct: number | null };
  paywall_hits: { current: number; previous: number; delta_pct: number | null };
  server_errors: { current: number; previous: number };
  signups: { current: number; previous: number };
  first_calls: { current: number; previous: number };   // clients whose first_call_at falls in week
  purchases: { current: number; previous: number };     // paid keys created in week
  revenue_usdc_attempted: { current: number; previous: number };
  top_sources: Array<{ source: string; signups: number }>; // current week
  top_countries: Array<{ country: string; count: number }>; // current week, operations
}
export function getWeeklyFacts(): WeeklyFacts;
```

- `delta_pct` = null when previous = 0 (the writer says "semaine précédente à zéro", no invented %).
- Week boundary: last full Monday–Sunday window before now (UTC).

**Steps:**

- [ ] **D1.1** Failing tests: week windowing (freeze a known date via injectable `now?: Date` param default `new Date()`), delta null on zero-previous, upsert idempotent (POST twice same week → one row, body replaced).
- [ ] **D1.2** Implement; `npm run check` green.
- [ ] **D1.3** Commit + fetch/rebase + push `feat(admin): weekly facts endpoint and digest storage`.

### Task D2: dashboard digest card

**Files:**
- Create: `frontend/components/dashboard/weekly-digest-card.tsx` (props `{ digests: Array<{week:string;created_at:string;body_fr:string}> }` — newest rendered as prose card "Le point — semaine XX", older ones inside `<details>`)
- Modify: page — fetch `GET /v1/admin/digest?limit=8` (ADMIN_SECRET), card placed FIRST, above KPI row; hidden entirely when list empty.

**Steps:**

- [ ] **D2.1** Component + wiring; `npm run build`.
- [ ] **D2.2** Commit; push; promote alias after smoke.

### Task D3: VPS script + cron

**Files:**
- Create (scratchpad → scp): `~/ibf-weekly-digest.py` on VPS `ubuntu@83.228.246.158`
- Cron: `0 7 * * 1 ... # ibf-weekly-digest` (07:00 UTC Monday)

**Behavior (mirrors ibf-activation.py conventions):**
- Env from `/home/ubuntu/tabornio/.env` (IBF_ADMIN_SECRET, ANTHROPIC_API_KEY, TELEGRAM_NATALYA_TOKEN, chat 1614272155).
- Kill-switch `~/ibf-digest.pause`; `--dry-run` prints, no POST/Telegram.
- GET weekly-facts → build French prompt: facts verbatim, rules "chiffres copiés à l'EXACT, aucune arithmétique, aucune capacité déduite, pas de tiret cadratin, 6-10 phrases, terminer par 1-3 gestes concrets préfixés '→'". Model `claude-sonnet-5`, fallback `claude-haiku-4-5-20251001`, max_tokens 2000, join ALL text blocks.
- Post-check: length 300–2000 chars, no em-dash (normalize), must contain at least one '→'. Refused twice → log + Telegram failure note, no POST.
- POST /v1/admin/digest (upsert = safe re-run) → Telegram message with the digest body.
- Log `~/ibf-digest.log`.

**Steps:**

- [ ] **D3.1** Write script in scratchpad, `--dry-run` locally against prod facts endpoint (secret via env, never echoed).
- [ ] **D3.2** scp to VPS, run `--dry-run` there, install cron line (marker `# ibf-weekly-digest`), run once FOR REAL to seed the first digest (visible on dashboard + Telegram).
- [ ] **D3.3** Memory note update (fiche mails-activation gets a sibling or extension).

### Final: live verification

- [ ] All endpoints probed on api.ibanforge.com (secrets from railway variables, muted).
- [ ] Dashboard promoted (apex + www), digest visible, clients table shows credits.
- [ ] Memory + report.

## Self-review

- Spec coverage: Axe 1 → A1/A2/B1/B2; Axe 2 → C1/C2/C3; Axe 3 → D1/D2/D3; revenue boundary → A2+B2.4; erreur≠zéro → C3; ordre des blocs → B2/D2. ✔
- No placeholders; signatures consistent across tasks (ActivationResponse reused in B1/B2; WeeklyFacts in D1/D3). ✔
- Types: `fetchJSON` renamed once and used everywhere in page (C3). ✔
