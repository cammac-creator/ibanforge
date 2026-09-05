import type { AbstractIntlMessages } from "next-intl"

/**
 * The messages a client component may read, and nothing else.
 *
 * Audit 2026-09-05 (n° 3). `NextIntlClientProvider` mounted without
 * `messages` inherits the whole catalogue of the request, and React
 * serialises it into every HTML page: 148 Ko of the home's 209 Ko were the
 * translations of the pricing page, the docs, the dashboard, the blog. A
 * client component reads one namespace; the provider now carries only the
 * namespaces the client components below it actually call.
 *
 * `paths` are dotted namespaces (`home.hero.demo`). A path whose parent is
 * also listed is dropped so the parent's subtree is copied once, by
 * reference, and the source catalogue is never mutated.
 */
export function pickMessages(
  messages: AbstractIntlMessages,
  paths: readonly string[],
): AbstractIntlMessages {
  const wanted = paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(`${q}.`)))
  const out: Record<string, unknown> = {}
  for (const path of wanted) {
    const keys = path.split(".")
    let src: unknown = messages
    let dst = out
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (!src || typeof src !== "object" || !(k in (src as Record<string, unknown>))) break
      src = (src as Record<string, unknown>)[k]
      if (i === keys.length - 1) {
        dst[k] = src
      } else {
        const next = dst[k]
        if (!next || typeof next !== "object") dst[k] = {}
        dst = dst[k] as Record<string, unknown>
      }
    }
  }
  return out as AbstractIntlMessages
}

/**
 * What the locale layout's own client components read on every page: the
 * header, the footer, the shell, the key dialog and its first-call panel, the error
 * boundary, the docs sidebar, the uptime bar and the fold's terminal. Pages
 * with heavier client trees (pricing, account, audit, playground, dashboard,
 * the two tools) add their namespace through <ClientMessages>.
 */
export const LAYOUT_CLIENT_MESSAGES = [
  "header",
  "footer",
  "common",
  "apiKeyDialog",
  "errors",
  "docs",
  "monitoring",
  "home.hero.demo",
] as const
