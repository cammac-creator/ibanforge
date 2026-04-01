# IBANforge Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ibanforge.com frontend (Next.js) with landing page, playground, API docs, pricing, dashboard, and blog.

**Architecture:** Monorepo — `frontend/` directory alongside existing `src/` (Hono API). Next.js App Router + shadcn/ui + Tailwind. Frontend calls API via fetch. Dashboard protected by simple password auth.

**Tech Stack:** Next.js 15, shadcn/ui, Tailwind CSS, Recharts, MDX, next-themes

**Spec:** `docs/superpowers/specs/2026-04-01-ibanforge-frontend-design.md`

**Port config:** API runs on port 3001 in dev (`npm run dev` in root), Next.js on port 3000 (`npm run dev` in frontend/).

---

## File Structure

```
frontend/
  app/
    layout.tsx              # Root layout — fonts, theme, metadata
    page.tsx                # Landing page
    globals.css             # Tailwind base + custom variables
    playground/
      page.tsx              # Playground page (client component)
    docs/
      layout.tsx            # Docs sidebar layout
      page.tsx              # /docs overview
      [slug]/page.tsx       # Dynamic doc pages from MDX
    pricing/
      page.tsx              # Pricing page
    dashboard/
      layout.tsx            # Dashboard layout + auth guard
      page.tsx              # Dashboard overview (redirect to api-stats)
      login/page.tsx        # Login form
      api-stats/page.tsx    # Stats API charts
      monitoring/page.tsx   # Uptime monitoring
    blog/
      page.tsx              # Blog list
      [slug]/page.tsx       # Blog post
    api/
      playground/route.ts   # Proxy to Hono API (free)
      auth/
        login/route.ts      # POST login
        logout/route.ts     # POST logout
  components/
    ui/                     # shadcn (auto-generated)
    site-header.tsx         # Shared header/nav
    site-footer.tsx         # Shared footer
    code-block.tsx          # Code block with copy button
    json-viewer.tsx         # JSON syntax highlighting
    stat-card.tsx           # Dashboard stat card
    line-chart.tsx          # Recharts line chart wrapper
    donut-chart.tsx         # Recharts pie/donut wrapper
    uptime-bar.tsx          # 30-day uptime bar
  content/
    docs/
      index.mdx             # /docs overview
      iban-validate.mdx      # POST /v1/iban/validate
      iban-batch.mdx         # POST /v1/iban/batch
      bic-lookup.mdx         # GET /v1/bic/:code
      mcp.mdx                # MCP integration
      x402.mdx               # x402 micropayments explained
      errors.mdx             # Error codes
    blog/
      2026-04-01-introducing-ibanforge.mdx
  lib/
    api-client.ts           # Fetch wrapper for Hono API
    auth.ts                 # Cookie-based auth helpers
    mdx.ts                  # MDX file reader + parser
  public/
    favicon.ico
  next.config.ts
  tailwind.config.ts
  tsconfig.json
  package.json
```

---

## Phase 1 — MVP

### Task 1: Bootstrap Next.js + shadcn in frontend/

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx` (temporary "Hello IBANforge")

- [ ] **Step 1: Create frontend directory and init Next.js**

```bash
cd /Users/claude-alainmartin/ibanforge
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --no-turbopack
```

Accept defaults. This creates the full Next.js scaffold.

- [ ] **Step 2: Install shadcn/ui**

```bash
cd frontend
npx shadcn@latest init
```

Choose: New York style, Zinc base color, CSS variables: yes.

- [ ] **Step 3: Install project dependencies**

```bash
npm install recharts next-themes next-mdx-remote gray-matter
npm install -D @types/mdx rehype-pretty-code shiki
```

- [ ] **Step 4: Configure dark theme and amber accent**

Replace `frontend/app/globals.css` with Tailwind config including dark mode defaults and amber/gold accent color in CSS variables. Set `darkMode: 'class'` in tailwind.config.ts.

- [ ] **Step 5: Create root layout with theme provider**

`frontend/app/layout.tsx`:
- Import Inter + JetBrains Mono fonts
- Wrap in ThemeProvider from next-themes (default: dark)
- Add metadata: title "IBANforge", description "IBAN validation & BIC/SWIFT lookup API"
- Include site header and footer components (placeholder for now)

- [ ] **Step 6: Create temporary landing page**

`frontend/app/page.tsx`: Simple page with "IBANforge" title to verify setup works.

- [ ] **Step 7: Verify dev server starts**

```bash
cd frontend && npm run dev
```

Open http://localhost:3000 — should show "IBANforge" in dark theme.

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): bootstrap Next.js + shadcn + dark theme"
git push
```

