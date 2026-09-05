"use client"

import Link from "next/link"
import { useState } from "react"
import { usePathname } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { LocaleSwitcher } from "@/components/locale-switcher"

/** Ties the hamburger's `aria-controls` to the menu it opens. */
const MOBILE_MENU_ID = "site-mobile-menu"

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations("header")
  const locale = useLocale()
  const pathname = usePathname()

  const navLinks = [
    { href: `/${locale}/agents`, label: t("nav.agents") },
    { href: `/${locale}/docs`, label: t("nav.docs") },
    { href: `/${locale}/playground`, label: t("nav.playground") },
    { href: `/${locale}/pricing`, label: t("nav.pricing") },
    { href: `/${locale}/audit`, label: t("nav.audit") },
    { href: `/${locale}/blog`, label: t("nav.blog") },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href={`/${locale}`}
          className="flex items-center gap-2.5"
        >
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word text-xl">IBAN<em>forge</em></span>
        </Link>

        {/* Desktop nav. `lg:` and not `md:` since 2026-09-05: between 768 and
            834 px (an iPad held upright) six links, the language switch and
            the key button no longer fit, and the lockup broke onto two lines. */}
        <nav className="hidden lg:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              // Without this a screen reader reads the whole menu with no way
              // to tell which entry is the page already open. The visual
              // treatment says it to everyone else; this says it to them.
              aria-current={pathname === link.href ? 'page' : undefined}
              className={`px-3 py-2 rounded-md text-sm transition-colors hover:bg-muted/50 hover:text-foreground ${
                pathname === link.href ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side — LocaleSwitcher + Dashboard + Mobile toggle */}
        <div className="flex items-center gap-2">
          <LocaleSwitcher />

          {/* Audit 2026-09-04 (S8): this was the only filled button of the bar
              and it opened the owner's password-protected console. A visitor
              clicked the most visible control of the site and hit a locked
              door. The account page is the visitor's own key. */}
          <Link
            href={`/${locale}/account`}
            className="hidden lg:inline-flex items-center h-8 px-3 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            {t("nav.account")}
          </Link>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="lg:hidden flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={t("toggleMenu")}
            // Audit 2026-09-01 (WEB-09): the button said nothing about the
            // state it controls, so a screen reader announced a plain button
            // and the menu it opened appeared out of nowhere.
            aria-expanded={mobileOpen}
            aria-controls={MOBILE_MENU_ID}
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu.

          `inert` and not `hidden`: closed, this block was merely collapsed to
          `max-h-0 opacity-0`, so its six links stayed in the tab order and
          readable by a screen reader on every page of the site — a keyboard
          user tabbing through the header fell into an invisible menu (WEB-09,
          audit 2026-09-01). `inert` removes the whole subtree from focus and
          from the accessibility tree while leaving the height transition
          intact, which `display: none` would kill. */}
      <div
        id={MOBILE_MENU_ID}
        inert={!mobileOpen}
        aria-hidden={!mobileOpen}
        className={cn(
          "lg:hidden border-t border-border overflow-hidden transition-all duration-200",
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
            href={`/${locale}/account`}
            onClick={() => setMobileOpen(false)}
            className="mt-1 px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            {t("nav.account")}
          </Link>
        </nav>
      </div>
    </header>
  )
}
