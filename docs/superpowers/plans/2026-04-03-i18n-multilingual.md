# i18n Multilingual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic multilingual support (EN/FR/DE) to the IBANforge frontend with sub-path routing, browser detection, and manual language switch.

**Architecture:** next-intl with `[locale]` segment in App Router. Middleware detects `Accept-Language` and redirects. UI strings in `messages/*.json`, MDX content in `content/{locale}/`. Fallback to EN when translation is missing.

**Tech Stack:** next-intl, Next.js 16 App Router, gray-matter, next-mdx-remote

---

## File Structure

### New files to create
```
frontend/
  i18n/
    routing.ts              # Locale config (en, fr, de)
    request.ts              # getRequestConfig — loads messages
  middleware.ts             # Locale detection + redirect
  messages/
    en.json                 # English UI strings (~200 keys)
    fr.json                 # French UI strings
    de.json                 # German UI strings
  content/
    en/docs/*.mdx           # English docs (migrated from content/docs/)
    en/blog/*.mdx           # English blog (migrated from content/blog/)
    fr/docs/*.mdx           # French docs (translated)
    fr/blog/*.mdx           # French blog (translated)
    de/docs/*.mdx           # German docs (translated)
    de/blog/*.mdx           # German blog (translated)
  app/[locale]/             # All pages move here
    layout.tsx
    page.tsx
    ...
  components/
    locale-switcher.tsx     # Language dropdown component
```

### Files to modify
```
frontend/
  next.config.ts            # Add createNextIntlPlugin
  lib/mdx.ts                # Add locale parameter
  lib/blog.ts               # Add locale parameter
  components/site-header.tsx # Add LocaleSwitcher
  app/sitemap.ts            # Generate entries for all locales
  app/robots.ts             # No change needed
```

### Files to delete (moved under [locale])
```
frontend/app/
  page.tsx → app/[locale]/page.tsx
  not-found.tsx → app/[locale]/not-found.tsx
  error.tsx → app/[locale]/error.tsx
  layout.tsx → split: root layout stays, locale layout created
  pricing/ → app/[locale]/pricing/
  compare/ → app/[locale]/compare/
  playground/ → app/[locale]/playground/
  blog/ → app/[locale]/blog/
  docs/ → app/[locale]/docs/
  dashboard/ → app/[locale]/dashboard/
```

---

## Task 1: Install next-intl and create config

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/i18n/routing.ts`
- Create: `frontend/i18n/request.ts`
- Modify: `frontend/next.config.ts`

- [ ] **Step 1: Install next-intl**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
npm install next-intl
```

- [ ] **Step 2: Create i18n/routing.ts**

```typescript
// frontend/i18n/routing.ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'de'],
  defaultLocale: 'en',
});
```

- [ ] **Step 3: Create i18n/request.ts**

