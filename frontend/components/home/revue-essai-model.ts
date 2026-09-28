import { lensResponse, record } from "@/components/lens/response"

/*
 * What the trial of chapter 03 says about a real answer of the API: three
 * lines (format, bank, BIC) and a verdict, in the words the site already uses
 * (home.lens.hero, home.demo, playground.verdict), read through the verdict the
 * playground shares (lensResponse, lib/playground-verdict.ts): a valid format
 * never confirms a bank, and an absence from a partial source never becomes a
 * refusal. The source, its date and every credit or reservation received
 * travel with the answer, in full.
 *
 * Pure and client-safe: strings only, no Intl, no module of the API.
 */

export type EssaiCopy = {
  label: string
  submit: string
  loading: string
  examplesLabel: string
  examples: [string, string, string, string]
  note: string
  rows: { format: string; bank: string; bic: string }
  waiting: { format: string; bank: string; bic: string }
  edited: string
  unavailable: string
  rateLimited: string
  playground: string
  valid: string
  checksum: string
  structureInvalid: string
  /** "Code {code} confirmed", the code set apart as code. */
  confirmed: string
  /** "Code {code} not allocated". */
  notAllocated: string
  noBank: string
  skipped: string
  notProvided: string
  status: { verified: string; matched: string; retired: string; ambiguous: string; unknown: string }
  verdictOk: string
  verdictStop: string
  verdictFix: string
  noteOk: string
  noteStop: string
  noteFix: string
  fixStructure: string
  checkBank: string
  localCheckInvalid: string
}

type Words = Record<string, string>

/**
 * The trial's words, from the messages as they are stored: the tester's
 * (home.lens.hero), the film's verdicts (home.demo) and the verdict the
 * playground shares (playground.verdict). None of them takes an argument but
 * the two « Code {code} » lines, which keep their placeholder for the answer.
 */
export function essaiCopy(lens: Words, demo: Words, verdict: Words): EssaiCopy {
  return {
    label: lens.inputLabel,
    submit: lens.submit,
    loading: lens.loading,
    examplesLabel: lens.examples,
    examples: [lens.switzerland, lens.germany, lens.unallocated, lens.errorExample],
    note: lens.inputNote,
    rows: { format: lens.format, bank: lens.bank, bic: "BIC / SWIFT" },
    waiting: { format: lens.waitFormat, bank: lens.waitBank, bic: lens.waitBic },
    edited: lens.edited,
    unavailable: lens.unavailable,
    rateLimited: lens.rateLimited,
    playground: lens.playgroundLink,
    valid: demo.valid,
    checksum: demo.checksum,
    structureInvalid: verdict.structureInvalid,
    confirmed: demo.confirmed,
    notAllocated: demo.notAllocated,
    noBank: demo.noBank,
    skipped: demo.skipped,
    notProvided: verdict.notProvided,
    status: {
      verified: verdict.verified,
      matched: verdict.matched,
      retired: verdict.retired,
      ambiguous: verdict.ambiguous,
      unknown: verdict.unknown,
    },
    verdictOk: demo.verdictOk,
    verdictStop: demo.verdictStop,
    verdictFix: demo.verdictFix,
    noteOk: demo.noteOk,
    noteStop: demo.noteStop,
    noteFix: demo.noteFix,
    fixStructure: verdict.fixStructure,
    checkBank: verdict.checkBank,
    localCheckInvalid: verdict.localCheckInvalid,
  }
}

/** A line of the answer. `source` may carry a code, drawn apart in monospace. */
export type EssaiRow = {
  value: string
  tone: "texte" | "mono" | "gris" | "rouge" | "attente"
  source: { before: string; code: string | null; after: string } | null
}

export type EssaiVerdict = { tone: "ok" | "stop" | "neutre"; label: string; note: string }

export type EssaiAnswer = {
  rows: [EssaiRow, EssaiRow, EssaiRow]
  verdict: EssaiVerdict
  notices: string[]
}

/** The four examples of the tester, in the order of their buttons. */
export const ESSAI_EXAMPLES = [
  "CH10 0023 0000 0000 1234 5",
  "DE89 3704 0044 0532 0130 00",
  "DE65 1234 5678 0532 0130 00",
  "CH11 0023 0000 0000 1234 5",
] as const

/** The example shown in the field on arrival: the German bank the whole page follows. */
export const ESSAI_DEFAULT = 1

/** What travels to the relay: no spaces, capitals. */
export function essaiValue(iban: string): string {
  return iban.replace(/\s/g, "").toUpperCase()
}

