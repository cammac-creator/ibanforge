# Dashboard IBANforge v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete redesign of the IBANforge dashboard with Stripe-style visuals, top-nav layout, and two new pages (Analytics + Quality) for product intelligence.

**Architecture:** Backend-first approach — extend stats.sqlite schema and add 3 new API endpoints, then rebuild the frontend with new layout and components. Server Components for data pages, Client Components only for interactive elements (monitoring, period selector).

**Tech Stack:** Hono + better-sqlite3 (backend), Next.js 16 App Router + React 19 + Recharts + Tailwind 4 + next-intl (frontend)

---

## File Map

### Backend (new/modified)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/db.ts` | Modify | Add `hourly_stats` table + new columns to `operations` |
| `src/lib/stats.ts` | Modify | Update `recordOperation`/`recordBatch`, add query functions |
| `src/routes/stats.ts` | Modify | Add `/stats/hourly`, `/stats/errors`, `/stats/patterns` endpoints |
| `src/types.ts` | Modify | Add response types for new endpoints |
| `src/lib/stats.test.ts` | Create | Tests for new query functions |

### Frontend — Components (new/modified)

| File | Action | Responsibility |
|------|--------|---------------|
| `components/dashboard/top-nav.tsx` | Create | Horizontal tab navigation + period selector + logo |
| `components/dashboard/stat-card-v2.tsx` | Create | Gradient card with sparkline SVG + trend badge |
| `components/dashboard/heatmap.tsx` | Create | 24×7 hour/day heatmap with tooltip |
| `components/dashboard/error-table.tsx` | Create | Compact table for top errors/BICs |
| `components/dashboard/progress-bars.tsx` | Create | Horizontal bars with labels + % |
| `components/line-chart.tsx` | Modify | Updated styling (gradient area fill option) |

### Frontend — Pages (modified)

| File | Action | Responsibility |
|------|--------|---------------|
| `app/[locale]/dashboard/(protected)/layout.tsx` | Rewrite | Top-nav layout, remove sidebar |
| `app/[locale]/dashboard/(protected)/page.tsx` | Rewrite | Overview with StatCardV2, sparklines, progress bars |
| `app/[locale]/dashboard/(protected)/analytics/page.tsx` | Create | Heatmap, patterns, geo trends |
| `app/[locale]/dashboard/(protected)/quality/page.tsx` | Create | Error rates, top invalid IBANs, BIC misses |
| `app/[locale]/dashboard/(protected)/monitoring/page.tsx` | Modify | Restyle into new design system |

### Frontend — i18n

| File | Action | Responsibility |
|------|--------|---------------|
| `messages/en.json` | Modify | Add `dashboard.analytics.*`, `dashboard.quality.*`, `dashboard.topNav.*` |
| `messages/fr.json` | Modify | Same keys in French |
| `messages/de.json` | Modify | Same keys in German |

### Frontend — Cleanup

| File | Action | Responsibility |
|------|--------|---------------|
| `components/dashboard/sidebar-nav.tsx` | Delete | Replaced by top-nav |
| `components/dashboard/dashboard-header.tsx` | Delete | Integrated into top-nav |
| `components/dashboard/quick-actions.tsx` | Delete | Replaced by top-nav |
| `components/donut-chart.tsx` | Delete | Replaced by progress-bars |
| `components/stat-card.tsx` | Delete | Replaced by stat-card-v2 |
| `app/[locale]/dashboard/(protected)/api-stats/` | Delete | Merged into overview + analytics |

---

## Task 1: Backend — Extend DB schema

**Files:**
- Modify: `src/lib/db.ts:35-53`

- [ ] **Step 1: Add new columns and table to getStatsDB()**

In `src/lib/db.ts`, replace the `statsDB.exec(...)` block inside `getStatsDB()` with:

```typescript
statsDB.exec(`
  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_type TEXT NOT NULL,
    country_code TEXT,
    success INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    hour INTEGER,
    day_of_week INTEGER,
    error_detail TEXT
  );
  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    total INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    revenue_usdc REAL DEFAULT 0,
    PRIMARY KEY (date, operation_type)
  );
  CREATE TABLE IF NOT EXISTS hourly_stats (
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    operation_type TEXT NOT NULL,
    total INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    PRIMARY KEY (date, hour, operation_type)
  );
`);
```

SQLite silently ignores `ADD COLUMN` if it already exists via `CREATE TABLE IF NOT EXISTS`, so existing data is safe. The new columns (`hour`, `day_of_week`, `error_detail`) will be `NULL` for existing rows — that's fine, we only query recent data.

- [ ] **Step 2: Verify backend builds**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run build`
Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/lib/db.ts
git commit -m "feat(stats): add hourly_stats table and new columns to operations"
```

---

## Task 2: Backend — Update recordOperation + recordBatch

**Files:**
- Modify: `src/lib/stats.ts:1-80`

- [ ] **Step 1: Add cached statement for hourly upsert**

Add after the existing `_upsertDaily` declaration (line ~10):

```typescript
let _upsertHourly: Database.Statement | null = null;

function upsertHourly() {
  if (!_upsertHourly) {
    _upsertHourly = getStatsDB().prepare(`
      INSERT INTO hourly_stats (date, hour, day_of_week, operation_type, total, success_count)
      VALUES (date('now'), ?, ?, ?, ?, ?)
      ON CONFLICT(date, hour, operation_type) DO UPDATE SET
        total = total + excluded.total,
        success_count = success_count + excluded.success_count
    `);
  }
  return _upsertHourly;
}
```

- [ ] **Step 2: Update insertOp to include new columns**

Replace the `insertOp()` function:

```typescript
function insertOp() {
  if (!_insertOp) {
    _insertOp = getStatsDB().prepare(
      'INSERT INTO operations (operation_type, country_code, success, hour, day_of_week, error_detail) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }
  return _insertOp;
}
```

- [ ] **Step 3: Update recordOperation signature and body**

Replace the existing `recordOperation` function:

```typescript
export function recordOperation(
  type: OperationType,
  countryCode: string | null,
  success: boolean,
  costUsdc: number,
  errorDetail?: string,
) {
  try {
    const now = new Date();
    const hour = now.getUTCHours();
    const dow = (now.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun
    const detail = errorDetail ? errorDetail.slice(0, 12) : null;
    insertOp().run(type, countryCode, success ? 1 : 0, hour, dow, detail);
    upsertDaily().run(type, 1, success ? 1 : 0, costUsdc);
    upsertHourly().run(hour, dow, type, 1, success ? 1 : 0);
  } catch {
    // Stats are non-critical — never crash the API
  }
}
```

