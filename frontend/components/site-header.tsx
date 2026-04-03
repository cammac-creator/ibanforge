"use client"

import Link from "next/link"
import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { LocaleSwitcher } from "@/components/locale-switcher"

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations("header")
  const locale = useLocale()

  const navLinks = [
    { href: `/${locale}/docs`, label: t("nav.docs") },
    { href: `/${locale}/playground`, label: t("nav.playground") },
    { href: `/${locale}/pricing`, label: t("nav.pricing") },
    { href: `/${locale}/blog`, label: t("nav.blog") },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href={`/${locale}`}
          className="flex items-center gap-2 font-bold text-lg tracking-tight"
        >
          <span className="text-primary font-mono">IBANforge</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side — LocaleSwitcher + Dashboard + Mobile toggle */}
        <div className="flex items-center gap-2">
          <LocaleSwitcher />

          <Link
            href={`/${locale}/dashboard`}
            className="hidden md:inline-flex items-center h-8 px-3 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            {t("nav.dashboard")}
          </Link>

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={t("toggleMenu")}
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={cn(
          "md:hidden border-t border-border overflow-hidden transition-all duration-200",
          mobileOpen ? "max-h-64 opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <nav className="flex flex-col gap-1 px-4 py-3">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href={`/${locale}/dashboard`}
            onClick={() => setMobileOpen(false)}
            className="mt-1 px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            {t("nav.dashboard")}
          </Link>
        </nav>
      </div>
    </header>
  )
}