```typescript
// frontend/i18n/request.ts
import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 4: Update next.config.ts**

```typescript
// frontend/next.config.ts
import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
export default withNextIntl(nextConfig);
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: install next-intl and create i18n config"
```

---

## Task 2: Create middleware

**Files:**
- Create: `frontend/middleware.ts`

- [ ] **Step 1: Create middleware.ts**

```typescript
// frontend/middleware.ts
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/middleware.ts && git commit -m "feat: add i18n middleware for locale detection"
```

---

## Task 3: Create English messages file

**Files:**
- Create: `frontend/messages/en.json`

- [ ] **Step 1: Create messages/en.json with all extracted UI strings**

Extract every hardcoded string from components and pages into a structured JSON file. Organize by page/component namespace.

The file should contain ~200 keys covering: header, footer, home, pricing, compare, playground, dashboard, docs, blog, common, errors.

Key namespaces:
- `header`: nav links (Docs, Playground, Pricing, Blog, Dashboard, Toggle menu)
- `footer`: column titles, links, tagline, copyright
- `home`: badge, hero title/subtitle, features (6 cards × badge+title+desc), endpoints table, section headings, CTAs
- `pricing`: badge, hero, endpoint descriptions, free tier note, x402 explainer, FAQ (4 Q&A pairs), CTA
- `compare`: badge, hero, feature labels (15 rows), differentiator cards (3), CTA
- `playground`: title, subtitle, tab labels, form labels, buttons
- `dashboard`: stat labels, chart titles, country names, error messages
- `common`: shared buttons, states
- `errors`: 404 page, error page, global error

- [ ] **Step 2: Commit**

```bash
git add frontend/messages/en.json && git commit -m "feat: extract all UI strings into messages/en.json"
```

---

## Task 4: Migrate content directory structure

**Files:**
- Move: `frontend/content/docs/*.mdx` → `frontend/content/en/docs/*.mdx`
- Move: `frontend/content/blog/*.mdx` → `frontend/content/en/blog/*.mdx`

- [ ] **Step 1: Move docs and blog to locale-prefixed directories**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
mkdir -p content/en/docs content/en/blog
mv content/docs/*.mdx content/en/docs/
mv content/blog/*.mdx content/en/blog/
rmdir content/docs content/blog
```

- [ ] **Step 2: Update lib/mdx.ts to accept locale parameter**

```typescript
// frontend/lib/mdx.ts
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
}

function docsDir(locale: string): string {
  return path.join(process.cwd(), 'content', locale, 'docs');
}

export function getAllDocs(locale: string = 'en'): DocMeta[] {
  const dir = docsDir(locale);
  if (!fs.existsSync(dir)) return getAllDocs('en'); // fallback
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'));
  return files
    .map((file) => {
      const slug = file.replace('.mdx', '');
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const { data } = matter(raw);
      return {
        slug,
        title: data.title || slug,
        description: data.description || '',
        order: data.order ?? 99,
      };
    })
    .sort((a, b) => a.order - b.order);
}

export function getDoc(slug: string, locale: string = 'en'): { meta: DocMeta; content: string } {
  const dir = docsDir(locale);
  const file = path.join(dir, `${slug}.mdx`);

  // Fallback to EN if file doesn't exist in requested locale
  if (!fs.existsSync(file) && locale !== 'en') {
    return getDoc(slug, 'en');
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const { data, content } = matter(raw);
  return {
    meta: {
      slug,
      title: data.title || slug,
      description: data.description || '',
      order: data.order ?? 99,
    },
    content,
  };
}
```

- [ ] **Step 3: Update lib/blog.ts to accept locale parameter**

```typescript
// frontend/lib/blog.ts
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  readingTime: string;
}

function blogDir(locale: string): string {
  return path.join(process.cwd(), 'content', locale, 'blog');
}

export function getAllPosts(locale: string = 'en'): BlogPost[] {
  const dir = blogDir(locale);
  if (!fs.existsSync(dir)) return getAllPosts('en'); // fallback
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'));
  return files
    .map((file) => {
      const slug = file.replace('.mdx', '');
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const { data, content } = matter(raw);
      const words = content.split(/\s+/).length;
      const readingTime = `${Math.ceil(words / 200)} min read`;
      return { slug, title: data.title, description: data.description || '', date: data.date, readingTime };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getPost(slug: string, locale: string = 'en'): { meta: BlogPost; content: string } {
  const dir = blogDir(locale);
  const file = path.join(dir, `${slug}.mdx`);

  // Fallback to EN if file doesn't exist in requested locale
  if (!fs.existsSync(file) && locale !== 'en') {
    return getPost(slug, 'en');
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const { data, content } = matter(raw);
  const words = content.split(/\s+/).length;
  return {
    meta: {
      slug,
      title: data.title,
      description: data.description || '',
      date: data.date,
      readingTime: `${Math.ceil(words / 200)} min read`,
    },
    content,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: migrate content to locale-prefixed dirs, update mdx/blog loaders"
```

---

## Task 5: Restructure app directory under [locale]

**Files:**
- Split: `app/layout.tsx` → root layout + `app/[locale]/layout.tsx`
- Move: all page dirs under `app/[locale]/`

- [ ] **Step 1: Create app/[locale]/ directory and move all pages**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend
mkdir -p app/\[locale\]

# Move all page directories and files
mv app/page.tsx app/[locale]/
mv app/not-found.tsx app/[locale]/
mv app/error.tsx app/[locale]/
mv app/global-error.tsx app/[locale]/
mv app/pricing app/[locale]/
mv app/compare app/[locale]/
mv app/playground app/[locale]/
mv app/blog app/[locale]/
mv app/docs app/[locale]/
mv app/dashboard app/[locale]/
```

- [ ] **Step 2: Update root layout.tsx (minimal — just html shell)**

The root layout becomes minimal. The locale-specific layout handles providers.

```typescript
// frontend/app/layout.tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "IBANforge", template: "%s | IBANforge" },
  description: "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  metadataBase: new URL("https://ibanforge.com"),
  twitter: {
    card: "summary_large_image",
    title: "IBANforge",
    description: "IBAN validation & BIC/SWIFT lookup API",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
```

- [ ] **Step 3: Create app/[locale]/layout.tsx (locale-aware layout)**

```typescript
// frontend/app/[locale]/layout.tsx
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { ThemeProvider } from "next-themes";
import { routing } from '@/i18n/routing';
import { ConditionalShell } from "@/components/conditional-shell";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebAPI",
  name: "IBANforge",
  description: "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  url: "https://ibanforge.com",
  documentation: "https://ibanforge.com/docs",
  provider: { "@type": "Organization", name: "IBANforge" },
  offers: {
    "@type": "Offer",
    price: "0.003",
    priceCurrency: "USD",
    description: "Pay per call — from $0.003/request",
  },
};

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ogLocale = locale === 'fr' ? 'fr_FR' : locale === 'de' ? 'de_DE' : 'en_US';
  return {
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: `https://ibanforge.com/${locale}`,
      siteName: "IBANforge",
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html
      lang={locale}
      className="font-sans h-full"
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <NextIntlClientProvider>
            <ConditionalShell>{children}</ConditionalShell>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify the build compiles**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: restructure app under [locale] segment with next-intl provider"
```

---

## Task 6: Create LocaleSwitcher component and update header

**Files:**
- Create: `frontend/components/locale-switcher.tsx`
- Modify: `frontend/components/site-header.tsx`

- [ ] **Step 1: Create locale-switcher.tsx**

```typescript
// frontend/components/locale-switcher.tsx
'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { routing } from '@/i18n/routing';

const LABELS: Record<string, string> = {
  en: 'EN',
  fr: 'FR',
  de: 'DE',
};

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(newLocale: string) {
    // Replace current locale prefix in pathname
    const segments = pathname.split('/');
    segments[1] = newLocale;
    router.push(segments.join('/'));
  }

  return (
    <div className="relative group">
      <button
        className="text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
        aria-label="Change language"
      >
        {LABELS[locale]}
      </button>
      <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-zinc-900 border border-border rounded-lg shadow-lg overflow-hidden z-50">
        {routing.locales.map((loc) => (
          <button
            key={loc}
            onClick={() => switchLocale(loc)}
            className={`px-4 py-2 text-xs font-mono text-left hover:bg-zinc-800 transition-colors ${
              loc === locale ? 'text-amber-500 font-semibold' : 'text-muted-foreground'
            }`}
          >
            {LABELS[loc]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update site-header.tsx to use translations and LocaleSwitcher**

Replace hardcoded navLinks with `useTranslations('header')` and add the `<LocaleSwitcher />` next to the Dashboard link.

- [ ] **Step 3: Update site-footer.tsx to use translations**

Replace hardcoded column titles, links, tagline, and copyright with `useTranslations('footer')`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add LocaleSwitcher and translate header/footer"
```

---

## Task 7: Translate all pages to use useTranslations

**Files:**
- Modify: `app/[locale]/page.tsx` (home)
- Modify: `app/[locale]/pricing/page.tsx`
- Modify: `app/[locale]/pricing/calculator.tsx`
- Modify: `app/[locale]/pricing/faq.tsx`
- Modify: `app/[locale]/compare/page.tsx`
- Modify: `app/[locale]/playground/page.tsx`
- Modify: `app/[locale]/not-found.tsx`
- Modify: `app/[locale]/error.tsx`
- Modify: `app/[locale]/blog/page.tsx`
- Modify: `app/[locale]/blog/[slug]/page.tsx`
- Modify: `app/[locale]/docs/page.tsx`
- Modify: `app/[locale]/docs/[slug]/page.tsx`
- Modify: `app/[locale]/dashboard/(protected)/page.tsx`

For each page:
1. Import `useTranslations` from `next-intl` (Server Components) or receive translated strings as props (Client Components)
2. Replace every hardcoded string with `t('key')`
3. For pages with `params`, extract `locale` and pass to `getDoc(slug, locale)` / `getAllPosts(locale)`

- [ ] **Step 1: Update home page (app/[locale]/page.tsx)**

Replace all hardcoded FEATURES, ENDPOINTS arrays, hero text, section headings, and CTAs with `useTranslations('home')` calls.

- [ ] **Step 2: Update pricing pages**

- `pricing/page.tsx`: Replace endpoint descriptions, headings, x402 explainer with `useTranslations('pricing')`
- `pricing/calculator.tsx`: Client component — receive translated labels as props from parent
- `pricing/faq.tsx`: Client component — receive FAQ items as props from parent

- [ ] **Step 3: Update compare page**

Replace feature labels, differentiator cards with `useTranslations('compare')`.

- [ ] **Step 4: Update playground page**

Client component — use `useTranslations('playground')` for tab labels, form labels, buttons.

- [ ] **Step 5: Update blog pages**

- `blog/page.tsx`: Extract locale from params, pass to `getAllPosts(locale)`
- `blog/[slug]/page.tsx`: Extract locale from params, pass to `getPost(slug, locale)`

- [ ] **Step 6: Update docs pages**

- `docs/page.tsx`: Extract locale from params, pass to `getAllDocs(locale)`, `getDoc('index', locale)`
- `docs/[slug]/page.tsx`: Extract locale from params, pass to `getDoc(slug, locale)`

- [ ] **Step 7: Update dashboard page**

Replace hardcoded French strings with `useTranslations('dashboard')`. This consolidates the mixed FR/EN strings into the proper translation system.

- [ ] **Step 8: Update error pages**

- `not-found.tsx`: Use `useTranslations('errors')`
- `error.tsx`: Use `useTranslations('errors')`

- [ ] **Step 9: Verify build**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: translate all pages to use useTranslations"
```

---

## Task 8: Create French translations (messages/fr.json)

**Files:**
- Create: `frontend/messages/fr.json`

- [ ] **Step 1: Translate all ~200 UI string keys to French**

Copy `messages/en.json`, translate every value to French. Guidelines:
- Use formal "vous" (not "tu") for user-facing text
- Keep technical terms in English: IBAN, BIC, SWIFT, SEPA, MCP, x402, USDC, API
- Keep brand name "IBANforge" untranslated
- Keep code snippets/paths untranslated
- "Free during beta" → "Gratuit pendant la beta"
- "Try it free" → "Essayer gratuitement"
- "Read the docs" → "Lire la documentation"

- [ ] **Step 2: Commit**

```bash
git add frontend/messages/fr.json && git commit -m "feat: add French UI translations"
```

---

## Task 9: Create German translations (messages/de.json)

**Files:**
- Create: `frontend/messages/de.json`

- [ ] **Step 1: Translate all ~200 UI string keys to German**

Same guidelines as French. Use formal "Sie" (not "du").
- "Free during beta" → "Kostenlos wahrend der Beta"
- "Try it free" → "Kostenlos testen"
- "Read the docs" → "Dokumentation lesen"

- [ ] **Step 2: Commit**

```bash
git add frontend/messages/de.json && git commit -m "feat: add German UI translations"
```

---

## Task 10: Translate French MDX content (docs + blog)

**Files:**
- Create: `frontend/content/fr/docs/*.mdx` (7 files)
- Create: `frontend/content/fr/blog/*.mdx` (4 files)

- [ ] **Step 1: Create content/fr/docs/ directory and translate all 7 doc files**

For each file in `content/en/docs/`:
1. Copy the English MDX file
2. Translate the frontmatter (title, description) to French
3. Translate all prose text to French
4. Keep code blocks, URLs, API paths, JSON examples unchanged
5. Keep technical terms (IBAN, BIC, SEPA, x402, MCP) unchanged

Files: index.mdx, iban-validate.mdx, iban-batch.mdx, bic-lookup.mdx, x402.mdx, mcp.mdx, errors.mdx

- [ ] **Step 2: Create content/fr/blog/ directory and translate all 4 blog posts**

Same approach. Files:
- 2026-04-01-introducing-ibanforge.mdx
- 2026-04-01-v1-changelog.mdx
- 2026-04-02-validate-iban-api.mdx
- 2026-04-02-iban-validation-use-cases.mdx

- [ ] **Step 3: Commit**

```bash
git add frontend/content/fr/ && git commit -m "feat: add French MDX translations (docs + blog)"
```

---

## Task 11: Translate German MDX content (docs + blog)

**Files:**
- Create: `frontend/content/de/docs/*.mdx` (7 files)
- Create: `frontend/content/de/blog/*.mdx` (4 files)

- [ ] **Step 1: Create content/de/docs/ and translate all 7 doc files to German**

Same approach as French. Use formal German. Keep code/URLs/JSON unchanged.

- [ ] **Step 2: Create content/de/blog/ and translate all 4 blog posts to German**

- [ ] **Step 3: Commit**

```bash
git add frontend/content/de/ && git commit -m "feat: add German MDX translations (docs + blog)"
```

---

## Task 12: Update sitemap and SEO

**Files:**
- Modify: `frontend/app/sitemap.ts`

- [ ] **Step 1: Update sitemap.ts to generate entries for all locales**

```typescript
// frontend/app/sitemap.ts
import { MetadataRoute } from "next";
import { getAllDocs } from "@/lib/mdx";
import { getAllPosts } from "@/lib/blog";
import { routing } from "@/i18n/routing";

const BASE_URL = "https://ibanforge.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const prefix = `${BASE_URL}/${locale}`;

    // Static pages
    entries.push(
      { url: prefix, lastModified: now, changeFrequency: "weekly", priority: 1 },
      { url: `${prefix}/playground`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
      { url: `${prefix}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
      { url: `${prefix}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
      { url: `${prefix}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    );

    // Doc pages
    for (const doc of getAllDocs(locale)) {
      if (doc.slug !== "index") {
        entries.push({
          url: `${prefix}/docs/${doc.slug}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.7,
        });
      }
    }

    // Blog posts
    for (const post of getAllPosts(locale)) {
      entries.push({
        url: `${prefix}/blog/${post.slug}`,
        lastModified: new Date(post.date),
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  }

  return entries;
}
```

- [ ] **Step 2: Verify sitemap generates correct entries**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend && npm run build
# Check .next/server/app/sitemap.xml for all 3 locales
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: update sitemap for multi-locale SEO"
```

---

## Task 13: Final verification and push

- [ ] **Step 1: Full build**

```bash
cd /Users/claude-alainmartin/ibanforge/frontend && npm run build
```

- [ ] **Step 2: Manual smoke test — verify all 3 locales**

```bash
npm run dev
# Check:
# - http://localhost:3000 → redirects to /en (or /fr based on browser)
# - http://localhost:3000/en → English home
# - http://localhost:3000/fr → French home
# - http://localhost:3000/de → German home
# - http://localhost:3000/fr/docs → French docs
# - http://localhost:3000/de/blog → German blog
# - Language switcher works
# - Fallback works (if a DE doc is missing, shows EN)
```

- [ ] **Step 3: Push to deploy**

```bash
git push origin main
```

---

## Summary

| Task | Description | Estimated complexity |
|------|-------------|---------------------|
| 1 | Install next-intl + config | Small |
| 2 | Middleware | Small |
| 3 | Extract EN messages | Medium |
| 4 | Migrate content dirs + update loaders | Medium |
| 5 | Restructure app under [locale] | Large |
| 6 | LocaleSwitcher + header/footer | Medium |
| 7 | Translate all pages (useTranslations) | Large |
| 8 | French messages (fr.json) | Medium |
| 9 | German messages (de.json) | Medium |
| 10 | French MDX (11 files) | Large |
| 11 | German MDX (11 files) | Large |
| 12 | Sitemap + SEO | Small |
| 13 | Verification + push | Small |
