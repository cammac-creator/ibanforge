import { NextResponse } from "next/server"

/**
 * Where the Content-Security-Policy-Report-Only reports land.
 *
 * Audit 2026-09-05 (n° 31): the policy shipped in report-only mode since the
 * 2026-09-01 audit with no `report-uri`, so browsers had nowhere to send what
 * they would have blocked, and the planned "read the reports, then enforce"
 * step could never start. This route accepts both report formats (the legacy
 * `application/csp-report` body and the Reporting API's `reports+json` array),
 * keeps one compact line per violation in the function logs, and answers 204.
 *
 * Nothing is stored beyond the logs and nothing identifies the visitor: the
 * user agent is reduced to its family, the document URL to its path.
 */

export const runtime = "nodejs"

const MAX_BODY = 32_768

/**
 * Two guards added after the adversarial review of 07/09/2026 (F7): the route
 * is unauthenticated by nature (browsers post here on their own) and it was
 * unbounded, so a forged stream could fill the function logs and drown the real
 * reports before the 05/10 reading. Per-address budget, in memory and per
 * instance like the playground limiter; and a report is kept only when it
 * concerns a page of ours — the document URL is the one field a browser always
 * fills.
 */
const REPORTS_PER_MINUTE = 30
const recentReports = new Map<string, number[]>()
const OUR_HOSTS = /(^|\.)ibanforge\.com$|\.vercel\.app$|^localhost$/i

function reporterKey(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim()
  if (real) return real
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean)
  return parts[parts.length - 1] || "unknown"
}

function withinBudget(key: string, now = Date.now()): boolean {
  const floor = now - 60_000
  for (const [k, times] of recentReports) {
    const kept = times.filter((t) => t > floor)
    if (kept.length) recentReports.set(k, kept)
    else recentReports.delete(k)
  }
  const times = recentReports.get(key) ?? []
  if (times.length >= REPORTS_PER_MINUTE) return false
  times.push(now)
  recentReports.set(key, times)
  return true
}

function aboutOurPage(r: Record<string, unknown>): boolean {
  const doc = r["document-uri"] ?? r["documentURL"]
  if (typeof doc !== "string") return false
  try {
    return OUR_HOSTS.test(new URL(doc).hostname)
  } catch {
    return false
  }
}

interface LegacyReport {
  "csp-report"?: Record<string, unknown>
}
interface ReportingApiEntry {
  type?: string
  url?: string
  body?: Record<string, unknown>
}

function pick(r: Record<string, unknown>) {
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).slice(0, 300) : undefined)
  return {
    directive: s("effective-directive") ?? s("effectiveDirective") ?? s("violated-directive"),
    blocked: s("blocked-uri") ?? s("blockedURL"),
    document: pathOnly(s("document-uri") ?? s("documentURL")),
    source: s("source-file") ?? s("sourceFile"),
    line: r["line-number"] ?? r["lineNumber"],
    sample: s("script-sample") ?? s("sample"),
  }
}

function pathOnly(u?: string) {
  if (!u) return undefined
  try {
    return new URL(u).pathname
  } catch {
    return u.slice(0, 120)
  }
}

function uaFamily(ua: string | null) {
  if (!ua) return "unknown"
  if (/Firefox\//.test(ua)) return "firefox"
  if (/Edg\//.test(ua)) return "edge"
  if (/Chrome\//.test(ua)) return "chrome"
  if (/Safari\//.test(ua)) return "safari"
  return "other"
}

export async function POST(req: Request) {
  if (!withinBudget(reporterKey(req))) return new NextResponse(null, { status: 429 })
  const text = await req.text()
  if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 })
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  const ua = uaFamily(req.headers.get("user-agent"))
  const entries: Record<string, unknown>[] = []
  if (Array.isArray(parsed)) {
    for (const e of parsed as ReportingApiEntry[]) {
      if (e && e.type === "csp-violation" && e.body) entries.push({ ...e.body, documentURL: e.url })
    }
  } else if (parsed && typeof parsed === "object" && (parsed as LegacyReport)["csp-report"]) {
    entries.push((parsed as LegacyReport)["csp-report"] as Record<string, unknown>)
  }
  for (const e of entries.filter(aboutOurPage).slice(0, 20)) {
    console.warn("[csp-report]", JSON.stringify({ ua, ...pick(e) }))
  }
  return new NextResponse(null, { status: 204 })
}
