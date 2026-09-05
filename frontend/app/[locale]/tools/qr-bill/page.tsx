import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { QrBillClient } from "@/components/qr-bill-client";
import { ClientMessages } from "@/components/client-messages"
import { alternatesFor } from "@/lib/seo";
import { localePath } from "@/lib/locale-path";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "qrBill" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(locale, "/tools/qr-bill"),
  };
}

export default async function QrBillPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("qrBill");

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
        <p className="text-sm text-muted-foreground max-w-prose">
          {t("deadline")}{" "}
          <Link href={localePath(locale, '/docs/swiss-qr-iban')} className="underline">
            {t("docsLink")}
          </Link>
        </p>
      </header>

      <ClientMessages ns={["qrBill"]}><QrBillClient /></ClientMessages>

      <section className="text-sm text-muted-foreground leading-relaxed flex flex-col gap-2">
        <h2 className="font-semibold text-foreground">{t("api.title")}</h2>
        <p>{t("api.text")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{`curl -s -X POST https://api.ibanforge.com/v1/ch/qr-bill/check \\
  -H "Content-Type: application/json" \\
  -d '{"payload":"SPC\\n0200\\n1\\nCH4431999123000889012\\nS\\n..."}'`}</pre>
        <p>{t("api.mcp")}</p>
      </section>
    </div>
  );
}
