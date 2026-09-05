import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuditDoneClient } from "@/components/audit-done-client";
import { ClientMessages } from "@/components/client-messages"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "audit" });
  return { title: t("done.metaTitle"), robots: { index: false, follow: false } };
}

export default async function AuditDonePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <ClientMessages ns={["audit"]}><AuditDoneClient locale={locale} /></ClientMessages>
    </div>
  );
}
