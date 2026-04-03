"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Menu, X, BookOpen, Zap, Server } from "lucide-react";
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
    slugs: ["index", "x402"],
  },
  {
    labelKey: "endpoints",
    icon: <Zap className="size-4" />,
    slugs: ["iban-validate", "iban-batch", "bic-lookup"],
  },
  {
    labelKey: "advanced",
    icon: <Server className="size-4" />,
    slugs: ["mcp", "errors"],
  },
];

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

  const sidebarContent = (
    <nav className="space-y-6">
      {groups.map((group) => (
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
        className="lg:hidden fixed bottom-4 right-4 z-50 flex items-center justify-center size-12 rounded-full bg-primary text-primary-foreground shadow-lg"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={t("sidebar.toggleNav")}
      >
        {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
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
