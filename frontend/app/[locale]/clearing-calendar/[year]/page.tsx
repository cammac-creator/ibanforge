import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { routing } from "@/i18n/routing"
import {
  calendarFile,
  calendarYears,
  type CalendarSystem,
  dateRows,
  dayKind,
  differingDays,
  monthGrids,
  namedDay,
  stampParts,
  systemsOf,
  weekendNamedDays,
} from "@/lib/clearing-calendar"
import { formatDayWords, monthWords } from "@/lib/date-words"
import { fillTemplate } from "@/lib/iban-bank-finder"
import { localePath } from "@/lib/locale-path"
import {
  answerSentences,
  calendarCopy,
  calendarJsonLd,
  calendarMetadata,
  closedAndOpen,
  dayWords,
  ECB_HOLIDAYS_URL,
  EUROSIC_LAST_DAY,
  joinList,
  jsonLdScript,
  PSD2_URL,
  SIX_EUROSIC_URL,
  SIX_SCHEDULE_2027_URL,
  SOURCES_READ_ON,
  stampOffset,
  systemNames,
  timeWords,
} from "./page-data"

/**
 * The days SIC (Swiss francs), euroSIC (euro) and TARGET's T2 (euro) are
 * closed in a year, for a treasurer or a developer planning payments (18/11/2026).
 *
 * The answer comes first, before any <h2>, in the HTML the server sends; then
 * the days where the franc and the euro part ways, the year at a glance, the
 * dates in words, and the sources with the day each was read. Every date comes
 * from `data/clearing-calendar/{year}.json` (lib/clearing-calendar.ts); the
 * words around them come from the copy files beside this one.
 */

export const dynamicParams = false

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => calendarYears().map((year) => ({ locale, year })))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; year: string }> }): Promise<Metadata> {
  const { locale, year } = await params
  if (!calendarFile(year)) return { title: "Not Found" }
  return calendarMetadata(locale, year)
}

const linkClass = "text-amber-500 hover:text-amber-400 underline underline-offset-4"
const sourceLinkClass = "underline underline-offset-2 hover:text-foreground break-words"

/** The striped fill of a day closed in some systems only: told apart by its pattern, not by its colour alone. */
const PARTIAL_FILL = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(245, 158, 11, 0.95) 0 3px, rgba(245, 158, 11, 0.55) 3px 6px)",
}

function DayMark({ kind, holiday }: { kind: "all" | "partial" | "weekend" | "open"; holiday?: boolean }) {
  if (kind === "all") return <span className="inline-block size-4 shrink-0 rounded-[3px] bg-foreground" aria-hidden />
  if (kind === "partial") return <span className="inline-block size-4 shrink-0 rounded-[3px]" style={PARTIAL_FILL} aria-hidden />
  if (kind === "weekend") {
    return (
      <span
        className={`inline-block size-4 shrink-0 rounded-[3px] ${holiday ? "border border-dashed border-foreground/60" : ""}`}
        style={{ background: "var(--ink-3)" }}
        aria-hidden
      />
    )
  }
  return <span className="inline-block size-4 shrink-0 rounded-[3px] border border-border" aria-hidden />
}