---

### Task 2: Shared components (header, footer, code-block)

**Files:**
- Create: `frontend/components/site-header.tsx`
- Create: `frontend/components/site-footer.tsx`
- Create: `frontend/components/code-block.tsx`

- [ ] **Step 1: Install shadcn components needed**

```bash
cd frontend
npx shadcn@latest add button card badge tabs input separator navigation-menu
```

- [ ] **Step 2: Create site-header.tsx**

Navigation bar with:
- Logo "IBANforge" (link to /)
- Nav links: Docs, Playground, Pricing, Blog
- "Dashboard" link (right side)
- Mobile hamburger menu
- Use shadcn NavigationMenu

- [ ] **Step 3: Create site-footer.tsx**

Footer with 3 columns:
- Product: Docs, Playground, Pricing
- Developers: GitHub, MCP, API Status
- Legal: MIT License
- Copyright line

- [ ] **Step 4: Create code-block.tsx**

Client component:
- Props: `code: string`, `language: string`
- Displays code in `<pre>` with monospace font
- Copy button (top right) — copies to clipboard
- Visual feedback on copy ("Copied!")

- [ ] **Step 5: Wire header + footer into root layout**

Update `frontend/app/layout.tsx` to include SiteHeader and SiteFooter.

- [ ] **Step 6: Verify navigation renders**

```bash
cd frontend && npm run dev
```

Check header and footer render on http://localhost:3000.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): add header, footer, code-block components"
git push
```

---

### Task 3: Landing page

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Build landing page sections**

`frontend/app/page.tsx` with these sections:

**Hero:**
```tsx
<section>
  <h1>IBANforge</h1>
  <p>IBAN validation & BIC/SWIFT lookup API for developers and AI agents</p>
  <div>
    <Link href="/playground"><Button>Try it free</Button></Link>
    <Link href="/docs"><Button variant="outline">Read the docs</Button></Link>
  </div>
</section>
```

**Features:** 4 cards using shadcn Card:
- "75+ Countries" — IBAN validation with BBAN parsing
- "39,000+ BIC Entries" — GLEIF database with LEI enrichment
- "MCP Integration" — Native AI agent support
- "x402 Micropayments" — Pay per call, no API key needed

**Endpoints table:** 3 rows showing method, path, cost, description.

**Quick start:** Code block with curl example.

**CTA:** "Start building" button linking to /docs.

- [ ] **Step 2: Style with dark theme + amber accent**

Use amber-500/amber-400 for accent colors (CTAs, highlights). Dark backgrounds (zinc-950/zinc-900). Clean typography.

- [ ] **Step 3: Verify landing page**

http://localhost:3000 — all sections visible, responsive on mobile.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(frontend): landing page with hero, features, endpoints, quickstart"
git push
```

---

### Task 4: API client + playground proxy

**Files:**
- Create: `frontend/lib/api-client.ts`
- Create: `frontend/app/api/playground/route.ts`

- [ ] **Step 1: Create API client**

`frontend/lib/api-client.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function apiGet(path: string) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 2: Create playground proxy route**

`frontend/app/api/playground/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
  const { type, value } = await req.json();

  // Rate limit: check X-Forwarded-For, allow 20/min (simple in-memory map)
  // For MVP, skip rate limiting — add later

  let apiPath: string;
  let options: RequestInit;

  if (type === 'iban') {
    apiPath = '/v1/iban/validate';
    options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban: value }),
    };
  } else if (type === 'bic') {
    apiPath = `/v1/bic/${encodeURIComponent(value)}`;
    options = { method: 'GET' };
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const start = Date.now();
  const res = await fetch(`${API_URL}${apiPath}`, options);
  const ms = Date.now() - start;
  const data = await res.json();

  return NextResponse.json({ ...data, _playground_ms: ms });
}
```

Note: This proxy calls the API directly without x402 payment headers. The API needs to allow this — either via a secret header bypass or by calling the demo endpoint. For MVP, we call the real endpoints; since the API runs locally without WALLET_ADDRESS, x402 is disabled in dev mode.

- [ ] **Step 3: Add .env.local for dev**

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
DASHBOARD_PASSWORD=dev123
```

Add `frontend/.env.local` to `frontend/.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/ frontend/app/api/ frontend/.env.local.example
git commit -m "feat(frontend): API client + playground proxy route"
git push
```

---

