import Link from "next/link"
import { Separator } from "@/components/ui/separator"

const columns = [
  {
    title: "Product",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/playground", label: "Playground" },
      { href: "/pricing", label: "Pricing" },
      { href: "/compare", label: "Compare" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "https://github.com/cammac-creator/ibanforge", label: "GitHub", external: true },
      { href: "/docs/mcp", label: "MCP" },
      { href: "https://ibanforge-production.up.railway.app/health", label: "API Status", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "https://opensource.org/licenses/MIT", label: "MIT License", external: true },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Top section */}
        <div className="py-10 grid grid-cols-2 gap-8 sm:grid-cols-3">
          {/* Logo column */}
          <div className="col-span-2 sm:col-span-1">
            <Link href="/" className="font-bold font-mono text-primary">
              IBANforge
            </Link>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-48">
              IBAN validation &amp; BIC/SWIFT lookup API with x402 micropayments.
            </p>
          </div>

          {/* Nav columns */}
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
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
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

        {/* Copyright */}
        <div className="py-5 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} IBANforge. Released under the MIT License.
          </p>
          <p className="text-xs text-muted-foreground">
            Built with{" "}
            <span className="text-primary font-medium">Next.js</span> &amp;{" "}
            <span className="text-primary font-medium">shadcn/ui</span>
          </p>
        </div>
      </div>
    </footer>
  )
}
