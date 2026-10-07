import type { CSSProperties, ReactNode } from "react"
import { Fragment } from "react"
import Link from "next/link"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { notFound } from "next/navigation"
import { routing } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { StatusDot } from "@/components/ui/status-dot"
import { GetKeyButton } from "@/components/api-key-dialog"
import { RevueFilm, type RevueFilmCopy } from "@/components/home/revue-film"
import { RevueEssai } from "@/components/home/revue-essai"
import { essaiCopy } from "@/components/home/revue-essai-model"
import { RevueVoies, type VoiesCopy } from "@/components/home/revue-voies"
import { CoverTitleGuard, RevueMotion } from "@/components/home/revue-motion"
import {
  ApiText,
  BebasFigure,
  ChapterHead,
  CoverTitle,
  FinTitle,
  splitFrom,
  splitMention,
  splitNumbered,
} from "@/components/home/revue-parts"
import { BANK_FIT, counterFit } from "@/components/home/revue-cover-fit"
import "@/components/home/revue.css"
import { getLandingStats, P50_PROCESSING_MS, SUPPORTED_COUNTRIES } from "@/lib/landing-stats"
import { AUDIT_TIERS, formatUsd } from "@/lib/audit-tiers"
import { PRO_MONTHLY_UNITS } from "@/lib/pricing-estimate"
import { alternatesFor, urlFor } from "@/lib/seo"
import { localePath } from "@/lib/locale-path"
import { formatGrouped } from "@/lib/format-grouped"
// Quotas read from what the API exports (scripts/export-onboarding.ts), never
// retyped: the layout's JSON-LD does the same (components/json-ld.tsx).
import catalogue from "@/data/onboarding.json"

/*
 * The home, « la revue resserrée »: the whole page as one short issue of a
 * magazine, approved by Claude-Alain on 28/09/2026 (mockup M3) after he found
 * the page too long and the lens illustrations redundant. A cover, seven
 * numbered chapters with one head each and one figure that shows the product
 * at work, an ending. No lens any more.
 *
 *   01 why mod-97 is not enough: the film (revue-film.tsx)
 *   02 the IBAN read part by part, what mod-97 says and what IBANforge adds
 *   03 a real check, no sign-up (revue-essai.tsx, the tester's real call)
 *   04 three ways to use it, in one scene with three switches (revue-voies.tsx)
 *   05 coverage and trust: the figures, the sources, the integrations
 *   06 prices, the x402 line, the Swiss deadline of mid-November
 *   07 questions, with their structured data
 *
 * What it keeps from the audits of September: the figures read live, the
 * locale guard before any Intl call, one JSON-LD graph, the dated trigger of
 * mid-November without a countdown, the file audit as the door for those who
 * do not code, the data-evt names. The site's own header and footer frame it.
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
 * trial's real call happens in the browser anyway.
 */
export const revalidate = 3600

/* Every integration points to its package or its published code. */
const INTEGRATIONS = [
  { key: "ts", href: "https://www.npmjs.com/package/@ibanforge/sdk" },
  { key: "py", href: "https://pypi.org/project/ibanforge/" },
  { key: "java", href: "https://central.sonatype.com/artifact/com.ibanforge/ibanforge-sdk" },
  { key: "dotnet", href: "https://www.nuget.org/packages/IBANforge.Sdk" },
  { key: "mcp", href: "https://www.npmjs.com/package/ibanforge-mcp" },
  { key: "n8n", href: "https://www.npmjs.com/package/n8n-nodes-ibanforge" },
  { key: "odoo", href: "https://github.com/cammac-creator/ibanforge/tree/main/integrations/odoo" },
  { key: "sheets", href: "/sheets" },
  { key: "postman", href: "https://github.com/cammac-creator/ibanforge/tree/main/integrations/postman" },
] as const

/* The add-on answers to one formula name per language (integrations/sheets/Code.gs). */
const SHEETS_FORMULA: Record<string, string> = {
  en: "=IBAN_CHECK(A2)",
  fr: "=IBAN_CONTROLE(A2)",
  de: "=IBAN_PRUEFUNG(A2)",
}

const FAQ_COUNT = 5

/* The magazine's square buttons: the two doors of the cover, the key of the ending. */
const DOOR_BUTTON = "h-[52px] w-full rounded-[2px] px-[22px] text-base font-semibold"
/* The key of the price table, a size smaller. */
const PRICE_BUTTON = "h-[46px] rounded-[2px] px-[22px] text-[15.5px] font-semibold"

