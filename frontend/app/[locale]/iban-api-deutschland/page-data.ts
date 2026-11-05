import type { Metadata } from 'next';
import { formatDayWords, formatMonthWords } from '@/lib/date-words';
import { fillTemplate, ibanChecksumPasses } from '@/lib/iban-bank-finder';
import { SUPPORTED_COUNTRIES } from '@/lib/landing-stats';
import { deBlzFile, getBlz } from '@/lib/registers';
import { alternatesFor, ogImageFor, SITE_URL, urlFor } from '@/lib/seo';
import { READ_ON } from '../alternatives/vendors';
import type { GermanApiCopy, GermanApiLocale } from './copy';
import { COPY_DE } from './copy-de';
import { COPY_EN } from './copy-en';
import { COPY_FR } from './copy-fr';
import notAllocated from './not-allocated.json';

/**
 * Everything the German API page shows that is not prose: its path, its
 * metadata and structured data, the register's edition and counts, and the two
 * example answers. Server only: it reads the register export from disk.
 *
 * The examples are built from `frontend/data/registers/de-blz.json`, which the
 * monthly refresh rewrites, so that they age with the register. `not-allocated.json`
 * holds only what no export can carry, the answer to a code nobody holds, and
 * `scripts/german-api-page.test.ts` compares it with what the API computes. No
 * value of the EPC registers appears here: they are served, never redistributed
 * (src/lib/restricted-family.ts), so the page names the VoP fields and their
 * meaning, never the status of a bank.
 */

export const GERMAN_API_PATH = '/iban-api-deutschland';

/** The official example of the IBAN registry for Germany. */
export const ALLOCATED_IBAN = 'DE89370400440532013000';
const ALLOCATED_BLZ = ALLOCATED_IBAN.slice(4, 12);

/** The day the BaFin and Bundesbank pages cited on this page were read. */
export const AUTHORITIES_READ_ON = '2026-11-05';

/**
 * The day the text of Regulation (EU) 2024/886 was read at its source, for the
 * guide `2026-09-02-verification-of-payee-switzerland`, which quotes it.
 */
export const REGULATION_READ_ON = '2026-09-02';

/** The @id of the product node the locale layout emits (components/json-ld.tsx). */
const SOFTWARE_NODE_ID = 'https://ibanforge.com/#software';

const COPIES: Record<GermanApiLocale, GermanApiCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE };

export function isGermanApiLocale(locale: string): locale is GermanApiLocale {
  return locale === 'en' || locale === 'fr' || locale === 'de';
}

function known(locale: string): GermanApiLocale {
  return isGermanApiLocale(locale) ? locale : 'en';
}

/** The edition of the file and its counts, as the export carries them. */
export function registerFacts(): { asOf: string; count: number; retired: number } {
  const entries = Object.values(deBlzFile().entries);
  return {
    // `as_of` is the month of the Bundesbank file every row was read from.
    asOf: entries.map((e) => e.register.as_of).reduce((a, b) => (b > a ? b : a), ''),
    count: entries.length,
    retired: entries.filter((e) => e.register.retired).length,
  };
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

/** The copy of a locale, with the facts read from the export. `{name}` and `{date}` stay for the page. */
export function germanApiCopy(locale: string): GermanApiCopy {
  const facts = registerFacts();
  const number = new Intl.NumberFormat(known(locale) === 'de' ? 'de-DE' : known(locale));
  return fillDeep(COPIES[known(locale)], {
    asOf: formatMonthWords(facts.asOf, locale),
    count: number.format(facts.count),
    retired: number.format(facts.retired),
    countries: String(SUPPORTED_COUNTRIES),
    readOn: formatDayWords(READ_ON, locale),
  });
}

// ─── The two answers ──────────────────────────────────────────────────────────

/** The answer to the specimen IBAN, taken from the export of its bank code. */
export function allocatedExample(): Record<string, unknown> | null {
  const entry = getBlz(ALLOCATED_BLZ);
  if (!entry) return null;
  const bic = entry.api.bic as Record<string, unknown>;
  return {
    iban: ALLOCATED_IBAN,
    valid: ibanChecksumPasses(ALLOCATED_IBAN),
    bank_code_check: entry.api.bank_code_check,
    bic: {
      code: bic.code,
      bank_name: bic.bank_name,
      source: bic.source,
      basis: bic.basis,
      authoritative: bic.authoritative,
      as_of: bic.as_of,
    },
  };
}

/**
 * The answer to a code nobody holds. Null if the register ever allocates it:
 * the page then drops the example rather than state something false.
 */
export function notAllocatedExample(): Record<string, unknown> | null {
  const { iban, bank_code_check: check, next_step: step } = notAllocated;
  if (getBlz(check.value)) return null;
  return {
    iban,
    valid: ibanChecksumPasses(iban),
    bank_code_check: { ...check, register: deBlzFile().source, as_of: registerFacts().asOf },
    bic: null,
    next_steps: [step],
  };
}

export function curlExample(): string {
  return [
    'curl -s -X POST https://api.ibanforge.com/v1/iban/validate \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"iban":"${ALLOCATED_IBAN}"}'`,
  ].join('\n');
}

// ─── Metadata and structured data ─────────────────────────────────────────────

export function germanApiMetadata(locale: string): Metadata {
  const { meta } = COPIES[known(locale)];
  const url = urlFor(locale, GERMAN_API_PATH);
  const og = ogImageFor(locale);
  const shareTitle = `${meta.title} | IBANforge`;
  return {
    // The title names the product in the share card only: the layout's template adds it to the tab.
    title: meta.title,
    description: meta.description,
    alternates: alternatesFor(locale, GERMAN_API_PATH),
    openGraph: {
      type: 'website',
      locale: meta.ogLocale,
      url,
      siteName: 'IBANforge',
      title: shareTitle,
      description: meta.description,
      images: [og],
    },
    twitter: { card: 'summary_large_image', title: shareTitle, description: meta.description, images: [og.url] },
  };
}

export function germanApiJsonLd(locale: string): Record<string, unknown> {
  const copy = COPIES[known(locale)];
  const url = urlFor(locale, GERMAN_API_PATH);
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
        inLanguage: known(locale),
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
