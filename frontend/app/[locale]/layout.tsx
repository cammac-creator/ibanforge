import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Inter, JetBrains_Mono, Bebas_Neue } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { routing } from "@/i18n/routing";
import { ConditionalShell } from "@/components/conditional-shell";
import { JsonLd } from "@/components/json-ld";
import { ApiKeyDialogProvider } from "@/components/api-key-dialog";
import { ogImageFor, urlFor } from "@/lib/seo";
import { LAYOUT_CLIENT_MESSAGES, pickMessages } from "@/lib/messages-pick";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// The forge identity: Bebas for the caps (display titles). The lockup's
// lowercase "forge" was Oswald 500 until 2026-09-05; it is traced into
// components/brand-wordmark.tsx now, and Oswald is not loaded any more.
const bebas = Bebas_Neue({
  weight: "400",
  variable: "--font-bebas",
  subsets: ["latin"],
});

/**
 * The three locales are known at build time: with `setRequestLocale` below,
 * every page that reads no request data is rendered once and served by the
 * CDN. Until 2026-09-05 (audit n° 1) the whole site was rendered on each
 * visit (`cache-control: no-store`), the home included.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Only those three values exist for [locale], and the `hasLocale` guard in the
 * layout body below turns any other first segment (`/icon-512.png`,
 * `/foo.txt`, paths the middleware leaves alone because of their dot) into a
 * 404 before a page runs: the home used to render with locale "icon-512.png",
 * hand it to Intl.NumberFormat and answer 500 (measured on 2026-09-05).
 *
 * Until 2026-09-06 that guard was `dynamicParams = false` here instead. It did
 * the job for the locale — and silently cascaded onto every dynamic segment
 * underneath: a `[code]` page declaring `dynamicParams = true` and rendering
 * the long tail of a register on demand was still answered 404 for any code
 * outside its `generateStaticParams`, with a NoFallbackError under `next
 * start` and a plain 404 on Vercel (`/fr/at/18170`, `/fr/be/001`,
 * `/fr/blz/10020890`, `/fr/iid/4835` measured live on 2026-09-06, the same day
 * the sitemap started listing all of them). `true` is the default and is left
 * explicit so the next reader does not put the `false` back for the locale's
 * sake: the locale is guarded by `hasLocale`, not by this flag.
 */
export const dynamicParams = true;

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

const META_BY_LOCALE = {
  // Audit 2026-09-05 (n° 14): the search snippet promised an "API for AI
  // agents" while the fold speaks to invoicing software before the November
  // 2026 deadlines. One promise now, the fold's; no figure typed by hand.
  en: {
    title: "IBANforge — IBAN, BIC & Swiss clearing API for invoicing tools",
    description:
      "IBAN, BIC, SIX Swiss clearing and sanctions in one request: the data invoicing software must serve before 14 November 2026. REST, SDKs, MCP. Free: 200 requests a month.",
    ogLocale: "en_US",
    alternates: { fr: "fr", de: "de" },
  },
  fr: {
    title: "IBANforge — API IBAN, BIC et clearing suisse pour éditeurs",
    description:
      "IBAN, BIC, clearing suisse SIX et sanctions en une requête : les données que les logiciels de facturation doivent servir avant le 14 novembre 2026. REST, SDK, MCP. Gratuit : 200 requêtes par mois.",
    ogLocale: "fr_FR",
    alternates: { en: "en", de: "de" },
  },
  de: {
    title: "IBANforge — API für IBAN, BIC und Schweizer Clearing",
    description:
      "IBAN, BIC, SIX-Clearing und Sanktionen in einer Anfrage: die Daten, die Rechnungssoftware vor dem 14. November 2026 liefern muss. REST, SDKs, MCP. Gratis: 200 Anfragen pro Monat.",
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

  const canonicalUrl = urlFor(locale);

  return {
    title: { default: meta.title, template: "%s | IBANforge" },
    description: meta.description,
    // ⚠️ No `alternates` here, deliberately, since the audit of 2026-09-01.
    //
    // A layout's metadata is inherited by every page below it, and a canonical
    // URL is the one field that must never be: this block used to hand the
    // locale HOME's URL to all 170 pages, so 52 of them declared another page
    // as their canonical version and 18 named `https://ibanforge.com`, which
    // answers 307. The layout cannot know the path it is wrapping, so the only
    // place the truth exists is the page itself.
    //
    // Every page therefore declares its own via `alternatesFor(locale, path)`
    // from `lib/seo.ts`, which returns the canonical and the hreflang set
    // together so one cannot be shipped without the other (WEB-01, WEB-02).
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
      // Named here since 2026-09-05: the image Next attaches on its own keeps
      // the /en/ segment path, which now only answers a redirect.
      images: [ogImageFor(locale)],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [ogImageFor(locale).url],
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      // `dark` rendered here, not only by next-themes' script: without JS the
      // header and the buttons used to come out light on a coal page (n° 27).
      className={`${inter.variable} ${jetbrainsMono.variable} ${bebas.variable} h-full dark`}
      suppressHydrationWarning
    >
      <head>
        <JsonLd />
        <link rel="alternate" type="application/rss+xml" title="IBANforge — blog & releases" href="/rss.xml" />
        <link rel="alternate" type="application/atom+xml" title="IBANforge — blog & releases" href="/atom.xml" />
        {/* PE-safe motion: mark that JS is available before first paint so the
            Reveal hidden state only applies with JS on (see globals.css .js). */}
        <script
          dangerouslySetInnerHTML={{
            // A class on <html> is React's to manage: after a hydration error
            // React re-renders the root and resets className, and every rule
            // keyed on `html.js` silently dies (seen in Safari, 2026-09-04).
            // The attribute is outside React's props and survives.
            __html: "document.documentElement.setAttribute('data-js','');document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          {/* Only what the client components of the shell read (n° 3):
              the whole catalogue used to be serialised into every page. */}
          <NextIntlClientProvider locale={locale} messages={pickMessages(messages, LAYOUT_CLIENT_MESSAGES)}>
            <ApiKeyDialogProvider>
              <ConditionalShell>{children}</ConditionalShell>
            </ApiKeyDialogProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
