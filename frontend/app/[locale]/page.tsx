import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Button } from "@/components/ui/button"
import { GetKeyButton } from "@/components/api-key-dialog"
import { Reveal } from "@/components/reveal"
import { StatsBar } from "@/components/stats-bar"
import { ForgeFilm, type FilmStrings } from "@/components/forge/forge-film"
import {
  getLandingStats,
  P50_PROCESSING_MS,
  SUPPORTED_COUNTRIES,
} from "@/lib/landing-stats"
import { alternatesFor } from "@/lib/seo"

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

/* Ambient ember particles — the logo's rising bars, scattered. Static SVG
   markup as trusted constants; the drift animation is CSS, js+motion gated. */
const EMBERS_HERO = `<rect x="40" y="150" width="3" height="7" fill="#F59E0B" opacity="0.55"/><rect x="85" y="90" width="2" height="5" fill="#FCD34D" opacity="0.35"/><rect x="130" y="180" width="4" height="9" fill="#F59E0B" opacity="0.7"/><rect x="170" y="60" width="2" height="4" fill="#EF4444" opacity="0.3"/><rect x="215" y="130" width="3" height="6" fill="#F59E0B" opacity="0.5"/><rect x="255" y="200" width="5" height="10" fill="#F59E0B" opacity="0.8"/><rect x="300" y="40" width="2" height="4" fill="#FCD34D" opacity="0.25"/><rect x="330" y="160" width="3" height="7" fill="#EF4444" opacity="0.45"/><rect x="370" y="100" width="2" height="5" fill="#F59E0B" opacity="0.4"/><rect x="415" y="185" width="4" height="8" fill="#FCD34D" opacity="0.65"/><rect x="455" y="70" width="2" height="4" fill="#F59E0B" opacity="0.3"/><rect x="495" y="140" width="3" height="6" fill="#EF4444" opacity="0.5"/><rect x="540" y="190" width="4" height="9" fill="#F59E0B" opacity="0.75"/><rect x="575" y="110" width="2" height="5" fill="#FCD34D" opacity="0.35"/><rect x="20" y="60" width="2" height="4" fill="#F59E0B" opacity="0.25"/><rect x="110" y="30" width="2" height="3" fill="#EF4444" opacity="0.2"/>`

const EMBERS_SECTION = `<rect x="55" y="170" width="3" height="6" fill="#F59E0B" opacity="0.45"/><rect x="120" y="110" width="2" height="4" fill="#FCD34D" opacity="0.3"/><rect x="190" y="195" width="4" height="8" fill="#F59E0B" opacity="0.6"/><rect x="250" y="80" width="2" height="4" fill="#EF4444" opacity="0.25"/><rect x="310" y="150" width="3" height="6" fill="#F59E0B" opacity="0.4"/><rect x="380" y="200" width="4" height="9" fill="#F59E0B" opacity="0.65"/><rect x="440" y="120" width="2" height="5" fill="#FCD34D" opacity="0.3"/><rect x="505" y="175" width="3" height="7" fill="#EF4444" opacity="0.4"/><rect x="560" y="95" width="2" height="4" fill="#F59E0B" opacity="0.28"/>`

const EMBERS_CTA = `<rect x="70" y="140" width="3" height="7" fill="#F59E0B" opacity="0.5"/><rect x="140" y="70" width="2" height="4" fill="#FCD34D" opacity="0.3"/><rect x="205" y="185" width="4" height="9" fill="#F59E0B" opacity="0.7"/><rect x="270" y="110" width="2" height="5" fill="#EF4444" opacity="0.35"/><rect x="335" y="55" width="2" height="4" fill="#FCD34D" opacity="0.25"/><rect x="395" y="165" width="3" height="7" fill="#F59E0B" opacity="0.55"/><rect x="460" y="90" width="2" height="4" fill="#F59E0B" opacity="0.3"/><rect x="525" y="150" width="3" height="6" fill="#EF4444" opacity="0.45"/><rect x="580" y="200" width="4" height="8" fill="#F59E0B" opacity="0.7"/>`

