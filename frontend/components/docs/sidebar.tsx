"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Menu, X, BookOpen, Zap, Server, Landmark, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocMeta } from "@/lib/mdx";

interface DocGroup {
  labelKey: string;
  icon: React.ReactNode;
  slugs: string[];
}

const groups: DocGroup[] = [
  {
    labelKey: "gettingStarted",
    icon: <BookOpen className="size-4" />,
    slugs: ["index", "api-keys", "x402", "recipes"],
  },
  {
    labelKey: "endpoints",
    icon: <Zap className="size-4" />,
    slugs: ["iban-validate", "iban-batch", "bic-lookup", "iban-to-bic", "compliance", "ch-clearing", "vop", "structured-addresses"],
  },
  {
    labelKey: "registers",
    icon: <Landmark className="size-4" />,
    slugs: ["swiss-qr-iban", "blz-check", "at-bank-codes", "be-bank-codes", "fi-bank-codes"],
  },
  {
    labelKey: "advanced",
    icon: <Server className="size-4" />,
    slugs: ["mcp", "errors", "data-sources"],
  },
];

/** Ties the floating toggle's `aria-controls` to the drawer it opens. */
const DOCS_DRAWER_ID = "docs-mobile-nav"

export function DocsSidebar({ docs }: { docs: DocMeta[] }) {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("docs");
  const [mobileOpen, setMobileOpen] = useState(false);

  function getHref(slug: string) {
    return slug === "index" ? `/${locale}/docs` : `/${locale}/docs/${slug}`;
  }

  function isActive(slug: string) {
    if (slug === "index") {
      return pathname === `/${locale}/docs` || pathname === `/${locale}/docs/`;
    }
    return pathname === `/${locale}/docs/${slug}`;
  }

  const docsBySlug = new Map(docs.map((d) => [d.slug, d]));

  // Any doc not claimed by a group above still gets rendered: three pages
  // (vop, data-sources, iban-to-bic) shipped invisible because this list was
  // hard-coded and nobody remembered it. Never again.
  const claimed = new Set(groups.flatMap((g) => g.slugs));
  const orphans = docs.filter((d) => !claimed.has(d.slug));
  const renderedGroups: DocGroup[] = orphans.length
    ? [...groups, { labelKey: "more", icon: <FileText className="size-4" />, slugs: orphans.map((d) => d.slug) }]
    : groups;

  const sidebarContent = (
    <nav className="space-y-6">
      {renderedGroups.map((group) => (
        <div key={group.labelKey}>
          <div className="flex items-center gap-2 px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.icon}
            {t(`groups.${group.labelKey}`)}
          </div>
          <ul className="space-y-0.5">
            {group.slugs.map((slug) => {
              const doc = docsBySlug.get(slug);
              if (!doc) return null;
              const active = isActive(slug);
              return (
                <li key={slug}>
                  <Link
                    href={getHref(slug)}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-opacity",
                        active ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {doc.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        className="lg:hidden fixed bottom-4 right-4 z-50 flex items-center justify-center size-12 rounded-full bg-primary text-primary-foreground shadow-lg"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={t("sidebar.toggleNav")}
        // Audit 2026-09-01 (WEB-09): nothing linked this button to the drawer
        // it opens, nor said whether the drawer was open.
        aria-expanded={mobileOpen}
        aria-controls={DOCS_DRAWER_ID}
      >
        {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* The mobile drawer.

          Closed, it was only pushed off-screen with `-translate-x-full`: its
          twenty-odd doc links stayed focusable and readable by a screen reader
          on every documentation page, so tabbing through an article walked into
          a navigation nobody could see (WEB-09, audit 2026-09-01). `inert`
          takes the subtree out of the tab order and out of the accessibility
          tree without touching the slide transition. */}
      <aside
        id={DOCS_DRAWER_ID}
        inert={!mobileOpen}
        aria-hidden={!mobileOpen}
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-40 w-72 bg-background border-r border-border p-6 pt-20 transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>

      <aside className="hidden lg:block w-64 shrink-0 border-r border-border">
        <div className="sticky top-14 p-6 max-h-[calc(100vh-3.5rem)] overflow-y-auto">
          {sidebarContent}
        </div>
      </aside>
    </>
  );
}
