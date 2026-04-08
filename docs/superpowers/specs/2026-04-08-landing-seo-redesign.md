# Landing Page Redesign + SEO — Design Spec

**Date:** 2026-04-08
**Scope:** Light refresh of the Hono HTML landing page at `api.ibanforge.com` + full SEO implementation
**Approach:** Keep existing Hono HTML architecture, add missing sections and SEO metadata
**File:** `src/routes/landing.ts`

## Goals

1. Add complete SEO metadata (meta tags, OG, Twitter Card, JSON-LD, cache headers)
2. Restructure sections for dev-first funnel (hero → try it → features → pricing → quick start)
3. Surface compliance/risk scoring and MCP (currently invisible on landing)
4. Update stats (121K BICs, 75+ countries, 4 MCP tools)
5. Show both pricing paths clearly (free API key vs x402)

## Non-goals

- No migration to Next.js (keep Hono HTML)
- No changes to the `frontend/` Next.js app
- No new API endpoints
- No changes to existing endpoint behavior

---

## Section 1: Head / SEO

### Meta tags

```html
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IBANforge — IBAN Validation & BIC Lookup API for Developers & AI Agents</title>
  <meta name="description" content="Validate IBANs, lookup BICs, score compliance risk. 121K BICs, 75+ countries. Free tier or x402 micropayments. MCP native for AI agents.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://api.ibanforge.com">
```

### Open Graph

```html
  <meta property="og:title" content="IBANforge — IBAN Validation & BIC Lookup API">
  <meta property="og:description" content="Compliance-grade IBAN intelligence. 121K BICs, sanctions screening, risk scoring. Free tier + x402 micropayments.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://api.ibanforge.com">
  <meta property="og:image" content="https://api.ibanforge.com/og-image.png">
  <meta property="og:site_name" content="IBANforge">
```

### Twitter Card

```html
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="IBANforge — IBAN Validation API">
  <meta name="twitter:description" content="121K BICs. Compliance scoring. MCP native. Free or pay-per-call with USDC.">
  <meta name="twitter:image" content="https://api.ibanforge.com/og-image.png">
```

### JSON-LD (two schemas)

**WebAPI schema:**

```json
{
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "name": "IBANforge",
  "description": "IBAN validation, BIC/SWIFT lookup, and compliance risk scoring API for developers and AI agents",
  "url": "https://api.ibanforge.com",
  "documentation": "https://api.ibanforge.com/openapi.json",
  "provider": {
    "@type": "Organization",
    "name": "IBANforge",
    "url": "https://ibanforge.com"
  },
  "offers": [
    {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Free tier: 200 requests/month with API key"
    },
    {
      "@type": "Offer",
      "price": "0.003",
      "priceCurrency": "USD",
      "description": "Pay per call via x402 USDC on Base L2"
    }
  ]
}
```

