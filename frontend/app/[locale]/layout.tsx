import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { routing } from "@/i18n/routing";
import { ConditionalShell } from "@/components/conditional-shell";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebAPI",
  name: "IBANforge",
  description:
    "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  url: "https://ibanforge.com",
  documentation: "https://ibanforge.com/docs",
  provider: { "@type": "Organization", name: "IBANforge" },
  offers: {
    "@type": "Offer",
    price: "0.003",
    priceCurrency: "USD",
    description: "Pay per call — from $0.003/request",
  },
};

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ogLocale =
    locale === "fr" ? "fr_FR" : locale === "de" ? "de_DE" : "en_US";
  return {
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: `https://ibanforge.com/${locale}`,
      siteName: "IBANforge",
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          <NextIntlClientProvider>
            <ConditionalShell>{children}</ConditionalShell>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