/* The x402 spot illustration: a robotic arm paying its coin into the slot. */
const AGENTS_ILLO = `<defs><radialGradient id="acoin" cx="38%" cy="35%" r="75%"><stop offset="0%" stop-color="#FCD34D"/><stop offset="55%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#D97706"/></radialGradient></defs><rect x="18" y="122" width="128" height="12" rx="3" fill="#292524"/><circle cx="34" cy="128" r="2.5" fill="#57534E"/><circle cx="130" cy="128" r="2.5" fill="#57534E"/><rect x="70" y="66" width="16" height="58" rx="4" fill="#3F3A34"/><path d="M78,70 q-26,18 -8,52" stroke="#292524" stroke-width="3" fill="none"/><g stroke-linecap="round"><line x1="78" y1="70" x2="152" y2="34" stroke="#57534E" stroke-width="13"/><line x1="152" y1="34" x2="230" y2="55" stroke="#44403C" stroke-width="10"/></g><circle cx="78" cy="70" r="8" fill="#292524" stroke="#57534E" stroke-width="2"/><circle cx="152" cy="34" r="8.5" fill="#292524" stroke="#57534E" stroke-width="2"/><circle cx="152" cy="34" r="3" fill="#78716C"/><g stroke="#57534E" stroke-width="5.5" fill="none" stroke-linecap="round"><path d="M230,49 q16,-2 24,8"/><path d="M230,61 q16,4 22,14"/></g><g class="coin"><ellipse cx="258" cy="66" rx="27" ry="21" fill="#F59E0B" opacity="0.13"/><circle cx="258" cy="66" r="13.5" fill="url(#acoin)"/><circle cx="258" cy="66" r="13.5" fill="none" stroke="#FCD34D" stroke-width="1.6" opacity="0.8"/><rect x="254" y="60" width="8" height="12" rx="2" fill="#1C0A00" opacity="0.35"/></g><rect x="288" y="84" width="56" height="50" rx="7" fill="#1C1917" stroke="#292524"/><rect x="288" y="84" width="56" height="8" rx="4" fill="#26211C"/><rect x="299" y="100" width="34" height="6" rx="3" fill="#F59E0B" opacity="0.9"/><rect x="299" y="115" width="12" height="5" rx="1.5" fill="#EF4444" opacity="0.65"/><rect x="315" y="115" width="12" height="5" rx="1.5" fill="#4ADE80" opacity="0.65"/>`