/** A link inside a sentence: never parted from its arrow. */
function Arrow({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="rv-fl" aria-hidden="true">
        {"↗"}
      </span>
    </>
  )
}

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
  const playground = await getTranslations("playground")
  const liveStats = await getLandingStats()

  const countries = String(SUPPORTED_COUNTRIES)
  const registerCodes = t("coverage.registerCodes")
  const keyCodes = t("coverage.keyCodes")
  // "0,4" in French and German, the site's one number format.
  const latency = formatGrouped(P50_PROCESSING_MS, locale, 1)

  // The refresh date /health reports, never typed by hand (S4 of 2026-09-04).
  const refreshedOn = liveStats.bicDataLastUpdated
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${liveStats.bicDataLastUpdated}T00:00:00Z`),
      )
    : null

  /* The chapters, in the order of the issue: their anchor, number and kicker. */
  const chapters = [
    { id: "mod97", num: "01", kicker: t("problem.eyebrow") },
    { id: "anatomy", num: "02", kicker: t("film.reading") },
    { id: "try", num: "03", kicker: t("lens.hero.eyebrow") },
    { id: "ways", num: "04", kicker: t("lens.gallery.eyebrow") },
    { id: "coverage", num: "05", kicker: t("coverage.eyebrow") },
    { id: "pricing", num: "06", kicker: t("pricing.eyebrow") },
    { id: "faq", num: "07", kicker: t("faq.title") },
  ]

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
    unallocated: t("demo.noBank"),
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

  /* The trial: the tester's own words (home.lens.hero), the film's verdicts
     (home.demo) and the verdict the playground shares (playground.verdict). */
  const lens = t.raw("lens.hero") as Record<string, string>
  const essai = essaiCopy(lens, t.raw("demo") as Record<string, string>, playground.raw("verdict") as Record<string, string>)

  /* The three ways: the names of the gallery, the texts of the audiences. */
  const gallery = t.raw("lens.gallery") as { eyebrow: string; title: string; items: { eyebrow: string }[] }
  const wayNames = gallery.items.map((item) => splitNumbered(item.eyebrow))
  const counter = counterFit(locale)
  const voies: VoiesCopy = {
    group: gallery.eyebrow,
    ways: [
      {
        ...wayNames[0],
        audience: t("audiences.devTitle"),
        text: t("audiences.devText"),
        link: { label: t("audiences.devLink"), href: localePath(locale, "/docs"), evt: "cta:docs" },
      },
      {
        ...wayNames[1],
        audience: t("audiences.financeTitle"),
        text: t("audiences.financeText"),
        link: { label: t("audiences.financeLink"), href: localePath(locale, "/audit"), evt: "cta:audit" },
      },
      {
        ...wayNames[2],
        audience: t("audiences.agentsTitle"),
        text: t("audiences.agentsText"),
        link: { label: t("audiences.agentsLink"), href: localePath(locale, "/agents"), evt: "cta:agents" },
      },
    ],
    verdictOk: t("demo.verdictOk"),
    frames: {
      api: "API",
      apiTag: t("audiences.devTitle"),
      sheet: t("ways.sheet"),
      sheetTag: "Google Sheets",
      agent: t("ways.agent"),
      agentTag: "MCP",
    },
    sheetNote: t("integrations.items.sheets"),
    mcpNote: t("integrations.items.mcp"),
    formula: SHEETS_FORMULA[locale] ?? SHEETS_FORMULA.en,
    unit: t("ways.unit"),
    flagged: t("ways.flagged"),
    figure: t("ways.figure"),
    caption: t("ways.caption"),
    reasons: [t("demo.notAllocated", { code: "12345678" }), t("demo.checksum")],
    counter: { total: AUDIT_TIERS[0].rows, sep: counter.sep, em: counter.em },
    bankEm: BANK_FIT.em,
  }

  /* The four big figures: each read from the code or the messages. */
  const figures: { value: string; unit?: string; label: string; codes: string | null }[] = [
    { value: countries, label: t("coverage.figCountries"), codes: null },
    { value: String(registerCodes.split(",").length), label: t("coverage.figRegisters"), codes: registerCodes },
    { value: String(keyCodes.split(",").length), label: t("coverage.figKeys"), codes: keyCodes },
    { value: latency, unit: "ms", label: t("coverage.figLatency"), codes: null },
  ]

  const integrationItems = INTEGRATIONS.map((item) => {
    const external = item.href.startsWith("http")
    return {
      key: item.key,
      ...splitMention(t(`integrations.items.${item.key}`)),
      href: external ? item.href : localePath(locale, item.href),
      external,
    }
  })

  const packs = splitFrom(t("pricing.packsPrice"))

  const faq = Array.from({ length: FAQ_COUNT }, (_, i) => ({
    q: t(`faq.q${i}`),
    a: t(`faq.a${i}`, { trialWeekly: catalogue.restTrialWeekly, claimed: catalogue.claimedMonthly }),
  }))

  const fade = (delay: string) => ({ "--rv-d": delay }) as CSSProperties

  return (
    <div className="rv-page" data-landing="home-v4">
      {/* ── The cover: what it is, for whom, the two doors, the contents ────
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
              <GetKeyButton variant="amber" className={DOOR_BUTTON} evt="cta:key-hero">
                {t("hero.ctaKey")}
              </GetKeyButton>
              <Button
                size="lg"
                variant="outline"
                className={DOOR_BUTTON}
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
        <nav className="rv-grille rv-sommaire" aria-label={t("contents")}>
          <ol className="rv-sommaire__liste">
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>
                  <span className="rv-sommaire__num">{chapter.num}</span>
                  {chapter.kicker}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      {/* ── 01. Why a checksum is not enough, told by the film ────────────── */}
      <section className="rv-chap" id="mod97" aria-labelledby="home-problem">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead
            num="01"
            kicker={t("problem.eyebrow")}
            title={t("problem.title")}
            lead={t("problem.lead")}
            id="home-problem"
            large
          />
        </div>
        <RevueFilm copy={film} />
      </section>

      {/* ── 02. The same IBAN, read part by part ─────────────────────────── */}
      <section className="rv-chap" id="anatomy" aria-labelledby="home-reading">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead
            num="02"
            kicker={t("film.reading")}
            title={t("problem.readTitle")}
            lead={t("problem.readLead")}
            id="home-reading"
          />
          <figure className="rv-fig" data-rv="texte" style={fade(".2s")}>
            <ol className="rv-anat">
              {anatomy.map((part) => (
                <li className="rv-anat__part" key={part.code}>
                  <p className="rv-anat__val">{part.code}</p>
                  <p className="rv-kicker rv-anat__lab">{part.label}</p>
                  <p className="rv-anat__txt">{part.what}</p>
                </li>
              ))}
            </ol>
            <div className="rv-comp">
              <div className="rv-comp__col rv-comp__col--m97">
                <p className="rv-kicker rv-comp__tete">{t("problem.checksumTitle")}</p>
                <ul className="rv-comp__liste">
                  {checksumItems.map((item, i) => (
                    <li key={item}>
                      <span className="rv-comp__num" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rv-comp__col rv-comp__col--ibf">
                <p className="rv-kicker rv-comp__tete">{t("problem.addsTitle")}</p>
                <ul className="rv-comp__liste">
                  {addsItems.map((item, i) => (
                    <li key={item}>
                      <span className="rv-comp__num" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </figure>
        </div>
      </section>

      {/* ── 03. A real check, no sign-up ─────────────────────────────────── */}
      <section className="rv-chap" id="try" aria-labelledby="home-try">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead num="03" kicker={lens.eyebrow} title={lens.title} id="home-try" />
          <figure className="rv-fig">
            <RevueEssai copy={essai} playgroundHref={localePath(locale, "/playground")} />
          </figure>
        </div>
      </section>

      {/* ── 04. Three ways to use it, one scene ──────────────────────────── */}
      <section className="rv-chap" id="ways" aria-labelledby="home-ways">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead
            num="04"
            kicker={gallery.eyebrow}
            title={gallery.title}
            lead={t("audiences.lead")}
            id="home-ways"
          />
          <RevueVoies copy={voies} />
        </div>
      </section>

      {/* ── 05. Coverage and trust: figures read from the code ────────────── */}
      <section className="rv-chap" id="coverage" aria-labelledby="home-coverage">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead
            num="05"
            kicker={t("coverage.eyebrow")}
            title={t("coverage.title")}
            lead={t("coverage.lead")}
            id="home-coverage"
          />
          <figure className="rv-fig">
            <dl className="rv-chiffres" data-rv="chiffres">
              {figures.map((figure, i) => (
                <div className="rv-chiffre" key={figure.label} style={{ "--i": i } as CSSProperties}>
                  <dt className="rv-chiffre__val">
                    <span className="rv-chiffre__vi">
                      {figure.value}
                      {figure.unit && <span className="rv-chiffre__unite">{figure.unit}</span>}
                    </span>
                  </dt>
                  <dd>
                    <p className="rv-chiffre__lab">{figure.label}</p>
                    {figure.codes && (
                      <p className="rv-chiffre__pays" style={{ "--j": i === 1 ? 0 : 1 } as CSSProperties}>
                        {figure.codes.split(", ").map((country, k) => (
                          <Fragment key={country}>
                            {k > 0 && ", "}
                            <span style={{ "--k": k } as CSSProperties}>{country}</span>
                          </Fragment>
                        ))}
                      </p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="rv-colophon">
              <p className="rv-kicker">{t("coverage.fact0Title")}</p>
              <p className="rv-colophon__sources">
                {t("coverage.sources")} {refreshedOn ? t("coverage.sourcesDated", { date: refreshedOn }) : null}{" "}
                <Link className="rv-lien rv-nw" href={localePath(locale, "/sources")}>
                  <Arrow>{t("coverage.sourcesLink")}</Arrow>
                </Link>
              </p>
            </div>
            <div className="rv-integ">
              <p className="rv-kicker">{t("integrations.heading")}</p>
              <ul className="rv-integ__liste">
                {integrationItems.map((item) => (
                  <li key={item.key}>
                    <a href={item.href} {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                      <span>{item.name}</span>
                      {item.mention && (
                        <>
                          {" "}
                          <small>({item.mention})</small>
                        </>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </figure>
        </div>
      </section>

      {/* ── 06. Prices, the x402 line, the dated Swiss deadline ──────────────
          The deadline gives the month, never a countdown nor a day: an audit
          recommendation Claude-Alain let us follow on 22/09/2026 (a precision
          claim about what happens to a payment on that day is not ours to
          make), set large as in the mockup he approved on 28/09/2026. The lead
          names what applies to a key: Pro and the packs; the file audit is a
          one-off payment without a key (src/routes/audit.ts). */}
      <section className="rv-chap" id="pricing" aria-labelledby="home-pricing">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead
            num="06"
            kicker={t("pricing.eyebrow")}
            title={t("pricing.title")}
            lead={t("pricing.lead")}
            id="home-pricing"
          />
          <figure className="rv-fig" data-rv="texte" style={fade(".2s")}>
            <div className="rv-prix">
              <div className="rv-formule">
                <p className="rv-kicker rv-formule__nom">{t("pricing.tryName")}</p>
                <p className="rv-formule__prix">{t("pricing.tryPrice")}</p>
                <p className="rv-formule__txt">
                  <ApiText text={t("pricing.tryText", { trialWeekly: catalogue.restTrialWeekly })} />{" "}
                  <a className="rv-lien rv-nw" href="#try" data-evt="cta:try-pricing">
                    {t("pricing.tryCta")}
                    <span className="rv-fl" aria-hidden="true">
                      {"↑"}
                    </span>
                  </a>
                </p>
              </div>
              <div className="rv-formule rv-formule--cle">
                <p className="rv-kicker rv-formule__nom">{t("pricing.keyName")}</p>
                <p className="rv-formule__prix">{t("pricing.keyPrice")}</p>
                <p className="rv-formule__txt">{t("pricing.keyText", { claimed: catalogue.claimedMonthly })}</p>
                <GetKeyButton variant="amber" size="default" className={`rv-formule__cta ${PRICE_BUTTON}`} evt="cta:key-pricing">
                  {t("pricing.keyCta")}
                </GetKeyButton>
              </div>
              <div className="rv-formule">
                <p className="rv-kicker rv-formule__nom">{t("pricing.proName")}</p>
                <p className="rv-formule__prix">
                  <BebasFigure text={t("pricing.proPrice")} />
                  <small>{t("pricing.proUnit")}</small>
                </p>
                <p className="rv-formule__txt">
                  {t("pricing.proText", { requests: formatGrouped(PRO_MONTHLY_UNITS, locale) })}{" "}
                  <Link className="rv-lien rv-nw" href={localePath(locale, "/pricing")} data-evt="cta:pricing-pro">
                    <Arrow>{t("pricing.proCta")}</Arrow>
                  </Link>
                </p>
              </div>
              <div className="rv-formule">
                <p className="rv-kicker rv-formule__nom">{t("pricing.packsName")}</p>
                <p className="rv-formule__prix">
                  {packs.from && <small className="rv-formule__des">{packs.from}</small>}
                  <BebasFigure text={packs.amount} />
                </p>
                <p className="rv-formule__txt">
                  {t("pricing.packsText")}{" "}
                  <Link className="rv-lien rv-nw" href={localePath(locale, "/pricing")} data-evt="cta:pricing-packs">
                    <Arrow>{t("pricing.packsCta")}</Arrow>
                  </Link>
                </p>
              </div>
              <div className="rv-formule rv-formule--audit">
                <p className="rv-kicker rv-formule__nom">{t("pricing.auditName")}</p>
                <p className="rv-formule__txt">{t("pricing.auditText")}</p>
                <p className="rv-formule__montants">
                  {AUDIT_TIERS.map((tier) => (
                    <span className="rv-formule__montant" key={tier.price}>
                      <b>
                        <BebasFigure text={formatUsd(tier.price, locale)} />
                      </b>
                      <span>{t("pricing.auditUpTo", { rows: formatGrouped(tier.rows, locale) })}</span>
                    </span>
                  ))}
                </p>
                <p className="rv-formule__cta">
                  <Link className="rv-lien" href={localePath(locale, "/audit")} data-evt="cta:audit-pricing">
                    <Arrow>{t("audiences.financeLink")}</Arrow>
                  </Link>
                </p>
              </div>
            </div>
            <p className="rv-prix__note">
              {t("pricing.agents")}{" "}
              <Link className="rv-lien rv-nw" href={localePath(locale, "/pricing")} data-evt="cta:pricing">
                {t("pricing.link")}
              </Link>
            </p>
            <div className="rv-echeance">
              <p className="rv-echeance__date">{t("deadline.window")}</p>
              <p className="rv-echeance__lab">{t("deadline.windowLabel")}</p>
              <p className="rv-echeance__txt">
                <ApiText text={t("deadline.check")} />{" "}
                <Link
                  className="rv-lien rv-nw"
                  href={localePath(locale, "/docs/structured-addresses")}
                  data-evt="cta:rules"
                >
                  <Arrow>{t("deadline.cta")}</Arrow>
                </Link>
              </p>
            </div>
          </figure>
        </div>
      </section>

      {/* ── 07. Questions ────────────────────────────────────────────────── */}
      <section className="rv-chap" id="faq" aria-labelledby="home-faq">
        <div className="rv-grille rv-chap__corps">
          <ChapterHead num="07" title={t("faq.title")} id="home-faq" />
          <div className="rv-fig rv-faq" data-rv="texte" style={fade(".2s")}>
            {faq.map((item) => (
              <details className="rv-faq__item" key={item.q}>
                <summary className="rv-faq__q">{item.q}</summary>
                <div className="rv-faq__r">
                  <p>
                    <ApiText text={item.a} />
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── The ending: the verdict again, then the free key ─────────────── */}
      <section className="rv-fin" aria-labelledby="home-final">
        <div className="rv-grille rv-fin__grille">
          <i className="rv-filet" data-rv="filet" aria-hidden="true" />
          <div className="rv-fin__titre-bloc">
            <p className="rv-fin__preuve" data-rv="texte">
              <span className="rv-fin__iban">
                DE65 <span className="rv-fin__raye">1234 5678</span> 0532 0130 00
              </span>
              <span className="rv-fin__verdict">{film.stopLines.join(" ")}</span>
            </p>
            <FinTitle locale={locale} text={t("cta.title")} id="home-final" />
          </div>
          <div className="rv-fin__action" data-rv="texte" style={fade(".4s")}>
            <p className="rv-fin__chapeau">{t("cta.text")}</p>
            <div className="rv-boutons">
              <GetKeyButton variant="amber" className={DOOR_BUTTON} evt="cta:key-final">
                {t("cta.getKey")}
              </GetKeyButton>
            </div>
            <p className="rv-fin__doc">
              <Link className="rv-lien" href={localePath(locale, "/docs")} data-evt="cta:docs-final">
                <Arrow>{t("cta.docs")}</Arrow>
              </Link>
            </p>
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
