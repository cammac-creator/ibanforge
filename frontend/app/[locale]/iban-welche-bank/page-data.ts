import type { Metadata } from 'next';
import type { FinderRegisters } from '@/lib/iban-bank-finder';
import { chIidFile, deBlzFile } from '@/lib/registers';
import { alternatesFor, ogImageFor, SITE_URL, urlFor } from '@/lib/seo';
import type { WelcheBankCopy, WelcheBankLocale } from './copy';
import { COPY_DE } from './copy-de';
import { COPY_EN } from './copy-en';
import { COPY_FR } from './copy-fr';

/**
 * Everything the "Which bank does this IBAN belong to?" page shows that is not
 * prose: its path, its metadata and structured data, the compact lists the
 * finder looks codes up in, and the editions of the two registers.
 *
 * Server only: it reads the register exports from disk (lib/registers.ts). The
 * client component receives the lists as props and never imports this file.
 */

export const WELCHE_BANK_PATH = '/iban-welche-bank';

/** The article that shows the same check from Python and JavaScript. */
export const CODE_ARTICLE_PATH = '/blog/2026-09-29-german-iban-bic-python-javascript';

/** The @id of the product node the locale layout emits (components/json-ld.tsx). */
export const SOFTWARE_NODE_ID = 'https://ibanforge.com/#software';

const COPIES: Record<WelcheBankLocale, WelcheBankCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE };

export function isWelcheBankLocale(locale: string): locale is WelcheBankLocale {
  return locale === 'en' || locale === 'fr' || locale === 'de';
}

export function welcheBankCopy(locale: string): WelcheBankCopy {
  return COPIES[isWelcheBankLocale(locale) ? locale : 'en'];
}

// ─── The registers, compacted for the browser ─────────────────────────────────

/**
 * Every Bankleitzahl and every Swiss or Liechtenstein IID of the exported
 * registers, as two strings of fixed-width codes, plus the retired German codes
 * with their successor. Codes only: no name, no town, nothing of the Austrian
 * register (restricted, never in this repository).
 */
export function finderRegisters(): FinderRegisters {
  const de = deBlzFile();
  const ch = chIidFile();
  const deCodes = Object.keys(de.entries).sort();
  const deRetired: Record<string, string | null> = {};
  for (const code of deCodes) {
    const r = de.entries[code].register;
    if (r.retired) deRetired[code] = r.successor_blz;
  }
  return {
    deCodes: deCodes.join(''),
    deRetired,
    chCodes: Object.keys(ch.entries).sort().join(''),
  };
}

/** The edition of each register, as the exports carry it. */
export function registerEditions(): { de: string; ch: string } {
  const de = deBlzFile();
  const ch = chIidFile();
  const latest = (values: string[]) => values.reduce((a, b) => (b > a ? b : a), '');
  return {
    // `as_of` is the month of the Bundesbank file every row was read from.
    de: latest(Object.values(de.entries).map((e) => e.register.as_of)),
    // `valid_on` is the day the SIX BankMaster edition takes effect.
    ch: latest(Object.values(ch.entries).map((e) => e.register.valid_on)),
  };
}

// ─── Metadata and structured data ─────────────────────────────────────────────

export function welcheBankMetadata(locale: string): Metadata {
  const copy = welcheBankCopy(locale);
  const url = urlFor(locale, WELCHE_BANK_PATH);
  const og = ogImageFor(locale);
  const shareTitle = `${copy.meta.title} | IBANforge`;
  return {
    title: copy.meta.title,
    description: copy.meta.description,
    alternates: alternatesFor(locale, WELCHE_BANK_PATH),
    openGraph: {
      type: 'website',
      locale: copy.meta.ogLocale,
      url,
      siteName: 'IBANforge',
      title: shareTitle,
      description: copy.meta.description,
      images: [og],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: copy.meta.description,
      images: [og.url],
    },
  };
}

export function welcheBankJsonLd(locale: string): Record<string, unknown> {
  const copy = welcheBankCopy(locale);
  const url = urlFor(locale, WELCHE_BANK_PATH);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: copy.meta.title,
        headline: copy.hero.h1,
        description: copy.meta.description,
        inLanguage: isWelcheBankLocale(locale) ? locale : 'en',
        isPartOf: { '@type': 'WebSite', name: 'IBANforge', url: SITE_URL },
        about: { '@id': SOFTWARE_NODE_ID },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: copy.breadcrumbHome, item: urlFor(locale) },
          { '@type': 'ListItem', position: 2, name: copy.hero.h1, item: url },
        ],
      },
    ],
  };
}

/** The JSON-LD as it goes into the <script> tag, `<` escaped. */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
