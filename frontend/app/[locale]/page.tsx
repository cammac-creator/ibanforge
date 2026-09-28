import Image from "next/image"
import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"
import { Bot, CodeXml, FileSpreadsheet, Globe, Info, Lock, ShieldCheck } from "lucide-react"
import { routing } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { StatusDot } from "@/components/ui/status-dot"
import { GetKeyButton } from "@/components/api-key-dialog"
import { Reveal } from "@/components/reveal"
import { LensHero, type LensCopy } from "@/components/lens/lens-hero"
import { LensGallery, type GalleryCopy } from "@/components/lens/lens-gallery"
import { lensAssets } from "@/components/lens/assets"
import { RevueFilm, type RevueFilmCopy } from "@/components/home/revue-film"
import { CoverTitleGuard, RevueMotion } from "@/components/home/revue-motion"
import { CoverTitle, MaskedWords } from "@/components/home/revue-parts"
import { IbanAnatomy } from "@/components/home/iban-anatomy"
import { IntegrationRibbon } from "@/components/home/integration-ribbon"
import "@/components/lens/lens.css"
import "@/components/home/home.css"
import "@/components/home/revue.css"
import { getLandingStats, P50_PROCESSING_MS, SUPPORTED_COUNTRIES } from "@/lib/landing-stats"
import { alternatesFor, urlFor } from "@/lib/seo"
import { localePath } from "@/lib/locale-path"
import { formatGrouped } from "@/lib/format-grouped"
// Quotas read from what the API exports (scripts/export-onboarding.ts), never
// retyped: the layout's JSON-LD does the same (components/json-ld.tsx).
import catalogue from "@/data/onboarding.json"

/*
 * The home, redesigned on 27/09/2026 (Claude-Alain: « une landing fresh qui
 * explique simplement le produit », in the style of the rest of the site).
 *
 * What it keeps from the audits of September: the figures read live, the
 * locale guard before any Intl call, one JSON-LD graph, the dated trigger of
 * mid-November without a countdown, the file audit as the door for those who
 * do not code, the agents' rail, the public review, the data-evt names.
 *
 * What changed: the title says what the product is and for whom, in the words
 * of positioning.ts ("checks the bank behind an IBAN before you pay"); the
 * first screen shows three answers the API really gave, the second the one
 * thing a checksum cannot say. The type and colours are the site's own: Bebas
 * Neue titles as on the other landings, Inter, JetBrains Mono, amber.
 *
 * Since 28/09/2026 the page turns into a magazine, « La revue », the layout
 * Claude-Alain chose among two mockups of direction D, chapter by chapter
 * (components/home/revue.css). Step 1: the cover, whose title fills its column
 * line by line; the lens chosen on 16/09, back under the cover with its input
 * on the left and its answer on the right; and chapter 01, where the film of
 * the three answers replaces the demo card (components/home/revue-film.tsx).
 */

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
 * 2026-09-05, n° 1): the figures of /health change by the day at most, and the
 * checker's real call happens in the browser anyway.
 */
export const revalidate = 3600

/* Every integration points to its package or its published code. */
const INTEGRATIONS = [
  { key: "ts", cmd: "npm install @ibanforge/sdk", href: "https://www.npmjs.com/package/@ibanforge/sdk" },
  { key: "py", cmd: "pip install ibanforge", href: "https://pypi.org/project/ibanforge/" },
  { key: "java", cmd: "com.ibanforge:ibanforge-sdk", href: "https://central.sonatype.com/artifact/com.ibanforge/ibanforge-sdk" },
  { key: "dotnet", cmd: "dotnet add package IBANforge.Sdk", href: "https://www.nuget.org/packages/IBANforge.Sdk" },
  { key: "mcp", cmd: "npx -y ibanforge-mcp", href: "https://www.npmjs.com/package/ibanforge-mcp" },
  { key: "n8n", cmd: "npm install n8n-nodes-ibanforge", href: "https://www.npmjs.com/package/n8n-nodes-ibanforge" },
  { key: "odoo", cmd: "ibanforge_bank_autofill", href: "https://github.com/cammac-creator/ibanforge/tree/main/integrations/odoo" },
  { key: "sheets", cmd: "=IBAN_CONTROLE(A2)", href: "/sheets" },
  { key: "postman", cmd: "ibanforge.postman_collection.json", href: "https://github.com/cammac-creator/ibanforge/tree/main/integrations/postman" },
] as const