### Task 5: Playground page

**Files:**
- Create: `frontend/components/json-viewer.tsx`
- Create: `frontend/app/playground/page.tsx`

- [ ] **Step 1: Create JSON viewer component**

`frontend/components/json-viewer.tsx`:
- Client component
- Props: `data: unknown`
- Renders JSON.stringify(data, null, 2) with syntax coloring
- Color amber for keys, green for strings, blue for numbers, gray for null

- [ ] **Step 2: Create playground page**

`frontend/app/playground/page.tsx` (client component — `'use client'`):

- Tab selector: "Validate IBAN" | "Lookup BIC"
- Text input with placeholder (CH93 0076 2011 6238 5295 7 or UBSWCHZH80A)
- "Submit" button
- Loading spinner while fetching
- Result area: JSON viewer + response time badge
- Link to docs: "Want to use this in your code? See the docs →"
- Fetches from `/api/playground` (the proxy route from Task 4)

- [ ] **Step 3: Test playground with local API**

Start API in one terminal: `cd /Users/claude-alainmartin/ibanforge && PORT=3001 npx tsx src/index.ts`
Start frontend in another: `cd frontend && npm run dev`
Test: enter a BIC code in playground, verify JSON response appears.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/json-viewer.tsx frontend/app/playground/
git commit -m "feat(frontend): interactive playground with IBAN/BIC testing"
git push
```

---

### Task 6: MDX docs system + content

**Files:**
- Create: `frontend/lib/mdx.ts`
- Create: `frontend/app/docs/layout.tsx`
- Create: `frontend/app/docs/page.tsx`
- Create: `frontend/app/docs/[slug]/page.tsx`
- Create: `frontend/components/docs/sidebar.tsx`
- Create: `frontend/content/docs/index.mdx`
- Create: `frontend/content/docs/iban-validate.mdx`
- Create: `frontend/content/docs/iban-batch.mdx`
- Create: `frontend/content/docs/bic-lookup.mdx`
- Create: `frontend/content/docs/mcp.mdx`
- Create: `frontend/content/docs/x402.mdx`
- Create: `frontend/content/docs/errors.mdx`

- [ ] **Step 1: Create MDX reader utility**

`frontend/lib/mdx.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const DOCS_DIR = path.join(process.cwd(), 'content/docs');

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
}

export function getAllDocs(): DocMeta[] {
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.mdx'));
  return files.map(file => {
    const slug = file.replace('.mdx', '');
    const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
    const { data } = matter(content);
    return { slug, title: data.title, description: data.description, order: data.order ?? 99 };
  }).sort((a, b) => a.order - b.order);
}

export function getDoc(slug: string): { meta: DocMeta; content: string } {
  const file = path.join(DOCS_DIR, `${slug}.mdx`);
  const raw = fs.readFileSync(file, 'utf-8');
  const { data, content } = matter(raw);
  return {
    meta: { slug, title: data.title, description: data.description, order: data.order ?? 99 },
    content,
  };
}
```

- [ ] **Step 2: Create docs sidebar component**

`frontend/components/docs/sidebar.tsx`:
- Lists all doc pages with titles
- Highlights current page
- Groups: "Getting Started", "Endpoints", "Advanced"

- [ ] **Step 3: Create docs layout with sidebar**

`frontend/app/docs/layout.tsx`:
- Grid: sidebar (250px) + content area
- Responsive: sidebar collapses on mobile

- [ ] **Step 4: Create docs index page**

`frontend/app/docs/page.tsx`: Renders `content/docs/index.mdx`.

- [ ] **Step 5: Create dynamic doc page**

`frontend/app/docs/[slug]/page.tsx`:
- Reads MDX by slug
- Renders with next-mdx-remote
- Generates static params from getAllDocs()

- [ ] **Step 6: Write all 7 MDX doc files**

Each file has frontmatter (title, description, order) and markdown content.

`content/docs/index.mdx` — Overview: what IBANforge does, base URL, auth (x402), quick example.

`content/docs/iban-validate.mdx` — POST /v1/iban/validate: parameters (iban: string), full response schema, 3 code examples (curl, Python, TypeScript), error cases.

`content/docs/iban-batch.mdx` — POST /v1/iban/batch: parameters (ibans: string[], max 10), response schema, examples.

`content/docs/bic-lookup.mdx` — GET /v1/bic/:code: URL param, response schema, examples.

`content/docs/mcp.mdx` — MCP config for Claude Desktop, available tools, example usage.

`content/docs/x402.mdx` — What is x402? How micropayments work. Simple analogy: "like paying a toll on a highway — each call costs a fraction of a cent, paid automatically." Testnet vs mainnet.

`content/docs/errors.mdx` — Error codes table, common issues, troubleshooting.

- [ ] **Step 7: Verify docs render correctly**

http://localhost:3000/docs — sidebar visible, pages navigate, code blocks formatted.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/mdx.ts frontend/app/docs/ frontend/components/docs/ frontend/content/docs/
git commit -m "feat(frontend): docs system with MDX — 7 pages covering all endpoints"
git push
```

