# Fix Onboarding Funnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "broken front door" — developers who try the API get a helpful 402 response instead of `{}`, CORS allows local development, and the landing page guides users toward API key signup.

**Architecture:** Three surgical changes: (1) enrich 402 responses with human-readable instructions and API key signup CTA, (2) add `localhost` to CORS origins, (3) reorder landing page CTAs and add inline key generation. No new dependencies. No structural changes.

**Tech Stack:** Hono middleware, TypeScript, vitest

---

### Task 1: Enrich 402 response body

**Problem:** When x402 is enabled and a developer calls the API without an API key or x402 payment, the response is `{}` with HTTP 402. The `payment-required` header contains base64-encoded x402 instructions that no human will read. The developer has no idea what to do and leaves.

**Solution:** Add a middleware that intercepts 402 responses with empty bodies and replaces them with a clear JSON message explaining both options (free API key or x402 payment), while preserving the `payment-required` header for x402 clients.

**Files:**
- Create: `src/middleware/enrich-402.ts`
- Create: `src/middleware/enrich-402.test.ts`
- Modify: `src/index.ts:108-115` (add middleware before apiKey + x402)

- [ ] **Step 1: Write the test file**

```typescript
// src/middleware/enrich-402.test.ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';

describe('enrich402Middleware', () => {
  it('enriches empty 402 responses with helpful body', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    // Simulate x402 returning empty 402
    app.get('/test', (c) => {
      return new Response('{}', {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'payment-required': 'base64-x402-data-here',
        },
      });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.error).toBe('payment_required');
    expect(body.message).toContain('API key');
    expect(body.free_tier).toBeDefined();
    expect(body.free_tier.signup).toContain('/v1/keys/generate');
    expect(body.x402).toBeDefined();
    // payment-required header preserved for x402 clients
    expect(res.headers.get('payment-required')).toBe('base64-x402-data-here');
  });

  it('passes through non-402 responses unchanged', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/test', (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('passes through 402 responses that already have content', async () => {
    const app = new Hono();
    app.use('*', enrich402Middleware());
    app.get('/test', (c) => {
      return c.json({ error: 'custom_402', detail: 'Already has body' }, 402);
    });

    const res = await app.request('/test');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('custom_402');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/middleware/enrich-402.test.ts`
Expected: FAIL — module `./enrich-402.js` not found

- [ ] **Step 3: Write the middleware**

```typescript
// src/middleware/enrich-402.ts
import type { MiddlewareHandler } from 'hono';

export function enrich402Middleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    if (c.res.status !== 402) return;

    const cloned = c.res.clone();
    const text = await cloned.text();

    if (text && text !== '{}') return;

    const body = {
      error: 'payment_required',
      message:
        'Authentication required. Get a free API key (200 req/month) or pay per call via x402.',
      free_tier: {
        description: '200 requests/month — no credit card, no subscription',
        signup: 'POST /v1/keys/generate with body {"email":"you@example.com"}',
        usage: 'Add header: Authorization: Bearer ifk_your_key_here',
      },
      x402: {
        description: 'Pay per call with USDC on Base L2 (machine-to-machine)',
        docs: 'https://x402.org',
      },
      documentation: 'https://ibanforge.com/docs',
    };

    c.res = new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: c.res.headers,
    });
    c.res.headers.set('Content-Type', 'application/json');
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/middleware/enrich-402.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into index.ts**

In `src/index.ts`, add the import and middleware registration. The `enrich402Middleware` must be registered BEFORE `apiKeyMiddleware` and `createX402Middleware` so its post-`next()` code runs AFTER them.

Add import at top of `src/index.ts`:
```typescript
import { enrich402Middleware } from './middleware/enrich-402.js';
```

Add middleware between the pre-validation block and the API key middleware. Replace the section at lines 108-115:

```typescript
// Enrich empty 402 responses with human-readable instructions
app.use('/v1/*', enrich402Middleware());

// Key management routes (free, before x402)
app.route('/', apiKeys);

// API key middleware — checks Bearer ifk_* tokens before x402
app.use('/v1/*', apiKeyMiddleware());

// x402 payment middleware (only on paid routes, skipped if API key valid)
app.use('/v1/*', createX402Middleware());
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/middleware/enrich-402.ts src/middleware/enrich-402.test.ts src/index.ts
git commit -m "fix: return helpful body on 402 instead of empty JSON

Developers calling the API without an API key or x402 payment now
receive a clear JSON response explaining both authentication options
(free API key signup or x402 micropayments) instead of an opaque {}.
The payment-required header is preserved for x402 clients."
```

---

### Task 2: Fix CORS for local development

**Problem:** `CORS_ORIGIN` in production is set to `https://ibanforge.vercel.app`, blocking browser-based API calls from localhost. Developers testing from their frontend get CORS errors.

**Solution:** Always include common localhost origins alongside the configured CORS_ORIGIN.

**Files:**
- Modify: `src/index.ts:33-41` (CORS configuration)

- [ ] **Step 1: Update CORS origin logic**

In `src/index.ts`, replace the CORS configuration block (lines 33-41):