- [ ] **Step 4: Update recordBatch**

Replace the existing `recordBatch` function:

```typescript
export function recordBatch(count: number, validCount: number, costUsdc: number) {
  try {
    const db = getStatsDB();
    const now = new Date();
    const hour = now.getUTCHours();
    const dow = (now.getUTCDay() + 6) % 7;
    const tx = db.transaction(() => {
      const stmt = insertOp();
      for (let i = 0; i < validCount; i++) stmt.run('iban_batch', null, 1, hour, dow, null);
      for (let i = 0; i < count - validCount; i++) stmt.run('iban_batch', null, 0, hour, dow, null);
      upsertDaily().run('iban_batch', count, validCount, costUsdc);
      upsertHourly().run(hour, dow, 'iban_batch', count, validCount);
    });
    tx();
  } catch {
    // Non-critical
  }
}
```

- [ ] **Step 5: Update resetStatsStatements**

```typescript
export function resetStatsStatements() {
  _insertOp = null;
  _upsertDaily = null;
  _upsertHourly = null;
}
```

- [ ] **Step 6: Update route callers to pass errorDetail**

In `src/routes/iban-validate.ts`, update the `recordOperation` call (line ~39):

```typescript
const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
recordOperation('iban_validate', result.country?.code ?? null, result.valid, result.cost_usdc, errorDetail);
```

In `src/routes/bic-lookup.ts`, update the `recordOperation` call (around line ~43):

```typescript
const errorDetail = found ? undefined : validation.bic;
recordOperation('bic_lookup', validation.country_code ?? null, found, COST_USDC, errorDetail);
```

- [ ] **Step 7: Build and verify**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run build`
Expected: Clean compilation.

- [ ] **Step 8: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/lib/stats.ts src/routes/iban-validate.ts src/routes/bic-lookup.ts
git commit -m "feat(stats): record hourly data and error details for dashboard v2"
```

---

## Task 3: Backend — Add new query functions

**Files:**
- Modify: `src/lib/stats.ts` (append after existing functions)
- Modify: `src/types.ts`

- [ ] **Step 1: Add types for new endpoints**

Append to `src/types.ts`:

```typescript
// --- Dashboard v2 Stats ---

export interface HourlyHeatmapEntry {
  day: number;    // 0=Mon, 6=Sun
  hour: number;   // 0-23
  total: number;
}

export interface HourlyStatsResponse {
  heatmap: HourlyHeatmapEntry[];
  peak_hours: { start: number; end: number; days: number[] };
  weekend_drop_pct: number;
}

export interface ErrorStatsResponse {
  error_rate: {
    iban_validate: { rate: number; trend: number[] };
    bic_lookup: { rate: number; trend: number[] };
  };
  top_invalid_ibans: Array<{ prefix: string; country: string; count: number; error_type: string }>;
  top_missing_bics: Array<{ bic: string; count: number; country: string }>;
  errors_by_country: Array<{ country: string; count: number }>;
}

export interface PatternStatsResponse {
  endpoint_share_trend: Array<{
    date: string;
    iban_validate: number;
    iban_batch: number;
    bic_lookup: number;
  }>;
  geo_trend: Array<Record<string, number | string>>;
  top_countries_list: string[];
}
```

- [ ] **Step 2: Add getHourlyStats function**

Append to `src/lib/stats.ts`:

```typescript
import type { HourlyStatsResponse, ErrorStatsResponse, PatternStatsResponse } from '../types.js';

export function getHourlyStats(days: number = 7): HourlyStatsResponse {
  const db = getStatsDB();

  const heatmap = db.prepare(`
    SELECT day_of_week as day, hour, SUM(total) as total
    FROM hourly_stats
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
  `).all(days) as Array<{ day: number; hour: number; total: number }>;

  // Find peak hours: the 6-hour window with highest total
  const hourTotals = new Array(24).fill(0);
  for (const row of heatmap) hourTotals[row.hour] += row.total;

  let bestStart = 0;
  let bestSum = 0;
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let offset = 0; offset < 6; offset++) sum += hourTotals[(start + offset) % 24];
    if (sum > bestSum) { bestSum = sum; bestStart = start; }
  }

  // Find peak days (weekdays with above-average traffic)
  const dayTotals = new Array(7).fill(0);
  for (const row of heatmap) dayTotals[row.day] += row.total;
  const avgDay = dayTotals.reduce((a, b) => a + b, 0) / 7;
  const peakDays = dayTotals.map((t, i) => t > avgDay ? i : -1).filter(d => d >= 0);

  // Weekend drop
  const weekdayTotal = dayTotals.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const weekendTotal = (dayTotals[5] + dayTotals[6]) / 2;
  const weekendDrop = weekdayTotal > 0 ? Math.round((1 - weekendTotal / weekdayTotal) * 100) : 0;

  return {
    heatmap,
    peak_hours: { start: bestStart, end: (bestStart + 6) % 24, days: peakDays },
    weekend_drop_pct: Math.max(0, weekendDrop),
  };
}
```

- [ ] **Step 3: Add getErrorStats function**

Append to `src/lib/stats.ts`:

```typescript
export function getErrorStats(days: number = 30): ErrorStatsResponse {
  const db = getStatsDB();

  // Error rates with daily trend (last 7 data points)
  function errorTrend(opType: string): number[] {
    const rows = db.prepare(`
      SELECT date,
        CASE WHEN total > 0 THEN ROUND((1.0 - (1.0 * success_count / total)) * 100, 1) ELSE 0 END as error_rate
      FROM daily_stats
      WHERE operation_type = ? AND date >= date('now', '-7 days')
      ORDER BY date ASC
    `).all(opType) as Array<{ date: string; error_rate: number }>;
    return rows.map(r => r.error_rate);
  }

  const ibanRate = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
    FROM operations WHERE operation_type = 'iban_validate' AND created_at >= datetime('now', '-' || ? || ' days')
  `).get(days) as { total: number; errors: number };

  const bicRate = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
    FROM operations WHERE operation_type = 'bic_lookup' AND created_at >= datetime('now', '-' || ? || ' days')
  `).get(days) as { total: number; errors: number };

  // Top invalid IBANs (by prefix pattern)
  const topInvalidIbans = db.prepare(`
    SELECT error_detail as prefix,
           SUBSTR(error_detail, 1, 2) as country,
           COUNT(*) as count
    FROM operations
    WHERE operation_type = 'iban_validate' AND success = 0 AND error_detail IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY error_detail
    ORDER BY count DESC
    LIMIT 10
  `).all(days) as Array<{ prefix: string; country: string; count: number }>;

  // Top missing BICs
  const topMissingBics = db.prepare(`
    SELECT error_detail as bic,
           SUBSTR(error_detail, 5, 2) as country,
           COUNT(*) as count
    FROM operations
    WHERE operation_type = 'bic_lookup' AND success = 0 AND error_detail IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY error_detail
    ORDER BY count DESC
    LIMIT 10
  `).all(days) as Array<{ bic: string; country: string; count: number }>;

  // Errors by country
  const errorsByCountry = db.prepare(`
    SELECT country_code as country, COUNT(*) as count
    FROM operations
    WHERE success = 0 AND country_code IS NOT NULL
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY country_code
    ORDER BY count DESC
    LIMIT 10
  `).all(days) as Array<{ country: string; count: number }>;

  return {
    error_rate: {
      iban_validate: {
        rate: ibanRate.total > 0 ? Math.round((ibanRate.errors / ibanRate.total) * 1000) / 10 : 0,
        trend: errorTrend('iban_validate'),
      },
      bic_lookup: {
        rate: bicRate.total > 0 ? Math.round((bicRate.errors / bicRate.total) * 1000) / 10 : 0,
        trend: errorTrend('bic_lookup'),
      },
    },
    top_invalid_ibans: topInvalidIbans.map(r => ({ ...r, error_type: 'validation' })),
    top_missing_bics: topMissingBics,
    errors_by_country: errorsByCountry,
  };
}
```

- [ ] **Step 4: Add getPatternStats function**

Append to `src/lib/stats.ts`:

```typescript
export function getPatternStats(days: number = 30): PatternStatsResponse {
  const db = getStatsDB();

  // Endpoint share trend (daily breakdown as %)
  const endpointTrend = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN operation_type = 'iban_validate' THEN total ELSE 0 END) as iban_validate,
      SUM(CASE WHEN operation_type = 'iban_batch' THEN total ELSE 0 END) as iban_batch,
      SUM(CASE WHEN operation_type = 'bic_lookup' THEN total ELSE 0 END) as bic_lookup
    FROM daily_stats
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date
    ORDER BY date ASC
  `).all(days) as Array<{ date: string; iban_validate: number; iban_batch: number; bic_lookup: number }>;

  // Geo trend — top 5 countries over time
  const topCountries = db.prepare(`
    SELECT country_code as country
    FROM operations
    WHERE country_code IS NOT NULL AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY country_code
    ORDER BY COUNT(*) DESC
    LIMIT 5
  `).all(days) as Array<{ country: string }>;

  const topCountriesList = topCountries.map(r => r.country);

  let geoTrend: Array<Record<string, number | string>> = [];
  if (topCountriesList.length > 0) {
    // Build a daily pivot for top countries
    const placeholders = topCountriesList.map((_, i) => `SUM(CASE WHEN country_code = ?${i + 1} THEN 1 ELSE 0 END) as c${i}`).join(', ');

    // Use simpler approach: query all operations grouped by date+country, then pivot in JS
    const raw = db.prepare(`
      SELECT date(created_at) as date, country_code as country, COUNT(*) as count
      FROM operations
      WHERE country_code IN (${topCountriesList.map(() => '?').join(',')})
        AND created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at), country_code
      ORDER BY date(created_at) ASC
    `).all(...topCountriesList, days) as Array<{ date: string; country: string; count: number }>;

    // Pivot to { date, CH: 34, DE: 28, ... }
    const dateMap = new Map<string, Record<string, number | string>>();
    for (const row of raw) {
      if (!dateMap.has(row.date)) {
        const entry: Record<string, number | string> = { date: row.date };
        for (const c of topCountriesList) entry[c] = 0;
        dateMap.set(row.date, entry);
      }
      dateMap.get(row.date)![row.country] = row.count;
    }
    geoTrend = Array.from(dateMap.values());
  }

  return {
    endpoint_share_trend: endpointTrend,
    geo_trend: geoTrend,
    top_countries_list: topCountriesList,
  };
}
```

- [ ] **Step 5: Build and verify**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run build`
Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/lib/stats.ts src/types.ts
git commit -m "feat(stats): add query functions for hourly, error, and pattern stats"
```

---

## Task 4: Backend — Add new route endpoints

**Files:**
- Modify: `src/routes/stats.ts`

- [ ] **Step 1: Add 3 new endpoints**

Import the new functions and add routes after the existing `/stats/history` route:

```typescript
import { getStats, getStatsHistory, getHourlyStats, getErrorStats, getPatternStats } from '../lib/stats.js';
```

Add these routes inside the stats Hono instance:

```typescript
stats.get('/stats/hourly', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 7;
    if (isNaN(days)) days = 7;
    days = Math.max(1, Math.min(90, days));
    return c.json(getHourlyStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/errors', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json(getErrorStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});

stats.get('/stats/patterns', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Stats require authentication.' }, 403);
  }
  try {
    const periodParam = c.req.query('period');
    let days = periodParam ? parseInt(periodParam, 10) : 30;
    if (isNaN(days)) days = 30;
    days = Math.max(1, Math.min(90, days));
    return c.json(getPatternStats(days));
  } catch {
    return c.json({ error: 'stats_unavailable' }, 500);
  }
});
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Run existing tests**

Run: `cd /Users/claude-alainmartin/ibanforge && npm test`
Expected: All 14+ tests pass (existing tests should not break).

- [ ] **Step 4: Commit and push backend**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/routes/stats.ts
git commit -m "feat(stats): add /stats/hourly, /stats/errors, /stats/patterns endpoints"
git push
```

---

## Task 5: Frontend — i18n translations

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`
- Modify: `frontend/messages/de.json`

- [ ] **Step 1: Add new dashboard keys to en.json**

Add inside the `"dashboard"` object, after the existing `"monitoring"` section:

