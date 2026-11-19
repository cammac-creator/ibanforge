"use client"

import { useEffect } from "react"

/**
 * One page view, counted by page template and day: no cookie, no identifier.
 *
 * The API files the pathname under a template of a closed list and bumps a number
 * (src/lib/page-views.ts, `page_views_daily`): `/blz/37040044` becomes `/blz/:code`,
 * and what travels is the pathname and the locale, nothing else. No referrer, no
 * viewport, no query string, no fragment. It is PAGE VIEWS, not people: with no
 * cookie and no identifier, a reader who opens ten pages is ten views.
 *
 * It goes through the same endpoint as the clicks of `cta-beacon.tsx` (Claude-Alain's
 * decision of 19 November 2026), from the browser only: never from the server render,
 * so a crawler that does not run scripts counts for nothing. It stays silent when the
 * browser asks not to be tracked (Do Not Track, Global Privacy Control) and for driven
 * browsers and Lighthouse; the API drops what still gets through from a script that
 * names itself. Mounted once in the shell; `page` changes with each navigation.
 */
const API = process.env.NEXT_PUBLIC_API_URL || "https://api.ibanforge.com"

function sendView(pathname: string, locale: string) {
  try {
    if (navigator.doNotTrack === "1") return
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return
    if (navigator.webdriver || /HeadlessChrome|Lighthouse|IBANforge-outil/i.test(navigator.userAgent)) return
    const body = JSON.stringify({
      name: "view:page",
      // the pathname alone: nothing after a ? or a #
      page: pathname.split(/[?#]/)[0].slice(0, 120),
      locale,
    })
    const url = `${API}/v1/web/events`
    // text/plain: no CORS preflight.
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) {
      void fetch(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {})
    }
  } catch {
    /* never in the way of the page */
  }
}

export function PageViewBeacon({ locale, page }: { locale: string; page: string }) {
  useEffect(() => {
    sendView(page, locale)
  }, [locale, page])
  return null
}