```typescript
const configuredOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use('*', cors({
  origin: (origin) => {
    if (configuredOrigins.includes('*')) return '*';
    if (localhostPattern.test(origin)) return origin;
    return configuredOrigins.includes(origin) ? origin : configuredOrigins[0];
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Payment'],
}));
```

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run`
Expected: All tests still pass

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "fix: allow localhost CORS origins for local development

Developers testing from localhost/127.0.0.1 on any port can now
call the API from browser-based frontends without CORS errors."
```

---

### Task 3: Add inline API key generation to landing page

**Problem:** The landing page has a "Get API key" CTA button, but it links to the pricing section which explains things. There's no one-click key generation. After the demo works, the developer should be able to get a key instantly without leaving the page.

**Solution:** Add an inline email input + "Get key" button in the hero section and in the pricing section that calls `/v1/keys/generate` via fetch and displays the key.

**Files:**
- Modify: `src/routes/landing.ts` (hero CTAs section + pricing section + JS)

- [ ] **Step 1: Add key generation widget CSS**

In `src/routes/landing.ts`, add to the `<style>` block (after line 157, before `@media`):

```css
.keygen{max-width:480px;margin:24px auto 0;display:none}
.keygen.show{display:block}
.keygen-form{display:flex;gap:8px}
.keygen-form input{flex:1;background:#1a1a1a;border:1px solid #27272a;border-radius:8px;padding:12px 16px;color:#fafafa;font-size:14px;outline:none;transition:border-color .15s}
.keygen-form input:focus{border-color:#f59e0b}
.keygen-form input::placeholder{color:#52525b}
.keygen-form button{padding:12px 20px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .15s}
.keygen-form button:hover{background:#16a34a}
.keygen-result{margin-top:12px;padding:16px;background:#22c55e10;border:1px solid #22c55e40;border-radius:10px;display:none;font-size:13px}
.keygen-result.show{display:block}
.keygen-result code{font-family:'SF Mono',Monaco,monospace;color:#22c55e;word-break:break-all;font-size:12px;display:block;margin-top:8px;padding:8px 12px;background:#09090b;border-radius:6px}
.keygen-result .warn{color:#f59e0b;font-size:12px;margin-top:8px}
.keygen-error{color:#ef4444;font-size:13px;margin-top:8px;display:none}
.keygen-error.show{display:block}
```

- [ ] **Step 2: Replace hero CTAs with key generation widget**

Find the hero CTAs in the HTML template (around line 196-199) and replace with:

```html
<div class="hero-ctas">
  <a href="#tryit" class="cta cta-primary">Try it free &darr;</a>
  <button class="cta cta-secondary" onclick="document.querySelector('.keygen').classList.toggle('show')">Get API key &mdash; free</button>
  <a href="#quickstart" class="cta cta-tertiary">curl quickstart</a>
</div>
<div class="keygen">
  <form class="keygen-form" onsubmit="return generateKey(this)">
    <input type="email" name="email" placeholder="your@email.com" required>
    <button type="submit">Get my key</button>
  </form>
  <div class="keygen-result" id="keygenResult">
    <strong>Your API key (save it now):</strong>
    <code id="keygenKey"></code>
    <div class="warn">200 requests/month free. This key will not be shown again.</div>
  </div>
  <div class="keygen-error" id="keygenError"></div>
</div>
```

- [ ] **Step 3: Add key generation JavaScript**

Add at the end of the `<script>` block in the landing page:

```javascript
async function generateKey(form) {
  event.preventDefault();
  const email = form.email.value;
  const errEl = document.getElementById('keygenError');
  const resEl = document.getElementById('keygenResult');
  const keyEl = document.getElementById('keygenKey');
  errEl.classList.remove('show');
  resEl.classList.remove('show');
  try {
    const r = await fetch('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    if (!r.ok) {
      errEl.textContent = d.message || 'Error generating key';
      errEl.classList.add('show');
      return;
    }
    keyEl.textContent = d.api_key;
    resEl.classList.add('show');
    form.email.value = '';
  } catch (e) {
    errEl.textContent = 'Network error. Try again.';
    errEl.classList.add('show');
  }
}
```

- [ ] **Step 4: Run existing landing page tests**

Run: `npx vitest run src/routes/landing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/landing.ts
git commit -m "feat: add inline API key generation to landing page

Developers can now generate a free API key directly from the hero
section without navigating away. Enter email, get key instantly."
```

---

### Task 4: Run full validation and deploy

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Push to deploy**

```bash
git push origin main
```

Railway auto-deploys on push to main.

- [ ] **Step 5: Verify 402 fix in production**

After deploy completes (~2 min), run:

```bash
curl -s -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -d '{"iban":"CH9300762011623852957"}'
```

Expected: HTTP 402 with a JSON body containing `error: "payment_required"`, `free_tier`, `x402`, and `documentation` fields. NOT `{}`.

---

### Task 5: Update roadmap memory

- [ ] **Step 1: Update moat strategy memory**

Update the memory file to reflect new priorities based on the onboarding analysis:
- **Immediate (done today):** Fix 402 body, CORS, landing page key generation
- **Next (this week):** Post Reddit content (already prepared), submit to Smithery/mcpservers.org
- **30 days:** Find first pilot customer via direct outreach (not inbound marketing)
- **90 days:** Add Stripe/traditional payment option alongside x402
- **365 days:** Build social proof (case studies, GitHub stars, testimonials)
