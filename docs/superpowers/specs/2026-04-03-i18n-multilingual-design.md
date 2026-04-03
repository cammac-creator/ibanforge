# IBANforge — Multilingual i18n Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Scope:** Frontend only (API responses stay in English)

---

## Goal

Add automatic multilingual support to the IBANforge frontend. Three languages: English (default), French, German. Auto-detect browser language, allow manual switch, translate all UI + docs + blogs.

## Languages

| Code | Language | Role |
|------|----------|------|
| `en` | English | Default, source of truth |
| `fr` | French | Swiss/EU market |
| `de` | German | Swiss/DACH market |

## Architecture

### Library

**next-intl** — standard i18n library for Next.js App Router. Provides:
- Middleware for locale detection and routing
- Server Component support (no client bundle for translations)
- Message formatting (plurals, interpolation)
- TypeScript-safe message keys

### Routing Strategy

Sub-path routing with locale prefix on all pages:

```
/en/pricing    /fr/pricing    /de/pricing
/en/docs       /fr/docs       /de/docs
/en/blog       /fr/blog       /de/blog
```

- `localePrefix: 'always'` — no page served without a locale prefix
- `GET /` → 301 redirect to `/{detected-locale}`
- `GET /pricing` → 301 redirect to `/{detected-locale}/pricing`
- API routes (`/api/*`) are NOT affected

### Middleware

```
middleware.ts (frontend root)
```

- Reads `Accept-Language` header for auto-detection
- Persists manual choice in `NEXT_LOCALE` cookie
- Matcher excludes: `/api`, `/_next`, static files (`.*\..*`)

### App Directory Structure

```
app/
  [locale]/
    layout.tsx            ← NextIntlClientProvider wraps all pages
    page.tsx              ← Home
    pricing/
      page.tsx
      calculator.tsx
      faq.tsx
    compare/page.tsx
    playground/page.tsx
    blog/
      page.tsx
      [slug]/page.tsx
    docs/
      page.tsx
      [slug]/page.tsx
    dashboard/
      login/page.tsx
      (protected)/
        page.tsx
        api-stats/page.tsx
        monitoring/page.tsx
    not-found.tsx
    error.tsx
  api/                    ← stays outside [locale]
    playground/route.ts
    auth/login/route.ts
    auth/logout/route.ts
  globals.css
  robots.ts
  sitemap.ts              ← generates entries for all locales
  opengraph-image.tsx
```

## Translation Files

### UI Strings (~200 keys)

```
messages/
  en.json     ← source of truth
  fr.json
  de.json
```

Organized by namespace:
- `header` — nav links
- `footer` — column titles, links
- `home` — hero, features, endpoints, CTA
- `pricing` — table, calculator labels, FAQ, x402 explainer
- `compare` — feature labels, differentiators
- `playground` — form labels, buttons
- `dashboard` — stats labels, chart titles, country names
- `common` — shared strings (buttons, states)

### MDX Content (docs + blogs)

```
content/
  en/
    docs/       ← 7 files (migrated from content/docs/)
    blog/       ← 4 files (migrated from content/blog/)
  fr/
    docs/       ← 7 files (translated)
    blog/       ← 4 files (translated)
  de/
    docs/       ← 7 files (translated)
    blog/       ← 4 files (translated)
```

- `content/en/` = source of truth (existing files migrated here)
- `lib/mdx.ts` updated: `getDoc(slug, locale)` reads from `content/{locale}/docs/`
- `lib/blog.ts` updated: `getAllPosts(locale)` reads from `content/{locale}/blog/`
- **Fallback:** if a file doesn't exist in the requested locale, serve `en` version
- Frontmatter (title, description) is translated in each locale's MDX file

## Language Switcher

- Dropdown in `site-header.tsx`, right side
- Displays current locale code: `EN`, `FR`, `DE`
- On change: navigates to same page in new locale
- Sets `NEXT_LOCALE` cookie for persistence
- No flags — text codes only (neutral for Swiss market)

## SEO

- Each locale gets its own URLs → indexed separately by search engines
- `<link rel="alternate" hreflang="fr" href="/fr/..." />` on all pages
- `sitemap.ts` generates entries for all 3 locales
- OpenGraph `locale` field set dynamically per page
- Metadata (title, description) translated via next-intl

## What Does NOT Change

- **Backend API** — all responses stay in English
- **MCP tools** — descriptions stay in English
- **OpenAPI spec** — English only
- **x402 protocol** — English only
- **Marketing materials** (docs/marketing/) — English only (used for external platforms)
- **CLAUDE.md** — English (code language convention)

## Translation Approach

- UI strings: written by Claude during implementation
- MDX content: translated by Claude during implementation
- Quality: professional-grade, not machine-translation style
- Dashboard French strings: migrated into the translation system (currently hardcoded)

## Estimated Scope

| Item | Count |
|------|-------|
| UI string keys | ~200 |
| MDX files to translate | 11 × 2 locales = 22 files |
| MDX lines to translate | ~1,500 × 2 = ~3,000 lines |
| Pages to restructure | 12 (move under [locale]) |
| Components to update | ~8 (extract hardcoded strings) |
| New files | middleware.ts, messages/*.json, i18n config |
