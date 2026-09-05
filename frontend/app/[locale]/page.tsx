import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Button } from "@/components/ui/button"
import { GetKeyButton } from "@/components/api-key-dialog"
import { Reveal } from "@/components/reveal"
import { StatsBar } from "@/components/stats-bar"
import { ForgeFilm, type FilmStrings } from "@/components/forge/forge-film"
import { FoldDemo } from "@/components/forge/fold-demo"
import { DEFAULT_RESULT } from "./playground/examples"
import {
  getLandingStats,
  P50_PROCESSING_MS,
  SUPPORTED_COUNTRIES,
} from "@/lib/landing-stats"
import { alternatesFor, urlFor } from "@/lib/seo"

// Title and description are generated per-locale by app/[locale]/layout.tsx —
// do NOT define a static `metadata` here, it would override the locale-aware
// version with the EN default. `alternates` cannot live in the layout though
// (WEB-01/WEB-02, audit 2026-09-01): only the page itself knows its own path,
// so the home declares its canonical + hreflang set here.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { alternates: alternatesFor(locale, "/") }
}

const FEATURE_COUNT = 6
const ENDPOINT_COUNT = 7

/* The distribution: every package and module that exists today, with the
   command or pointer that installs it. Nothing here is announced ahead of
   itself — .NET says "from source" until NuGet carries it. */
const INTEGRATIONS = [
  { key: 'ts', cmd: 'npm install @ibanforge/sdk', href: 'https://www.npmjs.com/package/@ibanforge/sdk' },
  { key: 'py', cmd: 'pip install ibanforge', href: 'https://pypi.org/project/ibanforge/' },
  { key: 'java', cmd: 'com.ibanforge:ibanforge-sdk', href: 'https://central.sonatype.com/artifact/com.ibanforge/ibanforge-sdk' },
  { key: 'dotnet', cmd: 'IBANforge.Sdk · dotnet pack', href: 'https://github.com/cammac-creator/ibanforge/tree/main/sdks/dotnet' },
  { key: 'mcp', cmd: 'npx -y ibanforge-mcp', href: 'https://www.npmjs.com/package/ibanforge-mcp' },
  { key: 'n8n', cmd: 'npm install n8n-nodes-ibanforge', href: 'https://www.npmjs.com/package/n8n-nodes-ibanforge' },
  { key: 'odoo', cmd: 'ibanforge_bank_autofill', href: 'https://github.com/cammac-creator/ibanforge/tree/main/integrations/odoo' },
  { key: 'sheets', cmd: '=IBANFORGE_VALIDATE(A2)', href: '/sheets' },
  { key: 'postman', cmd: 'ibanforge.postman_collection.json', href: 'https://github.com/cammac-creator/ibanforge/tree/main/integrations/postman' },
] as const