```json
"topNav": {
  "overview": "Overview",
  "analytics": "Analytics",
  "quality": "Quality",
  "monitoring": "Monitoring",
  "backToSite": "Back to site"
},
"analytics": {
  "title": "Analytics",
  "subtitle": "Usage patterns and trends",
  "heatmap": {
    "title": "Hourly activity",
    "subtitle": "Calls per hour and day of week",
    "noData": "No hourly data available",
    "days": {
      "mon": "Mon",
      "tue": "Tue",
      "wed": "Wed",
      "thu": "Thu",
      "fri": "Fri",
      "sat": "Sat",
      "sun": "Sun"
    }
  },
  "peak": {
    "title": "Peak activity",
    "hours": "Peak hours: {start}h–{end}h",
    "days": "Busiest days: {days}",
    "weekendDrop": "Weekend drop: -{pct}%"
  },
  "geoTrend": {
    "title": "Geographic trend",
    "subtitle": "Top 5 countries over time"
  },
  "endpointTrend": {
    "title": "Endpoint share",
    "subtitle": "Usage distribution over time"
  }
},
"quality": {
  "title": "Quality",
  "subtitle": "Request quality and error analysis",
  "errorRate": {
    "ibanValidate": "IBAN error rate",
    "bicLookup": "BIC miss rate",
    "totalErrors": "Total errors"
  },
  "topInvalidIbans": {
    "title": "Top invalid IBANs",
    "prefix": "Prefix",
    "country": "Country",
    "count": "Count",
    "noData": "No invalid IBAN data"
  },
  "topMissingBics": {
    "title": "Top missing BICs",
    "bic": "BIC code",
    "country": "Country",
    "count": "Searches",
    "noData": "No missing BIC data"
  },
  "errorsByCountry": {
    "title": "Errors by country",
    "noData": "No error data"
  },
  "successTrend": {
    "title": "Success rate trend"
  }
}
```

Also update the `"sidebar"` section (rename to keep backward compat but add new keys):

```json
"sidebar": {
  "label": "Navigation",
  "overview": "Overview",
  "analytics": "Analytics",
  "quality": "Quality",
  "apiStats": "API Stats",
  "monitoring": "Monitoring"
}
```

- [ ] **Step 2: Add same keys to fr.json**

Same structure with French translations:

```json
"topNav": {
  "overview": "Vue d'ensemble",
  "analytics": "Analytics",
  "quality": "Qualité",
  "monitoring": "Monitoring",
  "backToSite": "Retour au site"
},
"analytics": {
  "title": "Analytics",
  "subtitle": "Patterns d'usage et tendances",
  "heatmap": {
    "title": "Activité horaire",
    "subtitle": "Appels par heure et jour de la semaine",
    "noData": "Aucune donnée horaire disponible",
    "days": {
      "mon": "Lun",
      "tue": "Mar",
      "wed": "Mer",
      "thu": "Jeu",
      "fri": "Ven",
      "sat": "Sam",
      "sun": "Dim"
    }
  },
  "peak": {
    "title": "Pic d'activité",
    "hours": "Heures de pointe : {start}h–{end}h",
    "days": "Jours les plus actifs : {days}",
    "weekendDrop": "Baisse weekend : -{pct}%"
  },
  "geoTrend": {
    "title": "Tendance géographique",
    "subtitle": "Top 5 pays dans le temps"
  },
  "endpointTrend": {
    "title": "Répartition endpoints",
    "subtitle": "Distribution d'usage dans le temps"
  }
},
"quality": {
  "title": "Qualité",
  "subtitle": "Qualité des requêtes et analyse des erreurs",
  "errorRate": {
    "ibanValidate": "Taux d'erreur IBAN",
    "bicLookup": "Taux BIC introuvables",
    "totalErrors": "Total erreurs"
  },
  "topInvalidIbans": {
    "title": "Top IBANs invalides",
    "prefix": "Préfixe",
    "country": "Pays",
    "count": "Nombre",
    "noData": "Aucun IBAN invalide"
  },
  "topMissingBics": {
    "title": "Top BICs introuvables",
    "bic": "Code BIC",
    "country": "Pays",
    "count": "Recherches",
    "noData": "Aucun BIC manquant"
  },
  "errorsByCountry": {
    "title": "Erreurs par pays",
    "noData": "Aucune donnée d'erreur"
  },
  "successTrend": {
    "title": "Tendance taux de succès"
  }
}
```

- [ ] **Step 3: Add same keys to de.json**

Same structure with German translations:

```json
"topNav": {
  "overview": "Übersicht",
  "analytics": "Analytik",
  "quality": "Qualität",
  "monitoring": "Monitoring",
  "backToSite": "Zurück zur Seite"
},
"analytics": {
  "title": "Analytik",
  "subtitle": "Nutzungsmuster und Trends",
  "heatmap": {
    "title": "Stündliche Aktivität",
    "subtitle": "Aufrufe nach Stunde und Wochentag",
    "noData": "Keine stündlichen Daten verfügbar",
    "days": {
      "mon": "Mo",
      "tue": "Di",
      "wed": "Mi",
      "thu": "Do",
      "fri": "Fr",
      "sat": "Sa",
      "sun": "So"
    }
  },
  "peak": {
    "title": "Spitzenaktivität",
    "hours": "Spitzenzeiten: {start}h–{end}h",
    "days": "Aktivste Tage: {days}",
    "weekendDrop": "Wochenend-Rückgang: -{pct}%"
  },
  "geoTrend": {
    "title": "Geografischer Trend",
    "subtitle": "Top 5 Länder im Zeitverlauf"
  },
  "endpointTrend": {
    "title": "Endpoint-Verteilung",
    "subtitle": "Nutzungsverteilung im Zeitverlauf"
  }
},
"quality": {
  "title": "Qualität",
  "subtitle": "Anfragequalität und Fehleranalyse",
  "errorRate": {
    "ibanValidate": "IBAN-Fehlerrate",
    "bicLookup": "BIC-Fehlrate",
    "totalErrors": "Gesamtfehler"
  },
  "topInvalidIbans": {
    "title": "Häufigste ungültige IBANs",
    "prefix": "Präfix",
    "country": "Land",
    "count": "Anzahl",
    "noData": "Keine ungültigen IBAN-Daten"
  },
  "topMissingBics": {
    "title": "Häufigste fehlende BICs",
    "bic": "BIC-Code",
    "country": "Land",
    "count": "Suchen",
    "noData": "Keine fehlenden BIC-Daten"
  },
  "errorsByCountry": {
    "title": "Fehler nach Land",
    "noData": "Keine Fehlerdaten"
  },
  "successTrend": {
    "title": "Erfolgsraten-Trend"
  }
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add messages/en.json messages/fr.json messages/de.json
git commit -m "feat(i18n): add analytics and quality dashboard translations (en/fr/de)"
```