---

## Phase 2 — Confiance et conversion

### Task 7: Pricing page

**Files:**
- Create: `frontend/app/pricing/page.tsx`

- [ ] **Step 1: Build pricing page**

Three sections:
1. **Pricing table** — 3 endpoints with cost per call
2. **Cost calculator** — Slider or input: "X calls/month = $Y" (client-side math)
3. **x402 explainer** — "No subscription. No API key. Pay per call with USDC."
4. **FAQ** — 4 questions: "What is x402?", "How do I pay?", "Is there a free tier?", "What about high volume?"

- [ ] **Step 2: Verify page**

http://localhost:3000/pricing — all sections visible, calculator works.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/pricing/
git commit -m "feat(frontend): pricing page with calculator and FAQ"
git push
```

---

## Phase 3 — Dashboard

### Task 8: Add /stats/history endpoint to Hono API

**Files:**
- Create: `frontend/` — nothing here, this is API-side
- Modify: `/Users/claude-alainmartin/ibanforge/src/lib/stats.ts`
- Modify: `/Users/claude-alainmartin/ibanforge/src/routes/stats.ts`

- [ ] **Step 1: Write test for getStatsHistory**

Create `src/lib/stats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
// Test that getStatsHistory returns an array of daily stats
// (This requires a test database — for now, test the SQL logic structure)
```

- [ ] **Step 2: Add getStatsHistory to stats.ts**

In `src/lib/stats.ts`, add:

```typescript
export function getStatsHistory(days: number = 7): Array<{
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
}> {
  const db = getStatsDB();
  const rows = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN operation_type = 'iban_validate' THEN total ELSE 0 END) as iban_validate,
      SUM(CASE WHEN operation_type = 'iban_batch' THEN total ELSE 0 END) as iban_batch,
      SUM(CASE WHEN operation_type = 'bic_lookup' THEN total ELSE 0 END) as bic_lookup,
      SUM(revenue_usdc) as revenue_usdc
    FROM daily_stats
    WHERE date >= date('now', '-' || ? || ' days')
    GROUP BY date
    ORDER BY date ASC
  `).all(days) as Array<{
    date: string;
    iban_validate: number;
    iban_batch: number;
    bic_lookup: number;
    revenue_usdc: number;
  }>;
  return rows;
}
```

- [ ] **Step 3: Add /stats/history route**

In `src/routes/stats.ts`, add a new GET handler:

```typescript
stats.get('/stats/history', (c) => {
  const period = c.req.query('period') || '7d';
  const days = parseInt(period) || 7;
  const clamped = Math.min(Math.max(days, 1), 90);
  return c.json(getStatsHistory(clamped));
});
```

- [ ] **Step 4: Mount the new route in index.ts if not already**

Check `src/index.ts` — the stats route should already be mounted. Just verify `/stats/history` is accessible.

- [ ] **Step 5: Test manually**

```bash
PORT=3001 npx tsx src/index.ts &
curl http://localhost:3001/stats/history?period=30
```

Expected: JSON array (possibly empty if no stats yet).

- [ ] **Step 6: Commit**

```bash
git add src/lib/stats.ts src/routes/stats.ts
git commit -m "feat(api): add /stats/history endpoint for dashboard"
git push
```

---

### Task 9: Dashboard auth (login/logout)

**Files:**
- Create: `frontend/lib/auth.ts`
- Create: `frontend/app/api/auth/login/route.ts`
- Create: `frontend/app/api/auth/logout/route.ts`
- Create: `frontend/app/dashboard/login/page.tsx`
- Create: `frontend/app/dashboard/layout.tsx`

- [ ] **Step 1: Create auth helper**

`frontend/lib/auth.ts`:

```typescript
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'ibanforge_session';
const SESSION_VALUE = 'authenticated';

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value === SESSION_VALUE;
}

export function getSessionCookieConfig() {
  return {
    name: SESSION_COOKIE,
    value: SESSION_VALUE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  };
}
```

