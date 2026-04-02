import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { ConditionalShell } from "@/components/conditional-shell";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "IBANforge", template: "%s | IBANforge" },
  description: "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  metadataBase: new URL("https://ibanforge.com"),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://ibanforge.com",
    siteName: "IBANforge",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebAPI",
  name: "IBANforge",
  description:
    "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  url: "https://ibanforge.com",
  documentation: "https://ibanforge.com/docs",
  provider: {
    "@type": "Organization",
    name: "IBANforge",
  },
  offers: {
    "@type": "Offer",
    price: "0.003",
    priceCurrency: "USD",
    description: "Pay per call — from $0.003/request",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
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
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <ConditionalShell>{children}</ConditionalShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
