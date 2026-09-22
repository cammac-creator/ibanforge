import Link from "next/link"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"
import { routing } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { GetKeyButton } from "@/components/api-key-dialog"
import { Reveal } from "@/components/reveal"
import { StatsBar } from "@/components/stats-bar"
import { LensHero, type LensCopy } from "@/components/lens/lens-hero"
import { LensGallery, type GalleryCopy } from "@/components/lens/lens-gallery"
import "@/components/lens/lens.css"
import {
  getLandingStats,
  P50_PROCESSING_MS,
  SUPPORTED_COUNTRIES,
} from "@/lib/landing-stats"
import { alternatesFor, urlFor } from "@/lib/seo"
import { localePath } from "@/lib/locale-path"

// Title and description are generated per-locale by app/[locale]/layout.tsx —
// do NOT define a static `metadata` here, it would override the locale-aware
// version with the EN default. `alternates` cannot live in the layout though
// (WEB-01/WEB-02, audit 2026-09-01): only the page itself knows its own path,
// so the home declares its canonical + hreflang set here.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  return { alternates: alternatesFor(locale, "/") }
}

/**
 * Rendered once per locale and refreshed every hour by the CDN (audit
 * 2026-09-05, n° 1): the figures of /health and /stats/history change by
 * the day at most, and the fold's real call happens in the browser anyway.
 */
export const revalidate = 3600

const FEATURE_COUNT = 6
const ENDPOINT_COUNT = 7

/* Chaque intégration pointe vers son paquet ou son code disponible.
   Le SDK .NET est disponible sur NuGet. */
