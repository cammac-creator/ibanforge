import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { localePath } from "@/lib/locale-path";

/**
 * The index of the free tools (audit of 09.11.2026): `/tools` answered 404
 * while `/tools/test-iban` and `/tools/qr-bill` existed, so a reader who
 * shortened the address hit a dead end. One card per tool, each tool's own
 * description reused, nothing else.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.index" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(locale, "/tools"),
  };
}

export default async function ToolsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("tools.index");
  const testIban = await getTranslations("testIban");
  const qrBill = await getTranslations("qrBill");

  const tools = [
    { href: "/tools/test-iban", name: t("testIbanName"), body: testIban("metaDescription") },
    { href: "/tools/qr-bill", name: t("qrBillName"), body: qrBill("metaDescription") },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tools.map((tool) => (
          <li key={tool.href}>
            <Link
              href={localePath(locale, tool.href)}
              className="card-surface flex h-full flex-col gap-3 rounded-xl border p-5 sm:p-6 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500"
            >
              <span className="text-lg font-semibold text-foreground">{tool.name}</span>
              <span className="text-sm text-muted-foreground leading-relaxed flex-1">{tool.body}</span>
              <span className="inline-flex items-center gap-1.5 text-sm text-amber-500">
                {t("open")}
                <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
