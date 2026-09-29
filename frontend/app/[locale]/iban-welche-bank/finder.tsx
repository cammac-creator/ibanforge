"use client"

import Link from "next/link"
import { useId, useMemo, useState } from "react"
import { ArrowRight, CircleAlert, CircleCheck, Info } from "lucide-react"
import {
  FINDER_LAYOUT,
  fillTemplate,
  readBankCode,
  type FinderRegisters,
  type FinderResult,
} from "@/lib/iban-bank-finder"
import type { FinderCopy } from "./copy"

/**
 * The box that reads the bank code of an IBAN, in the browser.
 *
 * 🚨 What this component must never do, and `page-data.test.ts` reads its
 * source to hold it:
 *  - send anything: no fetch, no beacon, no `data-evt` (the site's click beacon
 *    reads that attribute), no <form> (a GET form would put the whole IBAN,
 *    account number included, in a URL and in the server logs);
 *  - prefetch the page of a code: a prefetched link is a request made before
 *    any click, and the Austrian pages ask the API, under a per-visitor cap;
 *  - format with Intl or toLocale* (rule 8 of AGENTS.md).
 * The input has no `name`: nothing could submit it even by accident.
 */
export function IbanBankFinder({
  copy,
  registers,
  editions,
  base,
}: {
  copy: FinderCopy
  registers: FinderRegisters
  /** The editions of the two registers, already written in words by the server. */
  editions: { de: string; ch: string }
  /** The locale prefix of site paths: "" for English, "/de", "/fr". */
  base: string
}) {
  const [value, setValue] = useState("")
  const inputId = useId()
  const hintId = useId()
  const result = useMemo(() => readBankCode(value, registers), [value, registers])

  return (
    <div className="card-surface rounded-xl border p-5 sm:p-7 flex flex-col gap-4">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {copy.label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={copy.placeholder}
        aria-describedby={hintId}
        className="h-12 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 font-mono text-base tracking-wider text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-amber-500 focus-visible:ring-3 focus-visible:ring-amber-500/30"
      />
      <p id={hintId} className="text-xs text-muted-foreground leading-relaxed">
        {copy.privacy}
      </p>
      <div aria-live="polite" className="min-h-[4.5rem]">
        <FinderAnswer result={result} copy={copy} editions={editions} base={base} />
      </div>
    </div>
  )
}

function FinderAnswer({
  result,
  copy,
  editions,
  base,
}: {
  result: FinderResult
  copy: FinderCopy
  editions: { de: string; ch: string }
  base: string
}) {
  if (result.kind === "empty") {
    return <p className="text-sm text-muted-foreground font-mono">{copy.example}</p>
  }

  if (result.kind === "error") {
    const layout = result.country && result.country in FINDER_LAYOUT
      ? FINDER_LAYOUT[result.country as keyof typeof FINDER_LAYOUT]
      : null
    const text =
      result.reason === "characters"
        ? copy.errors.characters
        : result.reason === "country"
          ? copy.errors.country
          : fillTemplate(copy.errors.tooLong, { country: result.country ?? "", length: layout?.length ?? "" })
    return <Notice tone="warn" text={text} />
  }

  if (result.kind === "unsupported") {
    return (
      <div className="flex flex-col gap-2">
        <Notice tone="info" text={fillTemplate(copy.unsupported, { country: result.country })} />
        <Link
          href={`${base}/playground`}
          prefetch={false}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
        >
          {copy.unsupportedLink}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    )
  }

  if (result.kind === "partial") {
    return (
      <div className="flex flex-col gap-1.5">
        {result.checkDigits.length === 2 ? (
          <>
            <p className="text-base font-semibold text-foreground">
              {fillTemplate(copy.partialTitle, { cd: result.checkDigits })}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {fillTemplate(copy.partialBody[result.country], { needed: result.needed })}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.partialStart}</p>
        )}
      </div>
    )
  }

  // A code was read.
  const layout = FINDER_LAYOUT[result.country]
  const asOf = result.country === "DE" ? editions.de : editions.ch
  const statusText =
    result.country === "DE"
      ? result.status === "retired"
        ? copy.status.deRetired
        : result.status === "not-in-register"
          ? copy.status.deMissing
          : copy.status.deAllocated
      : result.country === "AT"
        ? copy.status.atUnchecked
        : result.status === "not-in-register"
          ? copy.status.chMissing
          : copy.status.chAllocated
  const missing = result.status === "not-in-register"
  const cd = result.checkDigits
  const checksumText =
    result.checksum === "none"
      ? copy.bareBlz
      : fillTemplate(copy.checksum[result.checksum], { cd, length: layout.length })

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm text-muted-foreground">{copy.codeName[result.country]}</span>
        <span className="font-mono text-2xl font-semibold tracking-wider text-foreground">{result.code}</span>
      </p>
      <Notice
        tone={missing ? "warn" : result.status === "allocated" ? "ok" : "info"}
        text={fillTemplate(statusText, { asOf, code: result.code })}
      />
      {result.status === "retired" && result.successor && (
        <p className="text-sm text-muted-foreground">
          {fillTemplate(copy.status.deRetiredSuccessor, { successor: result.successor })}
        </p>
      )}
      <p className={result.checksum === "fail" ? "text-sm text-amber-500" : "text-xs text-muted-foreground"}>
        {checksumText}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {result.path && (
          <Link
            href={`${base}${result.path}`}
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:text-amber-400 underline underline-offset-4"
          >
            {fillTemplate(copy.open, { code: `${copy.codeName[result.country]} ${result.code}` })}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
        {result.status === "retired" && result.successor && (
          <Link
            href={`${base}/blz/${result.successor}`}
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
          >
            {fillTemplate(copy.openSuccessor, { successor: result.successor })}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  )
}

function Notice({ tone, text }: { tone: "ok" | "warn" | "info"; text: string }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "warn" ? CircleAlert : Info
  const color = tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : "text-sky-400"
  return (
    <p className="flex gap-2 text-sm text-foreground/90 leading-relaxed">
      <Icon className={`size-4 shrink-0 mt-0.5 ${color}`} aria-hidden />
      <span>{text}</span>
    </p>
  )
}