export default async function ClearingCalendarPage({ params }: { params: Promise<{ locale: string; year: string }> }) {
  const { locale, year } = await params
  const file = calendarFile(year)
  if (!file) notFound()
  const copy = calendarCopy(locale)
  const systems = systemsOf(file)
  const differing = differingDays(file)
  const rows = dateRows(file)
  const weekendDays = weekendNamedDays(file)
  const stamp = stampParts(file.sources.six.file_created_at)
  const offset = stampOffset(file.sources.six.file_created_at)
  const readOn = formatDayWords(SOURCES_READ_ON, locale)
  const fill = (template: string, vars: Record<string, string | number> = {}) => fillTemplate(template, { year, ...vars })
  const holidayName = (day: string) => {
    const key = namedDay(year, day)
    return key ? copy.holidays[key] : ""
  }

  // The legend names only the kinds of day this year has, partial ones by their systems.
  const partialCombos = [...new Set(differing.map((day) => closedAndOpen(file, day).closed.join("+")))].map((combo) => {
    const closed = combo.split("+") as CalendarSystem[]
    const open = systems.filter((system) => !closed.includes(system))
    return fill(copy.glance.legend.partial, { closed: systemNames(closed, copy), open: systemNames(open, copy) })
  })
  const sixFileLine = fill(copy.sources.sixFile, {
    date: formatDayWords(stamp.day, locale),
    time: timeWords(stamp.time, locale),
    offset,
  })

  return (
    <div className="flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(calendarJsonLd(locale, file)) }} />

      {/* ── The question and its answer, before any <h2> ─────────────────── */}
      <section className="flex flex-col gap-5 px-4 pt-20 pb-10 sm:pt-24 max-w-3xl mx-auto w-full">
        <Badge
          variant="outline"
          className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {fill(copy.hero.eyebrow)}
        </Badge>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-balance">{fill(copy.hero.h1)}</h1>
        <div className="flex flex-col gap-3 text-base sm:text-lg text-foreground/90 leading-relaxed text-pretty">
          {answerSentences(file, locale).map((sentence) => (
            <p key={sentence.system}>{sentence.text}</p>
          ))}
          <p>{copy.hero.weekends}</p>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">{copy.hero.meaning}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {fill(copy.hero.fileLine, { date: formatDayWords(stamp.day, locale), time: timeWords(stamp.time, locale), offset })}
        </p>
      </section>

      {/* ── Where the franc and the euro part ways ───────────────────────── */}
      {differing.length > 0 && (
        <section aria-labelledby="cc-differ" className="px-4 pb-14 max-w-3xl mx-auto w-full">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 sm:p-6">
            <h2 id="cc-differ" className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
              {fill(copy.differ.heading)}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{copy.differ.intro}</p>
            <ul className="flex flex-col gap-3">
              {differing.map((day) => {
                const { closed, open } = closedAndOpen(file, day)
                return (
                  <li key={day} className="flex gap-3 items-start text-sm sm:text-base text-foreground leading-relaxed">
                    <span className="mt-1">
                      <DayMark kind="partial" />
                    </span>
                    <span>
                      {fill(copy.differ.item, {
                        day: dayWords(day, locale),
                        holiday: holidayName(day),
                        closed: systemNames(closed, copy),
                        open: systemNames(open, copy),
                      })}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ── The year at a glance ─────────────────────────────────────────── */}
      <section aria-labelledby="cc-glance" className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <h2 id="cc-glance" className="text-2xl font-semibold tracking-tight mb-2">
          {fill(copy.glance.heading)}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-5">{copy.glance.intro}</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 mb-6 text-xs sm:text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <DayMark kind="all" />
            {copy.glance.legend.all}
          </li>
          {partialCombos.map((label) => (
            <li key={label} className="flex items-center gap-2">
              <DayMark kind="partial" />
              {label}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <DayMark kind="weekend" />
            {copy.glance.legend.weekend}
          </li>
          {weekendDays.length > 0 && (
            <li className="flex items-center gap-2">
              <DayMark kind="weekend" holiday />
              {copy.glance.legend.weekendHoliday}
            </li>
          )}
          <li className="flex items-center gap-2">
            <DayMark kind="open" />
            {copy.glance.legend.open}
          </li>
        </ul>
        <div aria-hidden className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-5 sm:gap-x-6 sm:gap-y-7">
          {monthGrids(file.year).map((grid) => (
            <div key={grid.month} className="min-w-0">
              <p className="text-sm font-semibold text-foreground mb-1.5">{monthWords(grid.month, locale)}</p>
              <div className="grid grid-cols-7 gap-[3px] text-center">
                {copy.glance.weekdays.map((label, i) => (
                  <span key={`h${i}`} className="text-[10px] leading-4 text-muted-foreground">
                    {label}
                  </span>
                ))}
                {Array.from({ length: grid.offset }, (_, i) => (
                  <span key={`e${i}`} />
                ))}
                {grid.days.map((day) => {
                  const kind = dayKind(file, day)
                  const named = namedDay(year, day) !== null
                  const base = "aspect-square flex items-center justify-center rounded-[3px] text-[11px] sm:text-xs tabular-nums"
                  if (kind === "all") {
                    return (
                      <span key={day} className={`${base} bg-foreground text-background font-semibold`}>
                        {Number(day.slice(8))}
                      </span>
                    )
                  }
                  if (kind === "partial") {
                    return (
                      <span key={day} className={`${base} text-black font-bold`} style={PARTIAL_FILL}>
                        {Number(day.slice(8))}
                      </span>
                    )
                  }
                  if (kind === "weekend") {
                    return (
                      <span
                        key={day}
                        className={`${base} text-muted-foreground ${named ? "border border-dashed border-foreground/60" : ""}`}
                        style={{ background: "var(--ink-3)" }}
                      >
                        {Number(day.slice(8))}
                      </span>
                    )
                  }
                  return (
                    <span key={day} className={`${base} text-foreground/80`}>
                      {Number(day.slice(8))}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── The dates in words ───────────────────────────────────────────── */}
      <section aria-labelledby="cc-dates" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <h2 id="cc-dates" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.dates.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-5">{fill(copy.dates.intro)}</p>
        <p aria-hidden className="sm:hidden flex gap-5 text-xs text-muted-foreground mb-2">
          <span className="inline-flex items-center gap-1.5">
            <X className="size-4 text-amber-500" strokeWidth={3} />
            {copy.dates.closed}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-4" />
            {copy.dates.open}
          </span>
        </p>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--ink-4)", background: "var(--ink-2)" }}>
                <th scope="col" className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                  {copy.dates.colDay}
                </th>
                {systems.map((system) => (
                  <th key={system} scope="col" className="px-1.5 sm:px-4 py-3 text-center text-xs font-medium text-muted-foreground w-16 sm:w-32">
                    {copy.systems[system]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.day} className={i < rows.length - 1 ? "border-b" : ""} style={{ borderColor: "var(--hairline)" }}>
                  <th scope="row" className="px-3 sm:px-4 py-3 text-left font-normal align-top">
                    <span className="block font-medium text-foreground">{dayWords(row.day, locale)}</span>
                    {row.holiday && <span className="block text-xs text-muted-foreground mt-0.5">{copy.holidays[row.holiday]}</span>}
                  </th>
                  {systems.map((system) => {
                    const closed = row.closed.includes(system)
                    return (
                      <td key={system} className="px-1.5 sm:px-4 py-3 text-center align-top">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs ${
                            closed ? "text-foreground font-semibold" : "text-muted-foreground"
                          }`}
                        >
                          {closed ? (
                            <X className="size-4 text-amber-500" strokeWidth={3} aria-hidden />
                          ) : (
                            <Check className="size-4 text-muted-foreground" aria-hidden />
                          )}
                          {/* The word under the icon on a phone would widen the column past the screen. */}
                          <span className="sr-only sm:not-sr-only">{closed ? copy.dates.closed : copy.dates.open}</span>
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {weekendDays.length > 0 && (
          <p className="text-sm text-muted-foreground leading-relaxed mt-4">
            {fill(copy.dates.weekendLine, {
              days: joinList(
                weekendDays.map((day) => `${dayWords(day, locale)} (${holidayName(day)})`),
                copy,
              ),
            })}
          </p>
        )}
      </section>

      {/* ── The three systems ────────────────────────────────────────────── */}
      <section aria-labelledby="cc-systems" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="cc-systems" className="text-2xl font-semibold tracking-tight mb-6">
          {copy.cards.heading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {systems.map((system) => {
            const count = file.closed_weekdays[system]?.length ?? 0
            const code = file.sources.six.services[system]
            return (
              <article key={system} className="card-surface rounded-xl border p-5 flex flex-col gap-2">
                <h3 className="font-mono text-lg font-semibold text-foreground">{copy.systems[system]}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{copy.cards.about[system]}</p>
                <p className="text-sm font-medium text-foreground">{fill(copy.cards.closedCount, { count })}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {system === "target" ? copy.cards.rule : fill(copy.cards.service, { code: code ?? "" })}
                </p>
                {system === "eurosic" && file.year === Number(EUROSIC_LAST_DAY.slice(0, 4)) && (
                  <p className="text-xs text-foreground/90 leading-relaxed rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 mt-1">
                    {copy.cards.eurosicEnd}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      </section>

      {/* ── What it means for a transfer ─────────────────────────────────── */}
      <section aria-labelledby="cc-transfer" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <h2 id="cc-transfer" className="text-2xl font-semibold tracking-tight mb-4">
          {copy.transfer.heading}
        </h2>
        <div className="flex flex-col gap-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
          <p>{copy.transfer.t2}</p>
          <p>{copy.transfer.psd2}</p>
          <p>{copy.transfer.cutOff}</p>
        </div>
      </section>

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="cc-sources" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <h2 id="cc-sources" className="text-xl font-semibold tracking-tight mb-3">
          {copy.sources.heading}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{copy.sources.sixChanges}</p>
        <ul className="flex flex-col gap-2 text-xs sm:text-sm text-muted-foreground">
          <li>
            <a href={file.sources.six.file} rel="noopener noreferrer" className={sourceLinkClass}>
              {sixFileLine}
            </a>
          </li>
          <li>
            <a href={file.sources.six.specification} rel="noopener noreferrer" className={sourceLinkClass}>
              {copy.sources.specification}
            </a>
            {" · "}
            <a href={file.sources.six.page} rel="noopener noreferrer" className={sourceLinkClass}>
              {copy.sources.sixPage}
            </a>
            {", "}
            {fill(copy.sources.readOn, { date: readOn })}
          </li>
          {(
            [
              [SIX_SCHEDULE_2027_URL, copy.sources.sixSchedule],
              [SIX_EUROSIC_URL, copy.sources.eurosicPage],
              [file.sources.target.url, copy.sources.ecbRule],
              [ECB_HOLIDAYS_URL, copy.sources.ecbHolidays],
              [PSD2_URL, copy.sources.psd2],
            ] as const
          ).map(([href, label]) => (
            <li key={href}>
              <a href={href} rel="noopener noreferrer" className={sourceLinkClass}>
                {label}
              </a>
              {", "}
              {fill(copy.sources.readOn, { date: readOn })}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Read on ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="cc-next" className="px-4 pb-20 max-w-3xl mx-auto w-full">
        <h2 id="cc-next" className="text-xl font-semibold tracking-tight mb-3">
          {copy.next.heading}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {(
            [
              ["/iid", copy.next.iid],
              ["/iban/ch", copy.next.country],
              ["/tools", copy.next.tools],
            ] as const
          ).map(([path, label]) => (
            <li key={path}>
              <Link href={localePath(locale, path)} className={linkClass}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
