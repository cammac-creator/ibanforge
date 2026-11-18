import type { Metadata } from 'next';
import { formatDayMonthWords, weekdayWords } from '@/lib/date-words';
import { fillTemplate } from '@/lib/iban-bank-finder';
import {
  type CalendarSystem,
  type ClearingCalendarFile,
  clearingCalendarPath,
  closedSystems,
  systemsOf,
} from '@/lib/clearing-calendar';
import { alternatesFor, ogImageFor, SITE_URL, urlFor } from '@/lib/seo';
import type { CalendarCopy, CalendarLocale } from './copy';
import { COPY_DE } from './copy-de';
import { COPY_EN } from './copy-en';
import { COPY_FR } from './copy-fr';

/**
 * Everything the clearing calendar page shows that is not prose: the sources
 * it cites and the day they were read, its metadata and structured data, and
 * the helpers that turn the dates of the data file into words.
 */

/** The day the published pages cited below were read and checked against the data file. */
export const SOURCES_READ_ON = '2026-11-18';

/** SIX Interbank Clearing, "Schedule of clearing days 2027", English edition (created 28 September 2026). */
export const SIX_SCHEDULE_2027_URL =
  'https://www.six-group.com/dam/download/banking-services/interbank-clearing/en/payment_services/sic/banking-holidays.pdf';

/** SIX, the euroSIC page: discontinuation of the system on 31 December 2027. */
export const SIX_EUROSIC_URL =
  'https://www.six-group.com/en/products-services/banking-services/interbank-clearing/eurosic.html';

/** The last clearing day of euroSIC, as SIX announces it. */
export const EUROSIC_LAST_DAY = '2027-12-31';

/** ECB, "ECB public holidays": each year's TARGET closing days carry an asterisk. */
export const ECB_HOLIDAYS_URL = 'https://www.ecb.europa.eu/ecb/contacts/working-hours/html/index.en.html';

/** Directive (EU) 2015/2366 (PSD2), Articles 4(37) and 78(1). */
export const PSD2_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32015L2366';

/** The @id of the product node the locale layout emits (components/json-ld.tsx). */
const SOFTWARE_NODE_ID = 'https://ibanforge.com/#software';

const COPIES: Record<CalendarLocale, CalendarCopy> = { en: COPY_EN, fr: COPY_FR, de: COPY_DE };

export function isCalendarLocale(locale: string): locale is CalendarLocale {
  return locale === 'en' || locale === 'fr' || locale === 'de';
}

function known(locale: string): CalendarLocale {
  return isCalendarLocale(locale) ? locale : 'en';
}

export function calendarCopy(locale: string): CalendarCopy {
  return COPIES[known(locale)];
}

// ─── Words ────────────────────────────────────────────────────────────────────

/** `2027-03-26` as `Friday 26 March`, `vendredi 26 mars`, `Freitag, 26. März`. */
export function dayWords(isoDay: string, locale: string): string {
  const weekday = weekdayWords(isoDay, locale);
  const day = formatDayMonthWords(isoDay, locale);
  return known(locale) === 'de' ? `${weekday}, ${day}` : `${weekday} ${day}`;
}

/** `a`, `a and b`, `a, b and c` (German: `a; b und c`, its days carry a comma). */
export function joinList(items: string[], copy: CalendarCopy): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(copy.listSeparator)} ${copy.and} ${items[items.length - 1]}`;
}

/** `SIC`, `euroSIC and T2`: the systems named, always with a plain comma. */
export function systemNames(systems: CalendarSystem[], copy: CalendarCopy): string {
  const names = systems.map((system) => copy.systems[system]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${copy.and} ${names[names.length - 1]}`;
}

/** The sentences that answer the question, one per system, filled from the file. */
export function answerSentences(file: ClearingCalendarFile, locale: string): { system: CalendarSystem; text: string }[] {
  const copy = calendarCopy(locale);
  return systemsOf(file).map((system) => {
    const days = file.closed_weekdays[system] ?? [];
    return {
      system,
      text: fillTemplate(copy.hero.answer[system], {
        year: file.year,
        count: days.length,
        days: joinList(
          days.map((day) => dayWords(day, locale)),
          copy,
        ),
      }),
    };
  });
}

/** The systems closed and open on a weekday, as two lists of names. */
export function closedAndOpen(file: ClearingCalendarFile, isoDay: string): { closed: CalendarSystem[]; open: CalendarSystem[] } {
  const closed = closedSystems(file, isoDay);
  return { closed, open: systemsOf(file).filter((system) => !closed.includes(system)) };
}

/** `19:05` as French writes it, `19 h 05`; English and German keep `19:05`. */
export function timeWords(time: string, locale: string): string {
  return known(locale) === 'fr' ? time.replace(':', ' h ') : time;
}

/** `+01:00` in the creation stamp of the SIX file. */
export function stampOffset(stamp: string): string {
  const m = /([+-]\d{2}:\d{2})$/.exec(stamp);
  return m ? m[1] : '';
}

// ─── Metadata and structured data ─────────────────────────────────────────────

export function calendarMetadata(locale: string, year: string): Metadata {
  const { meta } = calendarCopy(locale);
  const path = clearingCalendarPath(year);
  const url = urlFor(locale, path);
  const og = ogImageFor(locale);
  const title = fillTemplate(meta.title, { year });
  const description = fillTemplate(meta.description, { year });
  const shareTitle = `${title} | IBANforge`;
  return {
    // The layout's template adds the product name to the tab title.
    title,
    description,
    alternates: alternatesFor(locale, path),
    openGraph: {
      type: 'website',
      locale: meta.ogLocale,
      url,
      siteName: 'IBANforge',
      title: shareTitle,
      description,
      images: [og],
    },
    twitter: { card: 'summary_large_image', title: shareTitle, description, images: [og.url] },
  };
}

export function calendarJsonLd(locale: string, file: ClearingCalendarFile): Record<string, unknown> {
  const copy = calendarCopy(locale);
  const year = String(file.year);
  const url = urlFor(locale, clearingCalendarPath(year));
  const h1 = fillTemplate(copy.hero.h1, { year });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: fillTemplate(copy.meta.title, { year }),
        headline: h1,
        description: fillTemplate(copy.meta.description, { year }),
        inLanguage: known(locale),
        isPartOf: { '@type': 'WebSite', name: 'IBANforge', url: SITE_URL },
        about: { '@id': SOFTWARE_NODE_ID },
        citation: [file.sources.six.file, SIX_SCHEDULE_2027_URL, file.sources.target.url, ECB_HOLIDAYS_URL],
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: copy.breadcrumbHome, item: urlFor(locale) },
          { '@type': 'ListItem', position: 2, name: h1, item: url },
        ],
      },
    ],
  };
}

/** The JSON-LD as it goes into the <script> tag, `<` escaped. */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