- [ ] **Step 2: Create login API route**

`frontend/app/api/auth/login/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieConfig } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  const config = getSessionCookieConfig();
  res.cookies.set(config.name, config.value, config);
  return res;
}
```

- [ ] **Step 3: Create logout API route**

`frontend/app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('ibanforge_session');
  return res;
}
```

- [ ] **Step 4: Create login page**

`frontend/app/dashboard/login/page.tsx` — client component:
- Password input + Submit button
- POST to /api/auth/login
- On success, redirect to /dashboard
- On failure, show error message

- [ ] **Step 5: Create dashboard layout with auth guard**

`frontend/app/dashboard/layout.tsx`:

```typescript
import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r p-4">
        {/* Sidebar: Overview, API Stats, Monitoring, Logout */}
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Verify login flow**

Start frontend, go to /dashboard → redirected to /dashboard/login. Enter password → redirected to /dashboard.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/auth.ts frontend/app/api/auth/ frontend/app/dashboard/
git commit -m "feat(frontend): dashboard auth with simple password login"
git push
```

---

### Task 10: Dashboard — API Stats (volet A)

**Files:**
- Create: `frontend/components/stat-card.tsx`
- Create: `frontend/components/line-chart.tsx`
- Create: `frontend/components/donut-chart.tsx`
- Create: `frontend/app/dashboard/page.tsx`
- Create: `frontend/app/dashboard/api-stats/page.tsx`

- [ ] **Step 1: Create stat-card component**

`frontend/components/stat-card.tsx`:
- Props: `title: string`, `value: string | number`, `subtitle?: string`, `icon?: ReactNode`
- shadcn Card with large value display
- Used for "Today: 142", "This week: 891", "Revenue: $1.78"

- [ ] **Step 2: Create line-chart component**

`frontend/components/line-chart.tsx`:
- Props: `data: Array<{ date: string; [key: string]: number }>`, `lines: Array<{ key: string; color: string }>`
- Recharts LineChart with responsive container
- Dark theme compatible (white text, dark grid)

- [ ] **Step 3: Create donut-chart component**

`frontend/components/donut-chart.tsx`:
- Props: `data: Array<{ name: string; value: number; color: string }>`
- Recharts PieChart (donut variant)
- Shows endpoint distribution

- [ ] **Step 4: Create dashboard overview page**

`frontend/app/dashboard/page.tsx`:
- Fetches from API: `/stats` and `/stats/history?period=30`
- Uses api-client.ts to fetch server-side
- Displays: 3 stat cards (today, week, revenue) + line chart (30 days) + donut chart (endpoint split) + top 10 countries table

- [ ] **Step 5: Create API Stats detail page**

`frontend/app/dashboard/api-stats/page.tsx`:
- Same data but with period selector (7d / 30d / 90d)
- Breakdown by endpoint type
- Success rate per endpoint

- [ ] **Step 6: Verify dashboard renders with real data**

Start API on port 3001, make a few test calls, then check dashboard shows data.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/stat-card.tsx frontend/components/line-chart.tsx frontend/components/donut-chart.tsx frontend/app/dashboard/
git commit -m "feat(frontend): dashboard API stats with charts and stat cards"
git push
```

---

### Task 11: Dashboard — Monitoring (volet C)

**Files:**
- Create: `frontend/components/uptime-bar.tsx`
- Create: `frontend/app/dashboard/monitoring/page.tsx`

- [ ] **Step 1: Create uptime-bar component**

`frontend/components/uptime-bar.tsx`:
- Props: `checks: Array<{ timestamp: string; status: 'up' | 'down'; response_ms: number }>`
- 30 bars (one per day), green = up, red = down
- Hover tooltip: date + response time

- [ ] **Step 2: Create monitoring page**

`frontend/app/dashboard/monitoring/page.tsx` — client component:
- On mount: fetch `/health` from API, display status
- Green/red badge: "API Online" / "API Offline"
- Response time display (ms)
- Auto-refresh every 60 seconds
- Uptime history bar (stored in localStorage for MVP — no backend persistence needed)
- Show API version and uptime from /health response

- [ ] **Step 3: Verify monitoring page**

Start API, go to /dashboard/monitoring — should show green badge and response time.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/uptime-bar.tsx frontend/app/dashboard/monitoring/
git commit -m "feat(frontend): dashboard monitoring with uptime bar and health check"
git push
```

---

## Phase 4 — SEO et contenu

### Task 12: Blog system + first post

