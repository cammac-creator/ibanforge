import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { routing } from "@/i18n/routing";
import { ConditionalShell } from "@/components/conditional-shell";
import { JsonLd } from "@/components/json-ld";
import { ApiKeyDialogProvider } from "@/components/api-key-dialog";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

const META_BY_LOCALE = {
  en: {
    title: "IBANforge — IBAN Validation & BIC/SWIFT Lookup API for AI Agents",
    description:
      "Validate IBANs, lookup BICs/SWIFT, score compliance risk. 121K BICs across 89 countries, sanctions screening, SEPA + VoP, native MCP for AI agents, x402 micropayments. Free tier: 200 requests/month.",
    ogLocale: "en_US",
    alternates: { fr: "fr", de: "de" },
  },
  fr: {
    title: "IBANforge — API de validation IBAN & BIC/SWIFT pour agents IA",
    description:
      "Validez vos IBAN, recherchez des BIC/SWIFT, évaluez le risque de conformité. 121K codes BIC sur 89 pays, screening sanctions, SEPA + VoP, MCP natif pour agents IA, micropaiements x402. Gratuit : 200 requêtes/mois.",
    ogLocale: "fr_FR",
    alternates: { en: "en", de: "de" },
  },
  de: {
    title: "IBANforge — IBAN-Validierung & BIC/SWIFT-Lookup-API für KI-Agenten",
    description:
      "IBANs validieren, BIC/SWIFT abfragen, Compliance-Risiken bewerten. 121K BIC-Einträge in 89 Ländern, Sanktionsprüfung, SEPA + VoP, natives MCP für KI-Agenten, x402-Mikrozahlungen. Kostenlos: 200 Anfragen/Monat.",
    ogLocale: "de_DE",
    alternates: { en: "en", fr: "fr" },
  },
} as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const meta =
    META_BY_LOCALE[locale as keyof typeof META_BY_LOCALE] ?? META_BY_LOCALE.en;

  const baseUrl = "https://ibanforge.com";
  const canonicalUrl = locale === "en" ? baseUrl : `${baseUrl}/${locale}`;

  return {
    title: { default: meta.title, template: "%s | IBANforge" },
    description: meta.description,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        en: `${baseUrl}`,
        "fr-CH": `${baseUrl}/fr`,
        "de-CH": `${baseUrl}/de`,
        "x-default": `${baseUrl}`,
      },
    },
    openGraph: {
      type: "website",
      locale: meta.ogLocale,
      alternateLocale: Object.values(meta.alternates).map((l) =>
        l === "en" ? "en_US" : l === "fr" ? "fr_FR" : "de_DE",
      ),
      url: canonicalUrl,
      siteName: "IBANforge",
      title: meta.title,
      description: meta.description,
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <JsonLd />
        {/* PE-safe motion: mark that JS is available before first paint so the
            Reveal hidden state only applies with JS on (see globals.css .js). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          <NextIntlClientProvider>
            <ApiKeyDialogProvider>
              <ConditionalShell>{children}</ConditionalShell>
            </ApiKeyDialogProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
