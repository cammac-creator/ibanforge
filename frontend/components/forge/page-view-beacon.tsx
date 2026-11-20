"use client"

import { useEffect } from "react"

/**
 * One page view, counted by page template and day: no cookie, no identifier.
 *
 * The browser reports the view to the SITE, on its own origin (`POST /api/pv`,
 * app/api/pv/route.ts), never to the API: a direct call would put the reader's address in
 * the API's request log and in its host's journal. What travels is the pathname and the
 * locale, nothing else: no referrer, no viewport, no query string, no fragment. The route
 * files the path under a template of a closed list (`/blz/37040044` becomes `/blz/:code`),
 * keeps a count in memory and sends the API a batch, server to server
 * (frontend/lib/page-views.ts). It is PAGE VIEWS, not people: with no cookie and no
 * identifier, a reader who opens ten pages is ten views.
 *
 * From the browser only, never from the server render, so a crawler that does not run
 * scripts counts for nothing. Silent when the browser asks not to be tracked (Do Not Track,
 * Global Privacy Control) and for driven browsers and Lighthouse; the route drops what still
 * gets through from a script that names itself. Mounted once in the shell; `page` changes
 * with each navigation.
 */
function sendView(pathname: string, locale: string) {
  try {
    if (navigator.doNotTrack === "1") return
    if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return
    if (navigator.webdriver || /HeadlessChrome|Lighthouse|IBANforge-outil/i.test(navigator.userAgent)) return
    const body = JSON.stringify({
      // the pathname alone: nothing after a ? or a #
      page: pathname.split(/[?#]/)[0].slice(0, 120),
      locale,
    })
    const url = "/api/pv"
    // The site's own origin: nothing about the reader reaches another host.
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