---

## Task 6: Frontend — TopNav component

**Files:**
- Create: `frontend/components/dashboard/top-nav.tsx`

- [ ] **Step 1: Create TopNav component**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';

interface NavItem {
  href: string;
  label: string;
  exact: boolean;
}

export function TopNav({ period }: { period?: number }) {
  const pathname = usePathname();
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const NAV_ITEMS: NavItem[] = [
    { href: `/${locale}/dashboard`, label: t('topNav.overview'), exact: true },
    { href: `/${locale}/dashboard/analytics`, label: t('topNav.analytics'), exact: false },
    { href: `/${locale}/dashboard/quality`, label: t('topNav.quality'), exact: false },
    { href: `/${locale}/dashboard/monitoring`, label: t('topNav.monitoring'), exact: false },
  ];

  function isActive(href: string, exact: boolean): boolean {
    if (exact) return pathname === href || pathname === `/${locale}/dashboard`;
    return pathname.startsWith(href);
  }

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Logo + nav */}
        <div className="flex items-center gap-6">
          <Link href={`/${locale}/dashboard`} className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="text-amber-400 font-bold text-xs">IF</span>
            </div>
            <span className="text-sm font-semibold text-white tracking-wide hidden sm:inline">IBANforge</span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                    active
                      ? 'text-white bg-zinc-800 border-b-2 border-amber-500'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side: period selector + back link */}
        <div className="flex items-center gap-3">
          {period !== undefined && <PeriodPills current={period} />}
          <Link
            href={`/${locale}`}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition hidden md:inline"
          >
            {t('topNav.backToSite')} →
          </Link>
        </div>
      </div>
    </div>
  );
}