/* The x402 spot illustration: a robotic arm paying its coin into the slot. */
const AGENTS_ILLO = `<defs><radialGradient id="acoin" cx="38%" cy="35%" r="75%"><stop offset="0%" stop-color="#FCD34D"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></radialGradient></defs><rect x="18" y="122" width="128" height="12" rx="3" fill="#292524"/><circle cx="34" cy="128" r="2.5" fill="#57534E"/><circle cx="130" cy="128" r="2.5" fill="#57534E"/><rect x="70" y="66" width="16" height="58" rx="4" fill="#3F3A34"/><path d="M78,70 q-26,18 -8,52" stroke="#292524" stroke-width="3" fill="none"/><g stroke-linecap="round"><line x1="78" y1="70" x2="152" y2="34" stroke="#57534E" stroke-width="13"/><line x1="152" y1="34" x2="230" y2="55" stroke="#44403C" stroke-width="10"/></g><circle cx="78" cy="70" r="8" fill="#292524" stroke="#57534E" stroke-width="2"/><circle cx="152" cy="34" r="8.5" fill="#292524" stroke="#57534E" stroke-width="2"/><circle cx="152" cy="34" r="3" fill="#78716C"/><g stroke="#57534E" stroke-width="5.5" fill="none" stroke-linecap="round"><path d="M230,49 q16,-2 24,8"/><path d="M230,61 q16,4 22,14"/></g><g class="coin"><ellipse cx="258" cy="66" rx="27" ry="21" fill="#F59E0B" opacity="0.13"/><circle cx="258" cy="66" r="13.5" fill="url(#acoin)"/><circle cx="258" cy="66" r="13.5" fill="none" stroke="#FCD34D" stroke-width="1.6" opacity="0.8"/><rect x="254" y="60" width="8" height="12" rx="2" fill="#1C0A00" opacity="0.35"/></g><rect x="288" y="84" width="56" height="50" rx="7" fill="#1C1917" stroke="#292524"/><rect x="288" y="84" width="56" height="8" rx="4" fill="#26211C"/><rect x="299" y="100" width="34" height="6" rx="3" fill="#F59E0B" opacity="0.9"/><rect x="299" y="115" width="12" height="5" rx="1.5" fill="#EF4444" opacity="0.65"/><rect x="315" y="115" width="12" height="5" rx="1.5" fill="#4ADE80" opacity="0.65"/>`

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('home');
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
  // 30-day share of answers without a 5xx, as /status computes it; null when
  // the history is unreachable, and the badge then makes no numeric claim.
  const rate30 = liveStats.successRate30 === null
    ? null
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(liveStats.successRate30)
  // One latency figure for the whole page (audit 2026-09-05, n° 18): the film
  // used to carry "0,41" typed by hand in three languages while the stats
  // band showed the constant. Both now read the same source.
  const msLabel = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(P50_PROCESSING_MS)
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
  const film: FilmStrings = {
    heading: t('film.heading'),
    heat: {
      eyebrow: t('film.heat.eyebrow'), title: t('film.heat.title'), copy: t('film.heat.copy'),
      country: t('film.heat.country'), check: t('film.heat.check'),
      bank: t('film.heat.bank'), account: t('film.heat.account'),
      // What a screen reader gets instead of the split characters (n° 23).
      ibanAria: `IBAN CH10 0023 0000 0000 1234 5 · ${t('film.heat.country')} CH · ${t('film.heat.check')} 10 · ${t('film.heat.bank')} 00230 · ${t('film.heat.account')} 000000012345`,
    },
    strike: { eyebrow: t('film.strike.eyebrow'), title: t('film.strike.title'), valid: t('film.strike.valid') },
    quench: {
      eyebrow: t('film.quench.eyebrow'), title: t('film.quench.title'), copy: t('film.quench.copy'),
      noMatch: t('film.quench.noMatch'), lists: t('film.quench.lists'),
      fatf: t('film.quench.fatf'), sepa: t('film.quench.sepa'), risk: t('film.quench.risk'),
    },
    stamp: {
      eyebrow: t('film.stamp.eyebrow'), title: t('film.stamp.title'), copy: t('film.stamp.copy'),
      iid: t('film.stamp.iid'), sic: t('film.stamp.sic'),
      eurosic: t('film.stamp.eurosic'), instant: t('film.stamp.instant'),
    },
    ship: {
      eyebrow: t('film.ship.eyebrow'),
      title: t('film.ship.title', { ms: msLabel }), head: t('film.ship.head', { ms: msLabel }),
      tryLive: t('film.ship.tryLive'), copy: t('film.ship.copy'),
      processingMs: String(P50_PROCESSING_MS),
    },
  }

  return (
    <div className="forge">
      {/* ── The fold: the promise on the left, the proof on the right ──────
          Audit 2026-09-04 (L3 + M1 + L1). The 149 px lockup repeated the
          header's logo and dwarfed a 33 px h1; 56 % of the fold was empty;
          nothing on it showed the product. The h1 is now the largest object
          of the page, the sub-title carries the live figures and the buying
          segment, and a real request plays beside it. */}
      <section className="hero" aria-labelledby="h-hero">
        <div className="hero-copy">
          {/* Audit 2026-09-05 (n° 16): the badge repeated the BIC count that the
              sub-title states one line below and the stats band 300 px further.
              It now carries the one figure nothing else on the page shows, the
              30-day error-free rate, and opens the status page. */}
          <Link href={`/${locale}/status`} className="hero-badge">
            <span className="dot" aria-hidden="true"></span>
            {rate30 ? t('badge', { rate: rate30 }) : t('badgeFallback')}
          </Link>
          <h1 id="h-hero">
            {t.rich('hero.title', {
              accent: (chunks) => <em>{chunks}</em>,
            })}
          </h1>
          <p className="hero-desc">
            {t.rich('hero.description', {
              bic: figures.bic,
              ch: figures.ch,
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
          {/* Audit 2026-09-04 (S7): the primary action asked for an e-mail
              against a promise; seeing a response is the smaller step and the
              natural first one on an API. The key comes second. */}
          <div className="hero-cta">
            <Button
              size="lg"
              variant="amber"
              className="px-6"
              nativeButton={false}
            render={<Link href={`/${locale}/playground`} />}
            >
              {t('hero.cta.tryFree')}
            </Button>
            <GetKeyButton variant="outline" className="px-6">
              {t('hero.cta.getKey')}
            </GetKeyButton>
          </div>
        </div>
        <FoldDemo iban="CH1000230000000012345" fallback={DEFAULT_RESULT.iban} />
      </section>

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
            <Link href={`/${locale}/legal/dpa`} className="trust-n" style={{ textDecoration: 'underline', textUnderlineOffset: 4 }}>
              {t('trust.privacyNote')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Sourced stats, counting up on scroll ─────────────────────────── */}
      <section className="stats-band">
        <StatsBar stats={STATS} locale={locale} />
      </section>

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

      {/* ── The dated trigger: 14 November 2026 (audit 2026-09-04, M3) ────────
          It was the seventh line of the endpoint list, at 80 % of the page.
          The dates are the ones our own doc and the 2026-09-02 post cite,
          source by source; Swift's suspension of 27 August 2026 is named. */}
      <section className="deadline" aria-labelledby="h-deadline">
        <div className="wrap deadline-grid">
          <div>
            <span className="eyebrow">{t('deadline.eyebrow')}</span>
            <h2 className="sect-h sect-h-left" id="h-deadline">{t('deadline.heading')}</h2>
          </div>
          <div>
            <p className="deadline-text">{t('deadline.text')}</p>
            <div className="hero-cta">
              <Link href={`/${locale}/docs/structured-addresses`} className="btn-ghost-link">
                {t('deadline.cta')}
              </Link>
              <Link href={`/${locale}/audit`} className="btn-ghost-link">
                {t('audit.cta')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── The film: four forging stations, scrubbed by scroll ──────────── */}
      <ForgeFilm t={film} playgroundHref={`/${locale}/playground`} />

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
              const href = external ? item.href : `/${locale}${item.href}`
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

      {/* ── The non-developer door: the creditor file audit (02/09/2026) ── */}
      <section className="sect" aria-labelledby="h-audit" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 className="sect-h" id="h-audit">{t('audit.heading')}</h2>
          <p className="sect-sub">{t('audit.text')}</p>
          {/* Audit 2026-09-04 (M4): the only CHF price and the only no-code
              offer of the page were announced by a negation and a ghost
              button. A full button, centred like the section. */}
          <div className="hero-cta hero-cta-center" style={{ marginTop: '1.4rem' }}>
            <Button size="lg" variant="amber" className="px-8" nativeButton={false} render={<Link href={`/${locale}/audit`} />}>
              {t('audit.cta')}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Agents get their own rail ─────────────────────────────────────── */}
      <section className="agents-rail sect" aria-labelledby="h-agents">
        <div className="wrap">
          <h2 className="sect-h" id="h-agents">{t('agentsRail.heading')}</h2>
          <p className="sect-sub">{t('agentsRail.sub')}</p>
          <svg
            className="agents-illo"
            viewBox="0 0 360 150"
            role="img"
            aria-label={t('agentsRail.illoAlt')}
            dangerouslySetInnerHTML={{ __html: AGENTS_ILLO }}
          />
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
            <Link href={`/${locale}/blog/2026-08-11-graded-by-a-catalog-that-never-read-us`}>
              {t('reviewed.linkStory')}
            </Link>
          </p>
        </div>
      </section>

      {/* ── Finale: the ember ridge behind the last call ──────────────────── */}
      <section className="cta-final" aria-labelledby="h-cta">
        <div className="wrap">
          <h2 id="h-cta">{t('cta.heading')}</h2>
          <p>{t('cta.description')}</p>
          {/* Audit 2026-09-05 (n° 7): centred like the heading above it. */}
          <div className="hero-cta hero-cta-center">
            <GetKeyButton variant="amber" className="px-8">
              {t('cta.getKeyButton')}
            </GetKeyButton>
            <Button
              size="lg"
              variant="outline"
              className="px-8"
              nativeButton={false}
              render={<Link href={`/${locale}/docs`} />}
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
