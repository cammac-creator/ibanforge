import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { Separator } from "@/components/ui/separator"

export function SiteFooter() {
  const t = useTranslations("footer")
  const locale = useLocale()

  const columns = [
    {
      title: t("column.product"),
      links: [
        { href: `/${locale}/agents`, label: t("link.agents") },
        { href: `/${locale}/docs`, label: t("link.docs") },
        { href: `/${locale}/playground`, label: t("link.playground") },
        { href: `/${locale}/pricing`, label: t("link.pricing") },
        { href: `/${locale}/audit`, label: t("link.audit") },
        { href: `/${locale}/sheets`, label: t("link.sheets") },
        { href: `/${locale}/blz`, label: t("link.blz") },
        { href: `/${locale}/iid`, label: t("link.iid") },
        { href: `/${locale}/at`, label: t("link.at") },
        { href: `/${locale}/be`, label: t("link.be") },
        { href: `/${locale}/vendors`, label: t("link.vendors") },
        { href: `/${locale}/compare`, label: t("link.compare") },
        { href: `/${locale}/openapi`, label: t("link.openapi") },
      ],
    },
    {
      title: t("column.developers"),
      links: [
        { href: "https://github.com/cammac-creator/ibanforge", label: t("link.github"), external: true },
        { href: `/${locale}/docs/mcp`, label: t("link.mcp") },
        { href: `/${locale}/status`, label: t("link.apiStatus") },
        // Next to API Status on purpose: both answer "is it working" — one for
        // the service, one for the caller's own key. Without a link here the
        // page was reachable only from an email, so a customer who deleted it
        // had no way back and search engines had none either.
        { href: `/${locale}/account`, label: t("link.account") },
        { href: `/${locale}/changelog`, label: t("link.changelog") },
        { href: "mailto:support@ibanforge.com", label: t("link.support"), external: true },
      ],
    },
    {
      title: t("column.legal"),
      links: [
        { href: `/${locale}/sources`, label: t("link.sources") },
        { href: `/${locale}/legal/terms`, label: t("link.terms") },
        { href: `/${locale}/legal/privacy`, label: t("link.privacy") },
        { href: `/${locale}/legal/dpa`, label: t("link.dpa") },
        { href: `/${locale}/legal/imprint`, label: t("link.imprint") },
        { href: "https://github.com/cammac-creator/ibanforge", label: t("link.openSource"), external: true },
      ],
    },
  ]

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="py-8 sm:py-10 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 sm:gap-8">
          <div className="col-span-2 sm:col-span-1">
            <Link href={`/${locale}`} className="font-bold font-mono text-primary">
              IBANforge
            </Link>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-52">
              {t("tagline")}
            </p>
          </div>

          {columns.map((col, i) => (
            <div key={col.title} className={i === columns.length - 1 ? "col-span-2 sm:col-span-1" : ""}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 sm:mb-3">
                {col.title}
              </h3>
              <ul
                className={
                  i === columns.length - 1
                    ? "flex flex-wrap gap-x-4 gap-y-1.5 sm:block sm:space-y-2"
                    : "space-y-1.5 sm:space-y-2"
                }
              >
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      target={"external" in link ? "_blank" : undefined}
                      rel={"external" in link ? "noopener noreferrer" : undefined}
                      className="text-[13px] sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator />

        <div className="py-4 sm:py-5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-xs text-muted-foreground">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
          <p className="text-[11px] leading-snug sm:text-xs font-mono text-muted-foreground sm:text-right">
            {t("dataLine")}
          </p>
        </div>
      </div>
    </footer>
  )
}
