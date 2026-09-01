import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

const BASE = "https://ibanforge.com";

/**
 * Localized metadata for /live. Until 01/09/2026 this file exported one
 * English `title`/`description` and nothing else, so the route inherited the
 * locale layout's canonical (`/fr`) and Open Graph card: every share of the
 * village showed the landing page's card, `/fr/live` served an English
 * <title>, and search engines were told the page duplicates the home page.
 * Same shape as docs/[slug] and blog/[slug], which already do this right.
 * The card image is the static `opengraph-image.png` next to this file — a
 * real capture of the village mid-quest.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "live.meta" });
  const url = `${BASE}/${locale}/live`;
  const ogLocale = locale === "fr" ? "fr_FR" : locale === "de" ? "de_DE" : "en_US";
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: url,
      languages: {
        en: `${BASE}/en/live`,
        "fr-CH": `${BASE}/fr/live`,
        "de-CH": `${BASE}/de/live`,
        "x-default": `${BASE}/en/live`,
      },
    },
    openGraph: {
      type: "website",
      siteName: "IBANforge",
      locale: ogLocale,
      url,
      title: t("title"),
      description: t("description"),
    },
  };
}

export default function LiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