function PeriodPills({ current }: { current: number }) {
  const pathname = usePathname();

  const PERIODS = [
    { label: '7d', value: 7 },
    { label: '30d', value: 30 },
    { label: '90d', value: 90 },
  ];

  return (
    <div className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
      {PERIODS.map(({ label, value }) => (
        <Link
          key={value}
          href={`${pathname}?period=${value}`}
          className={[
            'rounded-md px-3 py-1 text-xs font-medium transition-all',
            current === value
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              : 'text-zinc-500 hover:text-zinc-300',
          ].join(' ')}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add components/dashboard/top-nav.tsx
git commit -m "feat(dashboard): add TopNav component with horizontal tabs and period selector"
```

---

## Task 7: Frontend — StatCardV2 component

**Files:**
- Create: `frontend/components/dashboard/stat-card-v2.tsx`

- [ ] **Step 1: Create StatCardV2 with sparkline**

```tsx
interface StatCardV2Props {
  title: string;
  value: string;
  trend?: { direction: 'up' | 'down' | 'neutral'; label: string };
  sparkline?: number[];
  accentColor?: string; // hex color for sparkline, default amber
}

function Sparkline({ data, color = '#f59e0b' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 80;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-6" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StatCardV2({ title, value, trend, sparkline, accentColor = '#f59e0b' }: StatCardV2Props) {
  const trendColor =
    trend?.direction === 'up' ? 'text-green-400 bg-green-500/10' :
    trend?.direction === 'down' ? 'text-red-400 bg-red-500/10' :
    'text-zinc-400 bg-zinc-500/10';

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-4 hover:border-zinc-700/60 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{title}</p>
        {trend && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${trendColor}`}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '–'} {trend.label}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold font-mono text-white">{value}</p>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} color={accentColor} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add components/dashboard/stat-card-v2.tsx
git commit -m "feat(dashboard): add StatCardV2 component with gradient and sparkline"
```

---

## Task 8: Frontend — Heatmap, ErrorTable, ProgressBars components

**Files:**
- Create: `frontend/components/dashboard/heatmap.tsx`
- Create: `frontend/components/dashboard/error-table.tsx`
- Create: `frontend/components/dashboard/progress-bars.tsx`

- [ ] **Step 1: Create Heatmap component**

```tsx
'use client';

import { useTranslations } from 'next-intl';

interface HeatmapEntry {
  day: number;
  hour: number;
  total: number;
}

interface HeatmapProps {
  data: HeatmapEntry[];
}

export function Heatmap({ data }: HeatmapProps) {
  const t = useTranslations('dashboard.analytics.heatmap');
  const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const dayLabels = dayKeys.map(k => t(`days.${k}`));

  const max = data.length > 0 ? Math.max(...data.map(d => d.total)) : 1;

  // Build a lookup map: `${day}-${hour}` -> total
  const map = new Map<string, number>();
  for (const entry of data) {
    map.set(`${entry.day}-${entry.hour}`, entry.total);
  }

  function cellColor(total: number): string {
    if (total === 0) return 'bg-zinc-800/40';
    const intensity = total / max;
    if (intensity > 0.75) return 'bg-amber-500';
    if (intensity > 0.5) return 'bg-amber-500/70';
    if (intensity > 0.25) return 'bg-amber-500/40';
    return 'bg-amber-500/20';
  }

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
      <p className="text-sm font-medium text-zinc-300 mb-1">{t('title')}</p>
      <p className="text-xs text-zinc-600 mb-4">{t('subtitle')}</p>
      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-zinc-600 text-sm">{t('noData')}</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Hour labels */}
            <div className="flex items-center mb-1 ml-10">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center text-[9px] text-zinc-600 font-mono">
                  {h % 3 === 0 ? `${h}h` : ''}
                </div>
              ))}
            </div>
            {/* Grid rows */}
            {dayLabels.map((label, dayIdx) => (
              <div key={dayIdx} className="flex items-center gap-1 mb-1">
                <span className="w-9 text-[10px] text-zinc-500 font-medium text-right shrink-0">{label}</span>
                <div className="flex gap-[2px] flex-1">
                  {Array.from({ length: 24 }, (_, h) => {
                    const total = map.get(`${dayIdx}-${h}`) ?? 0;
                    return (
                      <div
                        key={h}
                        title={`${label} ${h}h: ${total} calls`}
                        className={`flex-1 h-5 rounded-sm ${cellColor(total)} transition-colors cursor-default hover:ring-1 hover:ring-amber-400/40`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ErrorTable component**

```tsx
interface ErrorTableProps {
  title: string;
  columns: { key: string; label: string; mono?: boolean }[];
  rows: Array<Record<string, string | number>>;
  emptyMessage: string;
}

export function ErrorTable({ title, columns, rows, emptyMessage }: ErrorTableProps) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
      <p className="text-sm font-medium text-zinc-300 mb-4">{title}</p>
      {rows.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-zinc-600 text-sm">{emptyMessage}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/60">
                {columns.map(col => (
                  <th key={col.key} className="text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-600 pb-2 pr-4">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-zinc-800/30 last:border-0">
                  {columns.map(col => (
                    <td key={col.key} className={`py-2 pr-4 text-zinc-300 ${col.mono ? 'font-mono text-xs' : 'text-sm'}`}>
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create ProgressBars component**

```tsx
interface ProgressBarItem {
  label: string;
  value: number;
  color: string;
  total: number;
}

interface ProgressBarsProps {
  items: ProgressBarItem[];
}

export function ProgressBars({ items }: ProgressBarsProps) {
  const grandTotal = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = grandTotal > 0 ? (item.value / grandTotal) * 100 : 0;
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-sm text-zinc-300">{item.label}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-mono text-zinc-400">{item.value.toLocaleString()}</span>
                <span className="font-mono text-zinc-600 w-12 text-right">{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-800/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: item.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add components/dashboard/heatmap.tsx components/dashboard/error-table.tsx components/dashboard/progress-bars.tsx
git commit -m "feat(dashboard): add Heatmap, ErrorTable, and ProgressBars components"
```

---

## Task 9: Frontend — New dashboard layout

**Files:**
- Rewrite: `frontend/app/[locale]/dashboard/(protected)/layout.tsx`

- [ ] **Step 1: Replace sidebar layout with top-nav layout**

Replace the entire file:

```tsx
import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { TopNav } from '@/components/dashboard/top-nav';
import { LogoutButton } from '@/components/dashboard/logout-button';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <TopNav />
      <main className="px-4 py-6 md:px-8 md:py-8 max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add app/\\[locale\\]/dashboard/\\(protected\\)/layout.tsx
git commit -m "feat(dashboard): replace sidebar layout with top-nav layout"
```

---

## Task 10: Frontend — Redesigned Overview page

**Files:**
- Rewrite: `frontend/app/[locale]/dashboard/(protected)/page.tsx`

- [ ] **Step 1: Rewrite the overview page**

Replace the entire file with the new design using StatCardV2, ProgressBars, and updated line chart:

```tsx
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { LineChart } from '@/components/line-chart';
import { ProgressBars } from '@/components/dashboard/progress-bars';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

interface StatsResponse {
  total_operations: number;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  total_revenue_usdc: number;
  top_countries: Array<{ country: string; count: number }>;
  bic_database_entries: number;
}

interface HistoryEntry {
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
}

async function fetchStats(): Promise<StatsResponse | null> {
  try {
    const res = await fetch(`${API_URL}/stats`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function fetchHistory(): Promise<HistoryEntry[]> {
  try {
    const res = await fetch(`${API_URL}/stats/history?period=30`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const [stats, history] = await Promise.all([fetchStats(), fetchHistory()]);

  if (!stats) {
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-8 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <p className="text-zinc-300 font-medium">{t('error.apiUnavailable')}</p>
          <p className="text-sm text-zinc-500 mt-1">{t('error.apiUnavailableDescription')}</p>
        </div>
      </div>
    );
  }

  // Today's calls
  const todayCalls = history.length > 0
    ? (history[history.length - 1].iban_validate ?? 0) + (history[history.length - 1].iban_batch ?? 0) + (history[history.length - 1].bic_lookup ?? 0)
    : 0;
  const yesterdayCalls = history.length > 1
    ? (history[history.length - 2].iban_validate ?? 0) + (history[history.length - 2].iban_batch ?? 0) + (history[history.length - 2].bic_lookup ?? 0)
    : 0;

  const callsTrend = yesterdayCalls === 0
    ? { direction: 'neutral' as const, label: '' }
    : todayCalls > yesterdayCalls
      ? { direction: 'up' as const, label: `${Math.round(((todayCalls - yesterdayCalls) / yesterdayCalls) * 100)}%` }
      : todayCalls < yesterdayCalls
        ? { direction: 'down' as const, label: `${Math.round(((yesterdayCalls - todayCalls) / yesterdayCalls) * 100)}%` }
        : { direction: 'neutral' as const, label: '0%' };

  // Sparklines from last 7 days of history
  const last7 = history.slice(-7);
  const callsSparkline = last7.map(d => (d.iban_validate ?? 0) + (d.iban_batch ?? 0) + (d.bic_lookup ?? 0));
  const revenueSparkline = last7.map(d => d.revenue_usdc ?? 0);

  // Success rate (weighted across all endpoints)
  const totalOps = stats.by_type.iban_validate.total + stats.by_type.iban_batch.total + stats.by_type.bic_lookup.total;
  const totalSuccess = stats.by_type.iban_validate.valid_count + stats.by_type.iban_batch.valid_count + stats.by_type.bic_lookup.found_count;
  const successRate = totalOps > 0 ? Math.round((totalSuccess / totalOps) * 1000) / 10 : 100;

  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: t('chart.legends.ibanValidate') },
    { key: 'iban_batch', color: '#3b82f6', label: t('chart.legends.ibanBatch') },
    { key: 'bic_lookup', color: '#22c55e', label: t('chart.legends.bicLookup') },
  ];

  const progressItems = [
    { label: t('chart.legends.ibanValidate'), value: stats.by_type.iban_validate.total, color: '#f59e0b', total: totalOps },
    { label: t('chart.legends.ibanBatch'), value: stats.by_type.iban_batch.total, color: '#3b82f6', total: totalOps },
    { label: t('chart.legends.bicLookup'), value: stats.by_type.bic_lookup.total, color: '#22c55e', total: totalOps },
  ];

  const topCountries = (stats.top_countries ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">{t('header.title')}</h1>
      </div>

      {/* 3 stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCardV2
          title={t('stats.today')}
          value={todayCalls.toLocaleString(locale)}
          trend={callsTrend.label ? callsTrend : undefined}
          sparkline={callsSparkline}
          accentColor="#f59e0b"
        />
        <StatCardV2
          title={t('stats.totalRevenue')}
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          sparkline={revenueSparkline}
          accentColor="#22c55e"
        />
        <StatCardV2
          title="Success rate"
          value={`${successRate}%`}
          trend={successRate >= 95 ? { direction: 'up', label: 'healthy' } : { direction: 'down', label: 'degraded' }}
          accentColor="#22c55e"
        />
      </div>

      {/* Line chart */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-300">{t('chart.apiCalls30d')}</p>
        {history.length > 0 ? (
          <LineChart data={history} lines={lineConfig} />
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-600 text-sm">{t('chart.noHistoryData')}</div>
        )}
      </div>

      {/* Two columns: progress bars + top countries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">{t('chart.endpointBreakdown')}</p>
          <ProgressBars items={progressItems} />
        </div>
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">{t('chart.top10Countries')}</p>
          {topCountries.length > 0 ? (
            <div className="space-y-3">
              {topCountries.map((row, i) => (
                <div key={row.country} className="flex items-center gap-3">
                  <span className="w-5 text-xs text-zinc-600 text-right font-mono">{i + 1}</span>
                  <span className="text-sm text-zinc-300 w-6">
                    {t.has(`countries.${row.country}`) ? '' : ''}{row.country}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800/60 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/50" style={{ width: `${(row.count / (topCountries[0]?.count || 1)) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-zinc-500 w-12 text-right">{row.count.toLocaleString(locale)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-zinc-600 text-sm">{t('chart.noCountryData')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add app/\\[locale\\]/dashboard/\\(protected\\)/page.tsx
git commit -m "feat(dashboard): redesign overview page with StatCardV2 and progress bars"
```

---

## Task 11: Frontend — Analytics page

**Files:**
- Create: `frontend/app/[locale]/dashboard/(protected)/analytics/page.tsx`

- [ ] **Step 1: Create the analytics page**

```tsx
import { Heatmap } from '@/components/dashboard/heatmap';
import { LineChart } from '@/components/line-chart';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

async function fetchHourly(period: number) {
  try {
    const res = await fetch(`${API_URL}/stats/hourly?period=${period}`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function fetchPatterns(period: number) {
  try {
    const res = await fetch(`${API_URL}/stats/patterns?period=${period}`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const rawPeriod = parseInt(params.period ?? '30', 10);
  const period = [7, 30, 90].includes(rawPeriod) ? rawPeriod : 30;

  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const [hourly, patterns] = await Promise.all([fetchHourly(period), fetchPatterns(period)]);

  const DAY_NAMES: Record<number, string> = {
    0: t('analytics.heatmap.days.mon'), 1: t('analytics.heatmap.days.tue'),
    2: t('analytics.heatmap.days.wed'), 3: t('analytics.heatmap.days.thu'),
    4: t('analytics.heatmap.days.fri'), 5: t('analytics.heatmap.days.sat'),
    6: t('analytics.heatmap.days.sun'),
  };

  const endpointLineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: 'IBAN validate' },
    { key: 'iban_batch', color: '#3b82f6', label: 'IBAN batch' },
    { key: 'bic_lookup', color: '#22c55e', label: 'BIC lookup' },
  ];

  const geoLineConfig = (patterns?.top_countries_list ?? []).map((country: string, i: number) => {
    const colors = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ef4444'];
    return { key: country, color: colors[i % colors.length], label: country };
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">{t('analytics.title')}</h1>
        <p className="text-sm text-zinc-500 mt-1">{t('analytics.subtitle')}</p>
      </div>

      {/* Heatmap */}
      <Heatmap data={hourly?.heatmap ?? []} />

      {/* Peak info */}
      {hourly?.peak_hours && (
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-medium text-zinc-300 mb-3">{t('analytics.peak.title')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-mono font-bold text-amber-400">{hourly.peak_hours.start}h–{hourly.peak_hours.end}h</p>
              <p className="text-xs text-zinc-500 mt-1">{t('analytics.peak.hours', { start: hourly.peak_hours.start, end: hourly.peak_hours.end })}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-mono font-bold text-white">
                {hourly.peak_hours.days.map((d: number) => DAY_NAMES[d]).join(', ')}
              </p>
              <p className="text-xs text-zinc-500 mt-1">{t('analytics.peak.days', { days: hourly.peak_hours.days.map((d: number) => DAY_NAMES[d]).join(', ') })}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-mono font-bold text-red-400">-{hourly.weekend_drop_pct}%</p>
              <p className="text-xs text-zinc-500 mt-1">{t('analytics.peak.weekendDrop', { pct: hourly.weekend_drop_pct })}</p>
            </div>
          </div>
        </div>
      )}

      {/* Two charts: endpoint trend + geo trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-medium text-zinc-300 mb-1">{t('analytics.endpointTrend.title')}</p>
          <p className="text-xs text-zinc-600 mb-4">{t('analytics.endpointTrend.subtitle')}</p>
          {patterns?.endpoint_share_trend?.length > 0 ? (
            <LineChart data={patterns.endpoint_share_trend} lines={endpointLineConfig} />
          ) : (
            <div className="flex h-48 items-center justify-center text-zinc-600 text-sm">{t('chart.noData')}</div>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-medium text-zinc-300 mb-1">{t('analytics.geoTrend.title')}</p>
          <p className="text-xs text-zinc-600 mb-4">{t('analytics.geoTrend.subtitle')}</p>
          {patterns?.geo_trend?.length > 0 && geoLineConfig.length > 0 ? (
            <LineChart data={patterns.geo_trend} lines={geoLineConfig} />
          ) : (
            <div className="flex h-48 items-center justify-center text-zinc-600 text-sm">{t('chart.noData')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add app/\\[locale\\]/dashboard/\\(protected\\)/analytics/page.tsx
git commit -m "feat(dashboard): add Analytics page with heatmap and trend charts"
```

---

## Task 12: Frontend — Quality page

**Files:**
- Create: `frontend/app/[locale]/dashboard/(protected)/quality/page.tsx`

- [ ] **Step 1: Create the quality page**

```tsx
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { ErrorTable } from '@/components/dashboard/error-table';
import { LineChart } from '@/components/line-chart';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

async function fetchErrors(period: number) {
  try {
    const res = await fetch(`${API_URL}/stats/errors?period=${period}`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function fetchHistory(period: number) {
  try {
    const res = await fetch(`${API_URL}/stats/history?period=${period}`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const rawPeriod = parseInt(params.period ?? '30', 10);
  const period = [7, 30, 90].includes(rawPeriod) ? rawPeriod : 30;

  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const [errors, history] = await Promise.all([fetchErrors(period), fetchHistory(period)]);

  const ibanColumns = [
    { key: 'prefix', label: t('quality.topInvalidIbans.prefix'), mono: true },
    { key: 'country', label: t('quality.topInvalidIbans.country') },
    { key: 'count', label: t('quality.topInvalidIbans.count'), mono: true },
  ];

  const bicColumns = [
    { key: 'bic', label: t('quality.topMissingBics.bic'), mono: true },
    { key: 'country', label: t('quality.topMissingBics.country') },
    { key: 'count', label: t('quality.topMissingBics.count'), mono: true },
  ];

  const totalErrors = (errors?.top_invalid_ibans ?? []).reduce((s: number, r: { count: number }) => s + r.count, 0) +
    (errors?.top_missing_bics ?? []).reduce((s: number, r: { count: number }) => s + r.count, 0);

  // Errors by country as horizontal bars
  const errorsByCountry = errors?.errors_by_country ?? [];
  const maxCountryErrors = errorsByCountry.length > 0 ? errorsByCountry[0].count : 1;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">{t('quality.title')}</h1>
        <p className="text-sm text-zinc-500 mt-1">{t('quality.subtitle')}</p>
      </div>

      {/* 3 stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCardV2
          title={t('quality.errorRate.ibanValidate')}
          value={`${errors?.error_rate?.iban_validate?.rate ?? 0}%`}
          sparkline={errors?.error_rate?.iban_validate?.trend}
          accentColor="#ef4444"
        />
        <StatCardV2
          title={t('quality.errorRate.bicLookup')}
          value={`${errors?.error_rate?.bic_lookup?.rate ?? 0}%`}
          sparkline={errors?.error_rate?.bic_lookup?.trend}
          accentColor="#eab308"
        />
        <StatCardV2
          title={t('quality.errorRate.totalErrors')}
          value={totalErrors.toLocaleString(locale)}
          accentColor="#ef4444"
        />
      </div>

      {/* Two tables: invalid IBANs + missing BICs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ErrorTable
          title={t('quality.topInvalidIbans.title')}
          columns={ibanColumns}
          rows={errors?.top_invalid_ibans ?? []}
          emptyMessage={t('quality.topInvalidIbans.noData')}
        />
        <ErrorTable
          title={t('quality.topMissingBics.title')}
          columns={bicColumns}
          rows={errors?.top_missing_bics ?? []}
          emptyMessage={t('quality.topMissingBics.noData')}
        />
      </div>

      {/* Errors by country */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        <p className="text-sm font-medium text-zinc-300 mb-4">{t('quality.errorsByCountry.title')}</p>
        {errorsByCountry.length > 0 ? (
          <div className="space-y-2">
            {errorsByCountry.map((row: { country: string; count: number }) => (
              <div key={row.country} className="flex items-center gap-3">
                <span className="text-sm text-zinc-400 w-8">{row.country}</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-800/60 overflow-hidden">
                  <div className="h-full rounded-full bg-red-500/60" style={{ width: `${(row.count / maxCountryErrors) * 100}%` }} />
                </div>
                <span className="text-xs font-mono text-zinc-500 w-12 text-right">{row.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-zinc-600 text-sm">{t('quality.errorsByCountry.noData')}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add app/\\[locale\\]/dashboard/\\(protected\\)/quality/page.tsx
git commit -m "feat(dashboard): add Quality page with error analysis and BIC miss tracking"
```

---

## Task 13: Frontend — Restyle Monitoring page

**Files:**
- Modify: `frontend/app/[locale]/dashboard/(protected)/monitoring/page.tsx`

- [ ] **Step 1: Update monitoring page styling**

The monitoring page keeps its existing functionality (client-side auto-refresh, localStorage uptime). Update only the visual wrapper elements:
- Replace `bg-zinc-900 border border-zinc-800` with `bg-gradient-to-br from-zinc-900 to-zinc-900/60 border border-zinc-800/60`
- Replace `rounded-xl border border-zinc-800 bg-zinc-900` stat cards with same gradient pattern
- The page structure, logic, and data fetching remain identical

Changes are CSS-only: replace all `border-zinc-800` with `border-zinc-800/60` and all `bg-zinc-900` with `bg-gradient-to-br from-zinc-900 to-zinc-900/60` on card containers.

- [ ] **Step 2: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add app/\\[locale\\]/dashboard/\\(protected\\)/monitoring/page.tsx
git commit -m "style(dashboard): restyle monitoring page to match new design system"
```

---

## Task 14: Frontend — Cleanup old components

**Files:**
- Delete: `frontend/components/dashboard/sidebar-nav.tsx`
- Delete: `frontend/components/dashboard/dashboard-header.tsx`
- Delete: `frontend/components/dashboard/quick-actions.tsx`
- Delete: `frontend/components/donut-chart.tsx`
- Delete: `frontend/components/stat-card.tsx`
- Delete: `frontend/app/[locale]/dashboard/(protected)/api-stats/` (entire directory)

- [ ] **Step 1: Delete old files**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
rm components/dashboard/sidebar-nav.tsx
rm components/dashboard/dashboard-header.tsx
rm components/dashboard/quick-actions.tsx
rm components/donut-chart.tsx
rm components/stat-card.tsx
rm -rf app/\\[locale\\]/dashboard/\\(protected\\)/api-stats/
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/claude-alainmartin/ibanforge/frontend && npm run build`
Expected: Clean build. If any imports reference deleted files, fix them.

- [ ] **Step 3: Commit**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git add -A
git commit -m "chore(dashboard): remove old sidebar, donut chart, stat card, api-stats page"
```

---

## Task 15: Build, verify, push

- [ ] **Step 1: Build backend**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run build`
Expected: Clean compilation.

- [ ] **Step 2: Run backend tests**

Run: `cd /Users/claude-alainmartin/ibanforge && npm test`
Expected: All tests pass.

- [ ] **Step 3: Build frontend**

Run: `cd /Users/claude-alainmartin/ibanforge/frontend && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Push backend**

```bash
cd /Users/claude-alainmartin/ibanforge
git push
```

- [ ] **Step 5: Push frontend**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
git push
```