function Embers({ html }: { html: string }) {
  return (
    <svg
      className="embers"
      viewBox="0 0 600 240"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('home');
  const liveStats = await getLandingStats();

  const FEATURES = Array.from({ length: FEATURE_COUNT }, (_, i) => ({
    badge: t(`features.${i}.badge`),
    title: t(`features.${i}.title`),
    description: t(`features.${i}.description`),
  }))

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

  const film: FilmStrings = {
    cue: t('film.cue'),
    heat: {
      eyebrow: t('film.heat.eyebrow'), title: t('film.heat.title'), copy: t('film.heat.copy'),
      country: t('film.heat.country'), check: t('film.heat.check'),
      bank: t('film.heat.bank'), account: t('film.heat.account'),
    },
    strike: {
      eyebrow: t('film.strike.eyebrow'), title: t('film.strike.title'),
      note: t('film.strike.note'), valid: t('film.strike.valid'), copy: t('film.strike.copy'),
    },
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
      eyebrow: t('film.ship.eyebrow'), title: t('film.ship.title'), head: t('film.ship.head'),
      tryLive: t('film.ship.tryLive'), copy: t('film.ship.copy'),
    },
  }

  return (
    <div className="forge">
      {/* ── Hero: the lockup lands, the film waits below ─────────────────── */}
      <section className="hero" aria-label="IBANforge">
        <div className="glow glow-a" aria-hidden="true"></div>
        <div className="glow glow-b" aria-hidden="true"></div>
        <Embers html={EMBERS_HERO} />
        <p className="hero-badge"><span className="dot" aria-hidden="true"></span>{t('badge')}</p>
        <p className="wordmark" aria-hidden="true"><span className="mark"></span><span className="wtext"><span className="lt">I</span><span className="lt" style={{ animationDelay: '0.07s' }}>B</span><span className="lt" style={{ animationDelay: '0.14s' }}>A</span><span className="lt" style={{ animationDelay: '0.21s' }}>N</span><span className="fw" style={{ animationDelay: '0.34s' }}>forge</span></span></p>
        <span className="sr-only">IBANforge</span>
        <h1>
          {t.rich('hero.title', {
            accent: (chunks) => <em>{chunks}</em>,
          })}
        </h1>
        <p className="hero-desc">{t('hero.description')}</p>
        <div className="hero-cta">
          <GetKeyButton variant="amber" className="px-6">
            {t('hero.cta.getKey')}
          </GetKeyButton>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<Link href={`/${locale}/playground`} />}
          >
            {t('hero.cta.tryFree')}
          </Button>
        </div>
        <p className="cue" id="forge-cue">{film.cue}</p>
      </section>

      {/* ── The film: five forging stations, scrubbed by scroll ──────────── */}
      <ForgeFilm t={film} playgroundHref={`/${locale}/playground`} />

      {/* ── Sourced stats, counting up on scroll ─────────────────────────── */}
      <section className="stats-band">
        <StatsBar stats={STATS} locale={locale} />
      </section>

      {/* ── Features as forged plaques ────────────────────────────────────── */}
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

      {/* ── The non-developer door: the creditor file audit (02/09/2026) ── */}
      <section className="sect" aria-labelledby="h-audit" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 className="sect-h" id="h-audit">{t('audit.heading')}</h2>
          <p className="sect-sub">{t('audit.text')}</p>
          <div className="hero-cta" style={{ marginTop: '1.4rem' }}>
            <Link href={`/${locale}/audit`} className="btn-ghost-link">
              {t('audit.cta')}
            </Link>
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
        </div>
      </section>

      {/* ── Agents get their own rail ─────────────────────────────────────── */}
      <section className="agents-rail sect" aria-labelledby="h-agents">
        <Embers html={EMBERS_SECTION} />
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
              <p className="agent-code"><a href="https://ibanforge.com/llms.txt" style={{ color: 'inherit', textDecoration: 'none' }}>GET /llms.txt</a></p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Trust band: sources, sanctions lists, Swiss provenance ────────── */}
      <section className="trust-band" aria-label="Data sources and provenance">
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
            <span className="trust-n">{t('trust.dataNote')}</span>
          </div>
          <div className="trust-cell">
            <span className="eyebrow">{t('trust.sanctionsLabel')}</span>
            <p className="trust-v">{t('trust.sanctionsValue')}</p>
            <span className="trust-n">{t('trust.sanctionsNote')}</span>
          </div>
          <div className="trust-cell">
            <span className="eyebrow">{t('trust.madeLabel')}</span>
            <p className="trust-v"><span className="swiss-sq" aria-hidden="true"></span>Made in Switzerland</p>
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

      {/* ── Independently reviewed ────────────────────────────────────────── */}
      <section className="reviewed" aria-labelledby="h-reviewed">
        <div className="wrap">
          <span className="eyebrow" id="h-reviewed">{t('reviewed.label')}</span>
          <blockquote>“{t('reviewed.quote')}”</blockquote>
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
        <Embers html={EMBERS_CTA} />
        <div className="wrap">
          <h2 id="h-cta">{t('cta.heading')}</h2>
          <p>{t('cta.description')}</p>
          <div className="hero-cta">
            <GetKeyButton variant="amber" className="px-8">
              {t('cta.getKeyButton')}
            </GetKeyButton>
            <Button
              size="lg"
              variant="outline"
              className="px-8"
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
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebAPI",
            name: "IBANforge",
            url: "https://ibanforge.com",
            description:
              "IBAN validation, BIC/SWIFT lookup, Swiss clearing data and compliance risk for developers and AI agents.",
            documentation: "https://ibanforge.com/en/docs",
            termsOfService: "https://ibanforge.com/en/legal",
            provider: { "@type": "Organization", name: "IBANforge", url: "https://ibanforge.com" },
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
