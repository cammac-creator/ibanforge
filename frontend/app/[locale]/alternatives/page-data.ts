import type { Metadata } from 'next';
import { formatDayWords, formatMonthWords } from '@/lib/date-words';
import { fillTemplate } from '@/lib/iban-bank-finder';
import { chIidFile, deBlzFile } from '@/lib/registers';
import { alternatesFor, ogImageFor, SITE_URL, urlFor } from '@/lib/seo';
import type { AlternativesCopy, AlternativesLocale, VendorCopy } from './copy';
import { COPY_DE } from './copy-de';
import { COPY_EN } from './copy-en';
import { COPY_FR } from './copy-fr';
import { READ_ON, VENDORS, type VendorSlug } from './vendors';

/**
 * Everything the "alternative" pages show that is not prose: paths, metadata,
 * structured data, and the placeholders filled with dates read from the data.
 * Pure (no request context), so that it is tested as values.
 */

export const ALTERNATIVES_PATH = '/alternatives';

export function vendorPath(slug: VendorSlug): string {
  return `${ALTERNATIVES_PATH}/${slug}`;
}

const COPIES: Record<AlternativesLocale, AlternativesCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE };

export function isAlternativesLocale(locale: string): locale is AlternativesLocale {
  return locale === 'en' || locale === 'fr' || locale === 'de';
}

function rawCopy(locale: string): AlternativesCopy {
  return COPIES[isAlternativesLocale(locale) ? locale : 'en'];
}

/** The editions of the two registers whose files this repository carries. */
function editions(locale: string): { deAsOf: string; chAsOf: string } {
  const latest = (values: string[]) => values.reduce((a, b) => (b > a ? b : a), '');
  const de = latest(Object.values(deBlzFile().entries).map((e) => e.register.as_of));
  const ch = latest(Object.values(chIidFile().entries).map((e) => e.register.valid_on));
  return { deAsOf: formatMonthWords(de, locale), chAsOf: formatDayWords(ch, locale) };
}

function fillDeep<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return fillTemplate(value, vars) as T;
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, vars)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillDeep(v, vars)]),
    ) as T;
  }
  return value;
}

/**
 * The copy of a locale with the dates filled in: the providers' reading day
 * and the editions of the registers. `{name}` is left for the page, which
 * knows which provider it shows.
 */
export function alternativesCopy(locale: string): AlternativesCopy {
  return fillDeep(rawCopy(locale), { readOn: formatDayWords(READ_ON, locale), ...editions(locale) });
}

export function vendorCopy(locale: string, slug: VendorSlug): VendorCopy {
  return alternativesCopy(locale).vendors[slug];
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

function pageMetadata(locale: string, path: string, title: string, description: string): Metadata {
  const url = urlFor(locale, path);
  const og = ogImageFor(locale);
  const shareTitle = `${title} | IBANforge`;
  return {
    title,
    description,
    alternates: alternatesFor(locale, path),
    openGraph: {
      type: 'website',
      locale: rawCopy(locale).ogLocale,
      url,
      siteName: 'IBANforge',
      title: shareTitle,
      description,
      images: [og],
    },
    twitter: { card: 'summary_large_image', title: shareTitle, description, images: [og.url] },
  };
}

export function indexMetadata(locale: string): Metadata {
  const { meta } = alternativesCopy(locale).index;
  return pageMetadata(locale, ALTERNATIVES_PATH, meta.title, meta.description);
}

export function vendorMetadata(locale: string, slug: VendorSlug): Metadata {
  const { meta } = vendorCopy(locale, slug);
  return pageMetadata(locale, vendorPath(slug), meta.title, meta.description);
}

// ─── Structured data ──────────────────────────────────────────────────────────

/**
 * A WebPage and its breadcrumb, nothing more: no Product, Review or rating is
 * ever emitted about another provider.
 */
export function alternativesJsonLd(locale: string, slug: VendorSlug | null): Record<string, unknown> {
  const copy = alternativesCopy(locale);
  const path = slug ? vendorPath(slug) : ALTERNATIVES_PATH;
  const url = urlFor(locale, path);
  const name = slug ? copy.vendors[slug].meta.title : copy.index.meta.title;
  const headline = slug ? copy.vendors[slug].h1 : copy.index.h1;
  const description = slug ? copy.vendors[slug].meta.description : copy.index.meta.description;
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: copy.breadcrumbHome, item: urlFor(locale) },
    { '@type': 'ListItem', position: 2, name: copy.breadcrumbIndex, item: urlFor(locale, ALTERNATIVES_PATH) },
  ];
  if (slug) crumbs.push({ '@type': 'ListItem', position: 3, name: headline, item: url });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name,
        headline,
        description,
        inLanguage: isAlternativesLocale(locale) ? locale : 'en',
        isPartOf: { '@type': 'WebSite', name: 'IBANforge', url: SITE_URL },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: crumbs },
    ],
  };
}

export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export { READ_ON, VENDORS };
