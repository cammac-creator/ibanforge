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
        { href: `/${locale}/docs`, label: t("link.docs") },
        { href: `/${locale}/playground`, label: t("link.playground") },
        { href: `/${locale}/pricing`, label: t("link.pricing") },
        { href: `/${locale}/compare`, label: t("link.compare") },
      ],
    },
    {
      title: t("column.developers"),
      links: [
        { href: "https://github.com/cammac-creator/ibanforge", label: t("link.github"), external: true },
        { href: `/${locale}/docs/mcp`, label: t("link.mcp") },
        { href: "https://ibanforge-production.up.railway.app/health", label: t("link.apiStatus"), external: true },
      ],
    },
    {
      title: t("column.legal"),
      links: [
        { href: "https://opensource.org/licenses/MIT", label: t("link.mitLicense"), external: true },
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
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-48">
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
                  <li key={link.href}>
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
            &copy; {new Date().getFullYear()} IBANforge. {t("copyright")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("builtWith")}{" "}
            <span className="text-primary font-medium">Next.js</span> &amp;{" "}
            <span className="text-primary font-medium">shadcn/ui</span>
          </p>
        </div>
      </div>
    </footer>
  )
}