const INTEGRATIONS = [
  { key: 'ts', cmd: 'npm install @ibanforge/sdk', href: 'https://www.npmjs.com/package/@ibanforge/sdk' },
  { key: 'py', cmd: 'pip install ibanforge', href: 'https://pypi.org/project/ibanforge/' },
  { key: 'java', cmd: 'com.ibanforge:ibanforge-sdk', href: 'https://central.sonatype.com/artifact/com.ibanforge/ibanforge-sdk' },
  { key: 'dotnet', cmd: 'dotnet add package IBANforge.Sdk', href: 'https://www.nuget.org/packages/IBANforge.Sdk' },
  { key: 'mcp', cmd: 'npx -y ibanforge-mcp', href: 'https://www.npmjs.com/package/ibanforge-mcp' },
  { key: 'n8n', cmd: 'npm install n8n-nodes-ibanforge', href: 'https://www.npmjs.com/package/n8n-nodes-ibanforge' },
  { key: 'odoo', cmd: 'ibanforge_bank_autofill', href: 'https://github.com/cammac-creator/ibanforge/tree/main/integrations/odoo' },
  { key: 'sheets', cmd: '=IBAN_CONTROLE(A2)', href: '/sheets' },
  { key: 'postman', cmd: 'ibanforge.postman_collection.json', href: 'https://github.com/cammac-creator/ibanforge/tree/main/integrations/postman' },
] as const

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // The home is the one page a bogus first segment lands on: `/icon-512.png`
  // for a file that does not exist is routed here with locale "icon-512.png".
  // The locale layout refuses it with notFound(), but Next renders layout and
  // page concurrently, and `new Intl.NumberFormat("icon-512.png")` below throws
  // RangeError before the layout's refusal lands — a 500 where a 404 is owed
  // (measured 2026-09-05 live, 2026-09-06 under `next start` once the layout
  // stopped hiding it behind dynamicParams = false). Same guard, this side.
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)
  const t = await getTranslations('home');
  const verdict = await getTranslations('playground');
  const liveStats = await getLandingStats();

  // One figure for the BIC base, the live one: the plaque used to say
  // "121 000+" 350 px away from the band's live "121 773" (audit 2026-09-04, S5).
  // The narrow no-break space Intl emits for fr/de is ~3 px at 17 px in Inter:
  // "121773" to the eye. A regular no-break space keeps the group readable.
  const nf = new Intl.NumberFormat(locale)
  const grouped = (n: number) => nf.format(n).replace(/\u202f/g, '\u00a0')
  const figures = {
    bic: grouped(liveStats.bicEntries),
    bicK: `${Math.floor(liveStats.bicEntries / 1000)}K`,
    ch: grouped(liveStats.chClearingEntries),
    countries: String(SUPPORTED_COUNTRIES),
  }
  const FEATURES = Array.from({ length: FEATURE_COUNT }, (_, i) => ({
    badge: t(`features.${i}.badge`, figures),
    title: t(`features.${i}.title`),
    description: t(`features.${i}.description`, figures),
  }))
  // The refresh date /health already reports and the page used to throw away:
  // "refreshed monthly" becomes a dated fact, never typed by hand (S4).
  //
  // 🚨 The day counter that used to stand here was REMOVED on 22/09/2026, on
  // Claude-Alain's decision. It counted down to 14.11.2026 to the day, and
  // three different November dates are in circulation for the same change
  // (14, 20 and 21); Swift deferred its own November changes on 27.08.2026 and
  // the EPC postponed on 09.09.2026. A countdown is a precision claim, and
  // this one asserted a day nobody can settle — the surest way to be caught
  // wrong on the page that has to be trusted. The band now says "end of
  // November 2026" and keeps the three dated facts below it.
  const refreshedOn = liveStats.bicDataLastUpdated
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${liveStats.bicDataLastUpdated}T00:00:00Z`))
    : null

  const ENDPOINTS = Array.from({ length: ENDPOINT_COUNT }, (_, i) => ({
    method: t(`endpoints.${i}.method`),
    path: t(`endpoints.${i}.path`),
    cost: t(`endpoints.${i}.cost`),
    description: t(`endpoints.${i}.description`),
  }))

  const STATS = [
    { value: liveStats.bicEntries, label: t('stats.bic') },
    { value: SUPPORTED_COUNTRIES, label: t('stats.countries') },
    { value: liveStats.chClearingEntries, label: t('stats.clearing') },
    { value: P50_PROCESSING_MS, label: t('stats.latency'), decimals: 1, suffix: 'ms' },
  ]

  const quoteTr = t('reviewed.quoteTranslation')

  return (
    <div className="forge lens-landing" data-landing="lens-v1">
      <LensHero copy={t.raw('lens.hero') as LensCopy} verdictCopy={verdict.raw('verdict') as LensCopy}
        playgroundHref={localePath(locale, '/playground')} auditHref={localePath(locale, '/audit')} />

      {/* ── Trust band: sources, sanctions lists, Swiss provenance ────────── */}
      {/* Audit 2026-09-04 (M6): the only honest "logo band" this product has
          is its registers; it used to arrive at 88 % of the page. */}
      <section className="trust-band" aria-label={t('trust.ariaLabel')}>
        <div className="wrap trust-grid">
          <div className="trust-cell">
            <span className="eyebrow">{t('trust.dataLabel')}</span>
            <p className="trust-v">
              {/* nbsp inside names and before each dot: lines only break after a separator */}
              {t('trust.dataValue')
                .split(' · ')
                .map((source) => source.replace(/ /g, ' '))
                .join(' · ')}
            </p>
            <span className="trust-n">
              {refreshedOn ? t('trust.dataNoteDated', { date: refreshedOn }) : t('trust.dataNote')}
            </span>
          </div>
          <div className="trust-cell">
            <span className="eyebrow">{t('trust.sanctionsLabel')}</span>
            <p className="trust-v">{t('trust.sanctionsValue')}</p>
            <span className="trust-n">{t('trust.sanctionsNote')}</span>
          </div>
          <div className="trust-cell">
            <span className="eyebrow">{t('trust.madeLabel')}</span>
            <p className="trust-v"><span className="swiss-sq" aria-hidden="true"></span>{t('trust.madeValue')}</p>
            <span className="trust-n">{t('trust.madeNote')}</span>
          </div>
          <div className="trust-cell">
            <span className="eyebrow">{t('trust.privacyLabel')}</span>
            <p className="trust-v">{t('trust.privacyValue')}</p>
            <Link href={localePath(locale, '/legal/dpa')} className="trust-n" style={{ textDecoration: 'underline', textUnderlineOffset: 4 }}>
              {t('trust.privacyNote')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Sourced stats, counting up on scroll ─────────────────────────── */}
      <section className="stats-band">
        <StatsBar stats={STATS} locale={locale} />
      </section>

      <LensGallery copy={t.raw('lens.gallery') as GalleryCopy} locale={locale} />

      {/* ── What a mod-97 check will never tell you: the plaques ───────────── */}
      <section className="sect" aria-labelledby="h-features">
        <div className="wrap">
          <h2 className="sect-h" id="h-features">{t('features.heading')}</h2>
          <div className="plaques">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.badge} delay={i * 60} className="plaque">
                <span className="plaque-badge">{feature.badge}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── The dated trigger: end of November 2026 (audit 2026-09-04, M3) ────
          It was the seventh line of the endpoint list, at 80 % of the page.
          The dates below are the ones our own doc and the 2026-09-02 post cite,
          source by source; Swift's suspension of 27 August 2026 is named. The
          band names a MONTH, not a day — see the note beside `refreshedOn`. */}
      <section className="deadline" aria-labelledby="h-deadline">
        <div className="wrap deadline-grid">
          <div>
            <span className="eyebrow">{t('deadline.eyebrow')}</span>
            {/* Audit 2026-09-05 (n° 17): the "why now" needed an anchor for
                the eye. It is a month, not a running day count — the anchor
                stays, the false precision does not. */}
            <p className="deadline-days">
              <b>{t('deadline.window')}</b>
              <span>{t('deadline.windowLabel')}</span>
            </p>
            <h2 className="sect-h sect-h-left" id="h-deadline">{t('deadline.heading')}</h2>
          </div>
          <div>
            <ul className="deadline-lines">
              <li>{t('deadline.line1')}</li>
              <li>{t('deadline.line2')}</li>
              <li>{t('deadline.line3')}</li>
            </ul>
            <p className="deadline-text">{t('deadline.text')}</p>
            <div className="hero-cta">
              <Button size="lg" variant="amber" className="px-6" nativeButton={false} render={<Link href={localePath(locale, '/docs/structured-addresses')} data-evt="cta:rules" />}>
                {t('deadline.cta')}
              </Button>
              <Link href={localePath(locale, '/audit')} className="btn-ghost-link" data-evt="cta:audit-deadline">
                {t('audit.cta')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── The non-developer door, right after the deadline it answers
          (02/09/2026; moved up on 2026-09-05, audit n° 20) ── */}
      <section className="sect audit-door" aria-labelledby="h-audit">
        <div className="wrap">
          <h2 className="sect-h" id="h-audit">{t('audit.heading')}</h2>
          <p className="sect-sub">{t('audit.text')}</p>
          {/* Audit 2026-09-04 (M4): the only CHF price and the only no-code
              offer of the page were announced by a negation and a ghost
              button. A full button, centred like the section. */}
          <div className="hero-cta hero-cta-center" style={{ marginTop: '1.4rem' }}>
            <Button size="lg" variant="amber" className="px-8" nativeButton={false} render={<Link href={localePath(locale, '/audit')} data-evt="cta:audit" />}>
              {t('audit.cta')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Endpoints, price-stamped ──────────────────────────────────────── */}
      <section className="sect" aria-labelledby="h-endpoints" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 className="sect-h" id="h-endpoints">{t('endpoints.heading')}</h2>
          <p className="sect-sub">{t('endpoints.subtitle')}</p>
          <div className="ep-list">
            {ENDPOINTS.map((endpoint, i) => (
              <Reveal key={endpoint.path} delay={i * 50} className="ep">
                <span className={`ep-m ${endpoint.method === 'GET' ? 'get' : 'post'}`}>{endpoint.method}</span>
                <span className="ep-p">{endpoint.path}</span>
                <span className="ep-d">{endpoint.description}</span>
                <span className="ep-cost">{endpoint.cost}</span>
              </Reveal>
            ))}
          </div>
          {/* The subscription, the only recurring line, was absent from the
              home (audit 2026-09-05, n° 15): one line, every plan, one link. */}
          <p className="ep-plans">
            {t('endpoints.plans')}{' '}
            <Link href={localePath(locale, '/pricing')} data-evt="cta:pricing">{t('endpoints.plansLink')}</Link>
          </p>
        </div>
      </section>

      {/* ── Integrations: the distribution, visible (audit 2026-09-04, M5) ── */}
      <section className="sect integrations" aria-labelledby="h-integrations">
        <div className="wrap">
          <h2 className="sect-h" id="h-integrations">{t('integrations.heading')}</h2>
          <p className="sect-sub">{t('integrations.sub')}</p>
          <ul className="integ-grid">
            {INTEGRATIONS.map((item) => {
              const external = item.href.startsWith('http')
              const href = external ? item.href : localePath(locale, `${item.href}`)
              return (
                <li key={item.key} className="integ">
                  <a
                    href={href}
                    className="integ-link"
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span className="integ-name">{t(`integrations.items.${item.key}`)}</span>
                    <code className="integ-cmd">{item.cmd}</code>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      {/* ── Agents get their own rail ─────────────────────────────────────── */}
      <section className="agents-rail sect" aria-labelledby="h-agents">
        <div className="wrap">
          <h2 className="sect-h" id="h-agents">{t('agentsRail.heading')}</h2>
          <p className="sect-sub">{t('agentsRail.sub')}</p>
          <div className="agent-grid">
            <Reveal className="agent-card">
              <h3>{t('agentsRail.mcpTitle')}</h3>
              <p>{t('agentsRail.mcpBody')}</p>
              <p className="agent-code">npx -y ibanforge-mcp</p>
            </Reveal>
            <Reveal delay={60} className="agent-card">
              <h3>{t('agentsRail.x402Title')}</h3>
              <p>{t('agentsRail.x402Body')}</p>
              <p className="agent-code">402 → pay → 200 OK</p>
            </Reveal>
            <Reveal delay={120} className="agent-card">
              <h3>{t('agentsRail.docsTitle')}</h3>
              <p>{t('agentsRail.docsBody')}</p>
              <p className="agent-code"><a className="agent-link" href="https://ibanforge.com/llms.txt">GET /llms.txt</a></p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Independently reviewed ────────────────────────────────────────── */}
      <section className="reviewed" aria-labelledby="h-reviewed">
        <div className="wrap">
          <span className="eyebrow" id="h-reviewed">{t('reviewed.label')}</span>
          <blockquote>“{t('reviewed.quote')}”</blockquote>
          {quoteTr && <p className="ctx quote-tr">{quoteTr}</p>}
          <p className="ctx">{t('reviewed.context')}</p>
          <p className="links">
            <a href="https://github.com/api-search/inbox/issues/3" target="_blank" rel="noopener noreferrer">
              {t('reviewed.linkReview')}
            </a>
            <Link href={localePath(locale, '/blog/2026-08-11-graded-by-a-catalog-that-never-read-us')}>
              {t('reviewed.linkStory')}
            </Link>
          </p>
        </div>
      </section>

      {/* Un dernier reflet de verre accompagne l’appel à l’action. */}
      <section className="cta-final" aria-labelledby="h-cta">
        <div className="wrap">
          <h2 id="h-cta">{t('cta.heading')}</h2>
          <p>{t('cta.description')}</p>
          {/* Audit 2026-09-05 (n° 7): centred like the heading above it. */}
          <div className="hero-cta hero-cta-center">
            <GetKeyButton variant="amber" className="px-8" evt="cta:key-final">
              {t('cta.getKeyButton')}
            </GetKeyButton>
            <Button
              size="lg"
              variant="outline"
              className="px-8"
              nativeButton={false}
              render={<Link href={localePath(locale, '/docs')} data-evt="cta:docs" />}
            >
              {t('cta.button')}
            </Button>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // Audit 2026-09-04 (S11): this block used to describe a second,
          // unrelated "IBANforge" next to the layout's SoftwareApplication,
          // in hard English on /fr and /de, with a root URL that answers 307.
          // One graph now: ids relate the entities, URLs carry the locale.
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebAPI",
            "@id": `${urlFor(locale)}#api`,
            name: "IBANforge",
            url: urlFor(locale),
            inLanguage: locale,
            description: t('metadata.description'),
            documentation: urlFor(locale, '/docs'),
            termsOfService: urlFor(locale, '/legal'),
            provider: { "@id": "https://ibanforge.com/#organization" },
            isPartOf: { "@id": "https://ibanforge.com/#software" },
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
              description: "Free tier — 200 requests per month",
            },
          }),
        }}
      />
    </div>
  )
}