/* The add-on answers to one formula name per language (integrations/sheets/Code.gs). */
const SHEETS_FORMULA: Record<string, string> = {
  en: "=IBAN_CHECK(A2)",
  fr: "=IBAN_CONTROLE(A2)",
  de: "=IBAN_PRUEFUNG(A2)",
}

const FIRST_CALL = `curl -X POST https://api.ibanforge.com/v1/iban/validate \\
  -H "Content-Type: application/json" \\
  -d '{"iban":"DE89370400440532013000"}'`

const FAQ_COUNT = 5

/* The two doors of the cover: the magazine's square buttons, full width of their column. */
const COVER_BUTTON = "h-[52px] w-full rounded-[2px] px-[22px] text-base font-semibold"

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  // The home is the one page a bogus first segment lands on: `/icon-512.png`
  // for a file that does not exist is routed here with locale "icon-512.png",
  // and `Intl.DateTimeFormat("icon-512.png")` below would throw before the
  // layout's refusal lands, a 500 where a 404 is owed (2026-09-05). Same
  // guard as the layout, this side.
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)
  const t = await getTranslations("home")
  const verdict = await getTranslations("playground")
  const liveStats = await getLandingStats()

  const countries = String(SUPPORTED_COUNTRIES)
  const registerCodes = t("coverage.registerCodes")
  const keyCodes = t("coverage.keyCodes")
  const registerCount = registerCodes.split(",").length
  const keyCount = keyCodes.split(",").length
  // "0,4" in French and German, the site's one number format.
  const latency = formatGrouped(P50_PROCESSING_MS, locale, 1)

  // The refresh date /health reports, never typed by hand (S4 of 2026-09-04).
  const refreshedOn = liveStats.bicDataLastUpdated
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${liveStats.bicDataLastUpdated}T00:00:00Z`),
      )
    : null

  /* The film tells the three answers the live API gave on 26/09/2026: its
     figures and codes are data (the IBANs, 37040044, COBADEFFXXX), its words
     come from the messages, every one formatted here, on the server. */
  const code = (chunks: ReactNode) => <code className="rv-d__code">{chunks}</code>
  const film: RevueFilmCopy = {
    aria: t("film.aria"),
    ready: t("film.ready"),
    amount: t("film.amount"),
    payee: t.rich("film.payee", { b: (chunks) => <b>{chunks}</b>, code }),
    reading: t("film.reading"),
    parts: {
      country: t("film.partCountry"),
      check: t("film.partCheck"),
      bank: t("film.partBank"),
      account: t("film.partAccount"),
    },
    confirmed: t("demo.verdictOk"),
    confirmedBy: t.rich("film.confirmedBy", {
      code: (chunks) => <code className="rv-d__code rv-d__code--ambre">{chunks}</code>,
    }),
    sameInvoice: t("film.sameInvoice"),
    checkValid: t("film.checkValid"),
    unallocated: t("film.unallocated"),
    stopLines: t.raw("film.stopLines") as string[],
    stopReason: t.rich("film.stopReason", { code }),
    typo: t("demo.tab2"),
    checksum: t("demo.checksum"),
    fixLines: t.raw("film.fixLines") as string[],
    fixNote: t("demo.noteFix"),
    pause: t("demo.pause"),
    play: t("demo.play"),
    examples: t("film.examples"),
    tabs: [t("demo.tab0"), t("demo.tab1"), t("demo.tab2")],
    figure: t("film.figure"),
    caption: `${t("film.figPayment", { amount: t("film.amount") })} ${t("demo.caption")}`,
  }

  const anatomy = [
    { code: "DE", label: t("problem.country"), what: t("problem.countryWhat", { countries }) },
    { code: "89", label: t("problem.check"), what: t("problem.checkWhat") },
    { code: "37040044", label: t("problem.bank"), what: t("problem.bankWhat") },
    { code: "0532013000", label: t("problem.account"), what: t("problem.accountWhat") },
  ]

  const checksumItems = t.raw("problem.checksumItems") as string[]
  const addsItems = t.raw("problem.addsItems") as string[]

  const faq = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    q: t(`faq.q${i}`),
    a: t(`faq.a${i}`, { trialWeekly: catalogue.restTrialWeekly, claimed: catalogue.claimedMonthly }),
  }))

  const plans = [
    { key: "try", featured: false },
    { key: "key", featured: false },
    { key: "pro", featured: true },
    { key: "packs", featured: false },
  ] as const

  const integrationItems = INTEGRATIONS.map((item) => {
    const external = item.href.startsWith("http")
    const cmd = item.key === "sheets" ? (SHEETS_FORMULA[locale] ?? item.cmd) : item.cmd
    return { ...item, cmd, href: external ? item.href : localePath(locale, item.href), external }
  })

  return (
    <div className="home" data-landing="home-v3">
      {/* ── 1. The cover: what it is, for whom, the two doors ───────────────
          Its title never moves: it is what the first screen paints. */}
      <section className="rv-couv" aria-labelledby="home-title">
        <div className="rv-grille rv-couv__haut">
          <div className="rv-couv__titre">
            <p className="rv-kicker rv-surtitre">
              {/* Green only when a measure stands behind it: at least 99 % of
                  answers without a 5xx over 30 days, read at each hourly render. */}
              {liveStats.successRate30 !== null && liveStats.successRate30 >= 99 && <StatusDot kind="live" />}
              {t("hero.eyebrow")}
            </p>
            <CoverTitle locale={locale} id="home-title" />
          </div>
          <div className="rv-couv__action">
            <p className="rv-couv__chapeau">{t("hero.description", { countries })}</p>
            <div className="rv-boutons">
              <GetKeyButton variant="amber" className={COVER_BUTTON} evt="cta:key-hero">
                {t("hero.ctaKey")}
              </GetKeyButton>
              <Button
                size="lg"
                variant="outline"
                className={COVER_BUTTON}
                nativeButton={false}
                render={<a href="#try" data-evt="cta:try-hero" />}
              >
                {t("hero.ctaTry")}
              </Button>
            </div>
            <ul className="rv-reass">
              <li>{t("hero.note1")}</li>
              <li>{t("hero.note2")}</li>
              <li>{t("hero.note3")}</li>
            </ul>
            <Link href={localePath(locale, "/audit")} className="rv-alt" data-evt="cta:journey-audit">
              {t("hero.alt")} →
            </Link>
          </div>
        </div>
      </section>

      {/* ── 2. The lens chosen on 16/09, under the cover, as one block: its
          input on the left, its answer on the right, a real call to the API.
          Its 3D starts by itself only on a capable device (lens-hero.tsx). */}
      <div className="rv-lentille" id="try">
        <div className="lens-frame">
          <LensHero
            copy={t.raw("lens.hero") as LensCopy}
            verdictCopy={verdict.raw("verdict") as LensCopy}
            playgroundHref={localePath(locale, "/playground")}
            auditHref={localePath(locale, "/audit")}
          />
        </div>
      </div>

      {/* ── 3. Chapter 01: why a checksum is not enough, told by the film ─── */}
      <section className="rv-chap" aria-labelledby="home-problem">
        <header className="rv-grille rv-ouv">
          <i className="rv-filet" data-rv="filet" aria-hidden="true" />
          <p className="rv-num" aria-hidden="true" data-rv="num">
            01
          </p>
          <div className="rv-ouv__texte">
            <p className="rv-kicker" data-rv="texte">
              {t("problem.eyebrow")}
            </p>
            <h2 className="rv-h2 rv-bebas" id="home-problem" data-rv="titre" style={{ "--rv-d": ".08s" } as CSSProperties}>
              <MaskedWords text={t("problem.title")} />
            </h2>
            <p className="rv-chapeau" data-rv="texte" style={{ "--rv-d": ".35s" } as CSSProperties}>
              {t("problem.lead")}
            </p>
          </div>
        </header>
        <RevueFilm copy={film} />
      </section>

      {/* ── 4. The same IBAN, read part by part: the anatomy of an IBAN ───── */}
      <section className="home-section" aria-labelledby="home-reading">
        <div className="home-wrap">
          <div className="home-center">
            <span className="home-eyebrow">{t("film.reading")}</span>
            <h2 className="home-h2" id="home-reading">
              {t("problem.readTitle")}
            </h2>
            <p className="home-lead">{t("problem.readLead")}</p>
          </div>
          <IbanAnatomy parts={anatomy} caption={t("problem.anatomyCaption")} />
          <div className="home-versus">
            <Reveal className="home-card muted">
              <h3>{t("problem.checksumTitle")}</h3>
              <ul>
                {checksumItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={80} className="home-card">
              <h3>{t("problem.addsTitle")}</h3>
              <ul>
                {addsItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── 5. Three ways to use it: the brand illustrations of 16/09 ─────── */}
      <LensGallery copy={t.raw("lens.gallery") as GalleryCopy} locale={locale} />

      {/* ── 6. For whom: developers, finance teams, AI agents ──────────────── */}
      <section className="home-section" aria-labelledby="home-audiences">
        <div className="home-wrap">
          <div className="home-center">
            <span className="home-eyebrow">{t("audiences.eyebrow")}</span>
            <h2 className="home-h2" id="home-audiences">
              {t("audiences.title")}
            </h2>
            <p className="home-lead">{t("audiences.lead")}</p>
          </div>
          <div className="home-cards">
            <Reveal className="home-card">
              <span className="home-card-icon">
                <CodeXml aria-hidden="true" />
              </span>
              <h3>{t("audiences.devTitle")}</h3>
              <p>{t("audiences.devText")}</p>
              <code className="home-code">{FIRST_CALL}</code>
              <Link href={localePath(locale, "/docs")} className="home-card-link" data-evt="cta:docs">
                {t("audiences.devLink")}
              </Link>
            </Reveal>
            <Reveal delay={70} className="home-card">
              <span className="home-card-icon">
                <FileSpreadsheet aria-hidden="true" />
              </span>
              <h3>{t("audiences.financeTitle")}</h3>
              <p>{t("audiences.financeText")}</p>
              <Link href={localePath(locale, "/audit")} className="home-card-link" data-evt="cta:audit">
                {t("audiences.financeLink")}
              </Link>
            </Reveal>
            <Reveal delay={140} className="home-card">
              <span className="home-card-icon">
                <Bot aria-hidden="true" />
              </span>
              <h3>{t("audiences.agentsTitle")}</h3>
              <p>{t("audiences.agentsText")}</p>
              <code className="home-code">npx -y ibanforge-mcp</code>
              <Link href={localePath(locale, "/agents")} className="home-card-link" data-evt="cta:agents">
                {t("audiences.agentsLink")}
              </Link>
            </Reveal>
          </div>

          {/* What installs today, as a slow ribbon (a plain list without motion). */}
          <IntegrationRibbon
            label={t("integrations.heading")}
            description={t("integrations.sub")}
            pause={t("integrations.pause")}
            play={t("integrations.play")}
          >
            {[0, 1].map((copy) =>
              integrationItems.map((item) => (
                <a
                  key={`${copy}-${item.key}`}
                  href={item.href}
                  className="home-integ"
                  aria-hidden={copy === 1 ? true : undefined}
                  tabIndex={copy === 1 ? -1 : undefined}
                  {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  <span>{t(`integrations.items.${item.key}`)}</span>
                  <code>{item.cmd}</code>
                </a>
              )),
            )}
          </IntegrationRibbon>
        </div>
      </section>

      {/* ── 7. Coverage and trust: figures read from the code, facts ───────── */}
      <section className="home-section" aria-labelledby="home-coverage">
        <div className="home-wrap">
          <div className="home-center">
            <span className="home-eyebrow">{t("coverage.eyebrow")}</span>
            <h2 className="home-h2" id="home-coverage">
              {t("coverage.title")}
            </h2>
            <p className="home-lead">{t("coverage.lead")}</p>
          </div>
          <Reveal className="home-figures">
            <div className="home-figure">
              <b>{countries}</b>
              <span>{t("coverage.figCountries")}</span>
            </div>
            <div className="home-figure">
              <b>{registerCount}</b>
              <span>{t("coverage.figRegisters")}</span>
              <code>{registerCodes}</code>
            </div>
            <div className="home-figure">
              <b>{keyCount}</b>
              <span>{t("coverage.figKeys")}</span>
              <code>{keyCodes}</code>
            </div>
            <div className="home-figure">
              <b>
                {latency}
                <small>ms</small>
              </b>
              <span>{t("coverage.figLatency")}</span>
            </div>
          </Reveal>
          <div className="home-cards home-cards-4">
            {[Globe, Lock, ShieldCheck, Info].map((Icon, i) => (
              <Reveal key={i} delay={i * 60} className="home-card">
                <span className="home-card-icon">
                  <Icon aria-hidden="true" />
                </span>
                <h3>{t(`coverage.fact${i}Title`)}</h3>
                <p>{t(`coverage.fact${i}Text`)}</p>
                {i === 1 && (
                  <Link href={localePath(locale, "/legal/dpa")} className="home-card-link">
                    DPA 4.7
                  </Link>
                )}
              </Reveal>
            ))}
          </div>
          <p className="home-sources">
            {t("coverage.sources")} {refreshedOn ? t("coverage.sourcesDated", { date: refreshedOn }) : null}{" "}
            <Link href={localePath(locale, "/sources")}>{t("coverage.sourcesLink")}</Link>
          </p>
        </div>
      </section>

      {/* ── 8. Pricing: the plans people pay first, x402 in one line ───────── */}
      <section className="home-section" aria-labelledby="home-pricing">
        <div className="home-wrap">
          <div className="home-center">
            <span className="home-eyebrow">{t("pricing.eyebrow")}</span>
            <h2 className="home-h2" id="home-pricing">
              {t("pricing.title")}
            </h2>
            <p className="home-lead">{t("pricing.lead")}</p>
          </div>
          <div className="home-cards home-cards-4">
            {plans.map((plan, i) => (
              <Reveal key={plan.key} delay={i * 60} className={`home-card home-plan${plan.featured ? " featured" : ""}`}>
                <span className={`home-tag${plan.featured ? " amber" : ""}`}>{t(`pricing.${plan.key}Name`)}</span>
                <p className="home-price">
                  {t(`pricing.${plan.key}Price`)}
                  {plan.key === "pro" && <small>{t("pricing.proUnit")}</small>}
                </p>
                <p>
                  {t(`pricing.${plan.key}Text`, {
                    trialWeekly: catalogue.restTrialWeekly,
                    claimed: catalogue.claimedMonthly,
                  })}
                </p>
                {plan.key === "try" ? (
                  <a href="#try" className="home-card-link" data-evt="cta:try-pricing">
                    {t("pricing.tryCta")}
                  </a>
                ) : plan.key === "key" ? (
                  <GetKeyButton variant="amber" size="default" className="mt-auto w-full" evt="cta:key-pricing">
                    {t("pricing.keyCta")}
                  </GetKeyButton>
                ) : (
                  <Link href={localePath(locale, "/pricing")} className="home-card-link" data-evt={`cta:pricing-${plan.key}`}>
                    {t(`pricing.${plan.key}Cta`)}
                  </Link>
                )}
              </Reveal>
            ))}
          </div>
          <p className="home-plans-foot">
            {t("pricing.agents")}{" "}
            <Link href={localePath(locale, "/pricing")} data-evt="cta:pricing">
              {t("pricing.link")}
            </Link>
          </p>
        </div>
      </section>

      {/* ── 9. The dated trigger: mid-November 2026, never a countdown ────────
          Claude-Alain's decision of 22/09/2026: the month in the title, SIX's
          day in the body, no day count (a precision claim about what happens
          to a payment on that day is not ours to make). */}
      <section className="home-deadline" aria-labelledby="home-deadline">
        <div className="home-wrap home-deadline-inner">
          <p className="home-deadline-when">
            {t("deadline.window")}
            <small>{t("deadline.windowLabel")}</small>
          </p>
          <div>
            <h2 className="sr-only" id="home-deadline">
              {t("deadline.heading")}
            </h2>
            <p>{t("deadline.band")}</p>
          </div>
          <div className="home-deadline-links">
            <Button size="sm" variant="amber" nativeButton={false} render={<Link href={localePath(locale, "/docs/structured-addresses")} data-evt="cta:rules" />}>
              {t("deadline.cta")}
            </Button>
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={localePath(locale, "/audit")} data-evt="cta:audit-deadline" />}>
              {t("audiences.financeLink")}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 10. Independently reviewed ──────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="home-reviewed">
        <div className="home-wrap home-quote">
          <span className="home-eyebrow" id="home-reviewed">
            {t("reviewed.label")}
          </span>
          <blockquote>“{t("reviewed.quote")}”</blockquote>
          {t("reviewed.quoteTranslation") && <p>{t("reviewed.quoteTranslation")}</p>}
          <p>{t("reviewed.context")}</p>
          <p className="links">
            <a href="https://github.com/api-search/inbox/issues/3" target="_blank" rel="noopener noreferrer">
              {t("reviewed.linkReview")}
            </a>
            <Link href={localePath(locale, "/blog/2026-08-11-graded-by-a-catalog-that-never-read-us")}>
              {t("reviewed.linkStory")}
            </Link>
          </p>
        </div>
      </section>

      {/* ── 11. Questions ─────────────────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="home-faq">
        <div className="home-wrap">
          <div className="home-center">
            <h2 className="home-h2" id="home-faq">
              {t("faq.title")}
            </h2>
          </div>
          <div className="home-faq">
            {faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 12. The last call, over a discreet reflection of the lens (his
          request of 16/09 for this block) ─────────────────────────────── */}
      <section className="home-final" aria-labelledby="home-final">
        <div className="home-final-bg" aria-hidden="true">
          <Image src={lensAssets.poster} alt="" width={1707} height={769} sizes="100vw" loading="lazy" />
        </div>
        <div className="home-wrap">
          <h2 id="home-final">{t("cta.title")}</h2>
          <p>{t("cta.text")}</p>
          <div className="home-hero-cta">
            <GetKeyButton variant="amber" className="px-8" evt="cta:key-final">
              {t("cta.getKey")}
            </GetKeyButton>
            <Button size="lg" variant="outline" className="px-8" nativeButton={false} render={<Link href={localePath(locale, "/docs")} data-evt="cta:docs-final" />}>
              {t("cta.docs")}
            </Button>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // One graph (audit 2026-09-04, S11): ids relate the entities, URLs
          // carry the locale. The FAQ repeats the visible answers word for word.
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebAPI",
                "@id": `${urlFor(locale)}#api`,
                name: "IBANforge",
                url: urlFor(locale),
                inLanguage: locale,
                description: t("metadata.description"),
                documentation: urlFor(locale, "/docs"),
                termsOfService: urlFor(locale, "/legal"),
                provider: { "@id": "https://ibanforge.com/#organization" },
                isPartOf: { "@id": "https://ibanforge.com/#software" },
                offers: {
                  "@type": "Offer",
                  price: "0",
                  priceCurrency: "USD",
                  // Until 24/09/2026: "Free tier — 200 requests per month", on
                  // every locale, as if 200 came with no step at all. Until
                  // 27/09/2026: "no e-mail" beside the 200, which the claim
                  // with an e-mail unlocks.
                  description: `Free API key: ${catalogue.claimedMonthly} requests a month once claimed with an e-mail, ${catalogue.anonymousMonthly} a month before that, with no e-mail`,
                },
              },
              {
                "@type": "FAQPage",
                "@id": `${urlFor(locale)}#faq`,
                inLanguage: locale,
                mainEntity: faq.map((item) => ({
                  "@type": "Question",
                  name: item.q,
                  acceptedAnswer: { "@type": "Answer", text: item.a },
                })),
              },
            ],
          }),
        }}
      />
      <CoverTitleGuard />
      <RevueMotion />
    </div>
  )
}
