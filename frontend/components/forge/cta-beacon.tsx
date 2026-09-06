"use client"

import { useEffect } from "react"

/**
 * One line per action, no cookie, no identifier.
 *
 * Audit 2026-09-05 (n° 32): the page had six calls to action and not one
 * measurement, so nobody knew whether "try a request", "get a key" or "audit
 * a file" is the door people take. Every element that carries `data-evt`
 * sends its name on click; the film reports its first pin and its last
 * station. What travels: the event name, the page path, the locale, the
 * referring host and a width class. Nothing that identifies a person, and
 * nothing at all when the browser asks not to be tracked — or when it is not
 * a person at all (2026-09-06: driven browsers and Lighthouse stay silent).
 */
const API = process.env.NEXT_PUBLIC_API_URL || "https://api.ibanforge.com"

function send(name: string, locale: string) {
  try {
    if (navigator.doNotTrack === "1") return
    // Not a person: a driven browser (our own deployment checks, Playwright,
    // Selenium) or a Lighthouse run. Nearly every line of the first day of
    // measurement was ours. The fold demo bails on the same flag.
    if (navigator.webdriver || /HeadlessChrome|Lighthouse/i.test(navigator.userAgent)) return
    let referrer = ""
    try { referrer = document.referrer ? new URL(document.referrer).host : "" } catch { referrer = "" }
    const w = window.innerWidth
    const body = JSON.stringify({
      name,
      page: location.pathname.slice(0, 120),
      locale,
      referrer,
      viewport: w < 720 ? "phone" : w < 1024 ? "tablet" : "desktop",
    })
    const url = `${API}/v1/web/events`
    // text/plain: no CORS preflight, and sendBeacon survives the navigation
    // the click is about to cause.
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) {
      void fetch(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {})
    }
  } catch {
    /* never in the way of the click */
  }
}

export function CtaBeacon({ locale }: { locale: string }) {
  useEffect(() => {
    const once = new Set<string>()
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-evt]")
      const name = el?.getAttribute("data-evt")
      if (name) send(name, locale)
    }
    const onStation = (e: Event) => {
      const station = (e as CustomEvent<number>).detail
      const name = station === 0 ? "film:start" : station === 3 ? "film:end" : null
      if (name && !once.has(name)) { once.add(name); send(name, locale) }
    }
    document.addEventListener("click", onClick, true)
    document.addEventListener("forge:station", onStation)
    return () => {
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("forge:station", onStation)
    }
  }, [locale])
  return null
}