/** The three lines before any answer: what each one is waiting for. */
export function essaiWaiting(copy: EssaiCopy): [EssaiRow, EssaiRow, EssaiRow] {
  return [
    { value: copy.waiting.format, tone: "attente", source: null },
    { value: copy.waiting.bank, tone: "attente", source: null },
    { value: copy.waiting.bic, tone: "attente", source: null },
  ]
}

/** "Code {code} confirmed · <register> · <date>", the code kept apart. */
function codeLine(template: string, code: string | null, tail: (string | null)[]): EssaiRow["source"] {
  const rest = tail.filter((part): part is string => !!part).map((part) => ` · ${part}`).join("")
  const [before, after = ""] = template.split("{code}")
  if (!code || !template.includes("{code}")) return { before: template.replace("{code}", code ?? ""), code: null, after: rest }
  return { before, code, after: `${after}${rest}` }
}

/** A plain source line: "<status> · <register> · <date>". */
function plainLine(parts: (string | null)[]): EssaiRow["source"] {
  const text = parts.filter((part): part is string => !!part).join(" · ")
  return text ? { before: text, code: null, after: "" } : null
}

/**
 * The answer, line by line. `payload` is the relay's JSON as it arrived;
 * anything that is not an answer of the validation (an error, a refusal of the
 * relay) returns null and the caller shows its message instead.
 */
export function essaiAnswer(payload: unknown, copy: EssaiCopy): EssaiAnswer | null {
  const body = record(payload)
  if (typeof body.valid !== "boolean") return null
  const { verdict, bic, bankName, notices } = lensResponse(body)
  const checksumFailed =
    body.error === "checksum_failed" || record(body.checks).iban_checksum === "fail"

  // Format.
  const format: EssaiRow =
    verdict.structure === "valid"
      ? { value: copy.valid, tone: "texte", source: null }
      : { value: checksumFailed ? copy.checksum : copy.structureInvalid, tone: "rouge", source: null }

  // Bank: the holder named by a source, with the source and its date.
  let bank: EssaiRow
  const status = verdict.bankStatus
  if (status === "notChecked") {
    bank = { value: copy.skipped, tone: "gris", source: null }
  } else if (status === "notAllocated") {
    bank = { value: copy.noBank, tone: "rouge", source: codeLine(copy.notAllocated, verdict.code, [verdict.source, verdict.asOf]) }
  } else if (status === "verified") {
    bank = {
      value: bankName ?? copy.status.verified,
      tone: "texte",
      source: codeLine(copy.confirmed, verdict.code, [verdict.source, verdict.asOf]),
    }
  } else if (status === "matched" || status === "retired" || status === "ambiguous") {
    bank = {
      value: bankName ?? copy.status[status],
      tone: "texte",
      source: plainLine([copy.status[status], verdict.source, verdict.asOf]),
    }
  } else {
    bank = { value: copy.status.unknown, tone: "gris", source: plainLine([verdict.source, verdict.asOf]) }
  }

  // BIC: only for a valid IBAN whose bank code is not denied (lensResponse). Its
  // source is said once: when it is the register the bank line already names,
  // with the same date, the line stays short.
  const sameSource = verdict.bicSource === verdict.source && verdict.bicAsOf === verdict.asOf
  const bicRow: EssaiRow = bic
    ? { value: bic, tone: "mono", source: sameSource ? null : plainLine([verdict.bicSource, verdict.bicAsOf]) }
    : {
        value: verdict.structure !== "valid" || status === "notAllocated" ? copy.skipped : copy.notProvided,
        tone: "gris",
        source: null,
      }

  // The verdict: the three of the film where the answer licenses them, the
  // shared next step everywhere else.
  let result: EssaiVerdict
  if (verdict.structure !== "valid") {
    result = { tone: "stop", label: copy.verdictFix, note: checksumFailed ? copy.noteFix : copy.fixStructure }
  } else if (status === "notAllocated") {
    result = { tone: "stop", label: copy.verdictStop, note: copy.noteStop }
  } else if (verdict.localCheckInvalid) {
    result = { tone: "stop", label: copy.verdictStop, note: copy.localCheckInvalid }
  } else if (status === "verified") {
    result = { tone: "ok", label: copy.verdictOk, note: copy.noteOk }
  } else {
    result = { tone: "neutre", label: copy.status[status === "notChecked" ? "unknown" : status], note: copy.checkBank }
  }

  return { rows: [format, bank, bicRow], verdict: result, notices }
}