**FAQPage schema (for Google rich snippets):**

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is IBANforge?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "IBANforge is a REST API for IBAN validation, BIC/SWIFT lookup, and compliance risk scoring. It covers 75+ countries with 121K BIC entries sourced from GLEIF."
      }
    },
    {
      "@type": "Question",
      "name": "How much does IBANforge cost?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "IBANforge offers a free tier with 200 requests per month using an API key. Beyond that, pay $0.003 to $0.02 per call using USDC micropayments via the x402 protocol. No subscription required."
      }
    },
    {
      "@type": "Question",
      "name": "Can AI agents use IBANforge?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. IBANforge is MCP-native with 4 tools for AI agents: validate_iban, batch_validate_iban, lookup_bic, and compliance_check. Compatible with Claude, GPT, and any MCP client."
      }
    },
    {
      "@type": "Question",
      "name": "What countries does IBANforge support?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "IBANforge supports 75+ countries with full BBAN parsing, SEPA membership detection, Verification of Payee (VoP) status, and country-level risk classification."
      }
    }
  ]
}
```

### Cache headers

Set on the landing page route handler:

```typescript
c.header('Cache-Control', 'public, max-age=3600');
```

---

## Section 2: Hero

**Position:** Top of page, first thing visible.

**Elements:**
- 3 badges: `x402 MICROPAYMENTS`, `MCP NATIVE`, `121K BICs`
- Title: `IBAN` + `forge` (amber)
- Subtitle line 1: "Validate IBANs. Lookup BICs. Score risk."
- Subtitle line 2 (bold): "One API for developers & AI agents."
- Feature line (small, gray): "Compliance-grade validation · Sanctions screening · SEPA & VoP coverage · 75+ countries"
- 3 CTAs:
  - Primary (amber solid): "Try it free ↓" (scroll to demo)
  - Secondary (amber outline): "Get API key — 200 req/mo free" (link to /v1/keys/generate info)
  - Tertiary (gray outline): "curl quickstart" (scroll to quick start)

---

## Section 3: Try it (interactive demo)

**Position:** Immediately after hero. Critical for dev-first funnel.

**Elements:**
- Title: "Try it now"
- Subtitle: "Free, no account required"
- 3 tabs: `IBAN Validate` | `BIC Lookup` | `★ Compliance Check`
  - Compliance tab has a star to highlight it as premium/new
- Input field with placeholder IBAN/BIC depending on tab
- "Validate →" / "Lookup →" / "Check →" button
- Result area: colored JSON with response time badge (e.g., "23ms")
- Valid/invalid status indicator (green checkmark or red X)

**Behavior:** Same as current — vanilla JS fetch to the actual API endpoints. The compliance tab calls `POST /v1/iban/compliance` (using the demo endpoint for free results).

---

## Section 4: Features grid

**Position:** After Try it demo.

**Layout:** 3x2 grid (desktop), 1 column (mobile). Modern style — 1px gap separators, no heavy borders.

**6 cards:**

| # | Icon color | Title | Stat | Description |
|---|-----------|-------|------|-------------|
| 1 | Amber | 121K BICs · 75+ Countries | `121K` | GLEIF-sourced database with LEI enrichment. Full BBAN parsing per country format. |
| 2 | Rose | Compliance & Risk Scoring | — | Sanctions screening (OFAC/EU/UN), FATF status, composite risk score 0–100, issuer classification. |
| 3 | Purple | MCP Native | — | 4 tools for AI agents via Model Context Protocol. Works with Claude, GPT, and any MCP client. |
| 4 | Cyan | x402 Micropayments | — | Pay per call with USDC on Base L2. No subscription, no signup. Machine-to-machine native. |
| 5 | Green | SEPA & VoP Coverage | — | SCT, SDD, SCT_INST reachability check. Verification of Payee participant status per BIC. |
| 6 | Blue | Fast & Developer-friendly | `<30ms` | OpenAPI spec. npm SDK. Batch up to 100 IBANs. Free tier with 200 req/month. |

**Style:** SVG icons (not emojis). Each card has a tinted icon wrapper. Cards with key stats show them as large numbers. Subtle hover effect on each card.

---

## Section 5: Pricing

**Position:** After features.

**Layout:** Two cards side-by-side (desktop), stacked (mobile).

**Card 1 — Free Tier:**
- Badge: "FREE TIER" (green)
- Title: "API Key"
- Price: "200 requests/month — no card required"
- Features: All endpoints, IBAN/BIC/compliance, batch, Bearer auth, usage dashboard
- CTA: "Get free API key" (outline button)

**Card 2 — x402 (highlighted):**
- Badge: "PAY PER CALL" (amber)
- Title: "x402 / USDC"
- Price: "From $0.003/call — no account needed"
- Features: All endpoints, no signup, USDC on Base L2, M2M native, unlimited volume
- CTA: "View x402 docs" (solid amber button)
- Visual emphasis: amber border gradient, subtle amber background tint

**Price table below cards:**

| Endpoint | Price |
|----------|-------|
| POST /v1/iban/validate | $0.005 |
| POST /v1/iban/batch | $0.002/IBAN |
| GET /v1/bic/:code | $0.003 |
| POST /v1/iban/compliance | $0.020 |

---

## Section 6: Quick Start

**Position:** After pricing, before footer.

**Elements:**
- Title: "Up and running in 30 seconds"
- 4 tabs: `cURL` | `JavaScript` | `Python` | `npm SDK`
- Code block with syntax highlighting (colored spans)
- Each tab shows both auth methods (API key + x402) as comments
- MCP callout box: purple icon + "AI Agents? Use MCP" + `npm run mcp` instruction
- Footer links: `/openapi.json`, `/health`, `/v1/demo`, `@ibanforge/sdk`

**Tab content (cURL example):**

```bash
# Validate an IBAN (free with API key)
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ifk_your_key_here" \
  -d '{"iban": "GB29NWBK60161331926819"}'

# Or pay per call with x402 — no key needed
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -H "X-Payment: <x402-payment-header>" \
  -d '{"iban": "DE89370400440532013000"}'
```

---

## Section 7: OG Image

**Route:** `GET /og-image.png`

**Specs:**
- 1200x630px PNG
- Dark background (#09090b)
- IBANforge logo/text in white + amber
- Tagline: "IBAN Validation & BIC Lookup API"
- Key stats: "121K BICs · 75+ Countries · MCP Native"
- Cache header: `Cache-Control: public, max-age=86400`

**Implementation:** Generate statically at build time or serve as a simple SVG-to-PNG using canvas. Keep it simple — no runtime image generation dependency.

---

## Technical Notes

- All changes confined to `src/routes/landing.ts` + new OG image route
- Keep all CSS inline (current pattern)
- Keep vanilla JS for tab switching and demo fetch calls
- The compliance demo tab should call the existing `/v1/demo` endpoint (free) or fetch from a hard-coded example to avoid x402 charges
- Mobile responsive: grids collapse to single column at 640px breakpoint
- Dark theme with amber (#f59e0b) accent — unchanged from current
