/**
 * The response the fold plays back, reduced to the lines a buyer reads.
 *
 * `/v1/iban/validate` answers with a dozen top-level keys. The fold demo is
 * not the playground: it has one job, proving in a glance that the API
 * works, is fast, and returns DEPTH — the bank behind the number and the
 * Swiss clearing block, which is what sells against a free mod-97 check.
 * So the payload is projected onto a fixed, ordered subset, each top-level
 * key on one line, nested objects inlined. Anything the API did not send is
 * simply absent; nothing is invented to fill a slot.
 *
 * Pure and framework-free so it can be tested against the captured payload
 * the playground ships (playground/examples.ts) and against a live answer.
 */

export interface Token {
  text: string
  /** k = key, s = string, n = number / boolean / null; undefined = punctuation */
  cls?: "k" | "s" | "n"
}

export type Line = Token[]

type Obj = Record<string, unknown>

/** Top-level keys in reading order, with the sub-keys kept for objects. */
const SHAPE: Array<[key: string, sub?: string[]]> = [
  ["valid"],
  ["country", ["code", "name"]],
  ["bic", ["code", "bank_name", "city"]],
  ["clearing", ["iid", "sic", "eurosic", "instant_payments_chf", "qr_iid"]],
  ["sepa", ["member", "schemes"]],
  ["issuer", ["type"]],
  ["risk_indicators", ["country_risk", "sepa_reachable"]],
  ["processing_ms"],
]

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function scalar(v: unknown): Token[] {
  if (typeof v === "string") return [{ text: JSON.stringify(v), cls: "s" }]
  if (typeof v === "number" || typeof v === "boolean" || v === null) {
    return [{ text: String(v), cls: "n" }]
  }
  if (Array.isArray(v)) {
    const out: Token[] = [{ text: "[" }]
    v.forEach((item, i) => {
      if (i > 0) out.push({ text: ", " })
      out.push(...scalar(item))
    })
    out.push({ text: "]" })
    return out
  }
  // An object where a scalar was expected: show it as-is, compactly.
  return [{ text: JSON.stringify(v), cls: "s" }]
}

function pair(key: string, value: unknown): Token[] {
  return [{ text: JSON.stringify(key), cls: "k" }, { text: ": " }, ...scalar(value)]
}

/**
 * The lines of the projected response, braces included. Returns only the
 * two braces when the payload carries none of the expected keys.
 */
export function responseLines(payload: unknown): Line[] {
  const src: Obj = isObj(payload) ? payload : {}
  const body: Line[] = []
  for (const [key, sub] of SHAPE) {
    if (!(key in src)) continue
    const value = src[key]
    if (sub && isObj(value)) {
      const kept = sub.filter((k) => k in value)
      if (kept.length === 0) continue
      const line: Token[] = [{ text: JSON.stringify(key), cls: "k" }, { text: ": { " }]
      kept.forEach((k, i) => {
        if (i > 0) line.push({ text: ", " })
        line.push(...pair(k, value[k]))
      })
      line.push({ text: " }" })
      body.push(line)
    } else if (!sub) {
      body.push(pair(key, value))
    }
  }
  return [
    [{ text: "{" }],
    ...body.map((line, i) => (i < body.length - 1 ? [{ text: "  " }, ...line, { text: "," }] : [{ text: "  " }, ...line])),
    [{ text: "}" }],
  ]
}

/** The server-side processing time the API reports, or null when absent. */
export function serverMs(payload: unknown): number | null {
  if (!isObj(payload)) return null
  const v = payload.processing_ms
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null
}

/** "CH1000230000000012345" → "CH10 0023 0000 0000 1234 5", the way it is printed. */
export function groupIban(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim()
}

/** A live answer is worth showing only when it is a valid IBAN with a bank behind it. */
export function isShowable(payload: unknown): payload is Obj {
  return isObj(payload) && payload.valid === true && isObj(payload.bic)
}
