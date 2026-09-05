import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import { pickMessages } from "@/lib/messages-pick"

/**
 * Hands a client subtree the namespaces it reads, and only those.
 *
 * The locale layout's provider carries the site-wide namespaces
 * (lib/messages-pick LAYOUT_CLIENT_MESSAGES). A page whose client components
 * read their own namespace wraps them here: `common` and `apiKeyDialog` ride
 * along because the code block, the key button and the dialog appear inside
 * most of those trees.
 */
export async function ClientMessages({ ns, children }: { ns: readonly string[]; children: ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()])
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, [...ns, "common", "apiKeyDialog"])}>
      {children}
    </NextIntlClientProvider>
  )
}