**Files:**
- Create: `frontend/lib/blog.ts`
- Create: `frontend/app/blog/page.tsx`
- Create: `frontend/app/blog/[slug]/page.tsx`
- Create: `frontend/content/blog/2026-04-01-introducing-ibanforge.mdx`

- [ ] **Step 1: Create blog reader utility**

`frontend/lib/blog.ts` — same pattern as mdx.ts but reads from `content/blog/`. Returns posts sorted by date desc.

- [ ] **Step 2: Create blog list page**

`frontend/app/blog/page.tsx`:
- Lists all posts: title, date, excerpt
- Links to individual posts

- [ ] **Step 3: Create blog post page**

`frontend/app/blog/[slug]/page.tsx`:
- Renders MDX content
- Shows title, date, reading time
- Back link to blog list

- [ ] **Step 4: Write first blog post**

`content/blog/2026-04-01-introducing-ibanforge.mdx`:
- Title: "Introducing IBANforge"
- Content: What it is, why we built it, key features, how to get started
- ~300 words

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/blog.ts frontend/app/blog/ frontend/content/blog/
git commit -m "feat(frontend): blog system with MDX + first post"
git push
```

---

### Task 13: SEO + metadata + Open Graph

**Files:**
- Modify: `frontend/app/layout.tsx`
- Modify: all page.tsx files (add metadata exports)

- [ ] **Step 1: Add metadata to all pages**

Each page gets a `metadata` export with title, description, and openGraph:

```typescript
export const metadata = {
  title: 'Playground | IBANforge',
  description: 'Test IBAN validation and BIC lookup for free',
  openGraph: { title: 'IBANforge Playground', description: '...' },
};
```

- [ ] **Step 2: Add robots.txt and sitemap**

`frontend/app/robots.ts` and `frontend/app/sitemap.ts` — standard Next.js metadata files.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/
git commit -m "feat(frontend): SEO metadata, Open Graph, robots.txt, sitemap"
git push
```

---

## Phase 5 — Deploiement

### Task 14: Update API for production CORS

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update CORS config in API**

In `src/index.ts`, update CORS to allow the production frontend domain:

```typescript
app.use('*', cors({
  origin: process.env.CORS_ORIGIN || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Payment'],
}));
```

- [ ] **Step 2: Update .env.example**

Add `CORS_ORIGIN=https://ibanforge.com` to `.env.example`.

- [ ] **Step 3: Commit and push**

```bash
git add src/index.ts .env.example
git commit -m "feat(api): configurable CORS origin for production"
git push
```

---

### Task 15: Deploy API to Railway

This task requires manual steps by Alain:

- [ ] **Step 1: Create Railway project**

Go to railway.app → New Project → Deploy from GitHub → select `cammac-creator/ibanforge`

- [ ] **Step 2: Set environment variables**

In Railway dashboard:
- `PORT` = `3000`
- `WALLET_ADDRESS` = `0xD13bD0A4120BA301125290e5cc0c7EFD4CB40a55`
- `FACILITATOR_URL` = (x402 facilitator URL)
- `CORS_ORIGIN` = `https://ibanforge.com`

- [ ] **Step 3: Configure custom domain**

In Railway → Settings → Networking → add `api.ibanforge.com`. Get the CNAME target.

- [ ] **Step 4: Verify health endpoint**

```bash
curl https://api.ibanforge.com/health
```

---

### Task 16: Deploy frontend to Vercel

- [ ] **Step 1: Link to Vercel**

```bash
cd frontend
npx vercel link
```

Or via Vercel dashboard: import `cammac-creator/ibanforge`, set root directory to `frontend/`.

- [ ] **Step 2: Set environment variables in Vercel**

- `NEXT_PUBLIC_API_URL` = `https://api.ibanforge.com`
- `DASHBOARD_PASSWORD` = (chosen password)

- [ ] **Step 3: Deploy**

```bash
npx vercel --prod
```

- [ ] **Step 4: Configure DNS**

Point `ibanforge.com` CNAME to Vercel's cname.vercel-dns.com.
Point `api.ibanforge.com` CNAME to Railway's target.

- [ ] **Step 5: Verify all pages work**

- https://ibanforge.com — landing page
- https://ibanforge.com/playground — playground works
- https://ibanforge.com/docs — docs render
- https://ibanforge.com/dashboard — login then stats visible

- [ ] **Step 6: Commit any deployment config changes**

```bash
git add .
git commit -m "chore: deployment configuration for Vercel + Railway"
git push
```
