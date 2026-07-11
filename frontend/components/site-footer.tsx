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
        { href: `/${locale}/changelog`, label: t("link.changelog") },
        { href: "mailto:support@ibanforge.com", label: t("link.support"), external: true },
      ],
    },
    {
      title: t("column.legal"),
      links: [
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
        <div className="py-10 grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <Link href={`/${locale}`} className="font-bold font-mono text-primary">
              IBANforge
            </Link>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-52">
              {t("tagline")}
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {col.title}
              </h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      target={"external" in link ? "_blank" : undefined}
                      rel={"external" in link ? "noopener noreferrer" : undefined}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
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

        <div className="py-5 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
          <p className="text-xs font-mono text-muted-foreground">
            {t("dataLine")}
          </p>
        </div>
      </div>
    </footer>
  )
}
