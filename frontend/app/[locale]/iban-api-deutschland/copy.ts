/**
 * The words of the page that answers "which API checks a German IBAN and names
 * the bank and the BIC?", one file per language, beside the route (the reason is
 * the one `iban-validation-api/copy.ts` gives: long copy, one route, no churn in
 * the shared catalogues).
 *
 * German first: the two other languages exist because every route of the site
 * has all three and the language switcher keeps the path. Placeholders in braces
 * are filled in `page-data.ts` from the register export, never typed here.
 */

export type GermanApiLocale = 'en' | 'fr' | 'de';

export interface GermanApiSource {
  label: string;
  url: string;
  /** Which reading day it was read on: the day of this page, or the earlier primary reading. */
  read: 'authorities' | 'regulation';
}

export interface GermanApiCopy {
  meta: { title: string; description: string; ogLocale: string };
  breadcrumbHome: string;
  hero: {
    eyebrow: string;
    h1: string;
    /** The direct answer: it comes before the first <h2> and names the Bundesbank. */
    answer: string;
    limit: string;
    interest: string;
    tryIt: string;
    compare: string;
  };
  need: {
    heading: string;
    intro: string;
    cols: { check: string; source: string; field: string };
    rows: { check: string; source: string; field: string }[];
  };
  bundesbank: {
    heading: string;
    items: { title: string; body: string }[];
    credit: string;
  };
  examples: {
    heading: string;
    intro: string;
    allocatedTitle: string;
    allocatedNote: string;
    missingTitle: string;
    missingNote: string;
    curlTitle: string;
    curlNote: string;
    keyLink: string;
    extract: string;
  };
  vop: {
    heading: string;
    what: { title: string; body: string };
    duty: { title: string; body: string };
    says: { title: string; body: string };
    not: { title: string; body: string };
    sourcesTitle: string;
    readOn: string;
    sources: GermanApiSource[];
    docsLink: string;
  };
  comparison: {
    heading: string;
    interest: string;
    bankCode: string;
    prices: string;
    ourPrices: string;
    libsName: string;
    libsBetter: string;
    vendorLink: string;
    ourLink: string;
    tableLink: string;
  };
  europe: {
    heading: string;
    full: string;
    elsewhere: string;
    link: string;
  };
  next: {
    heading: string;
    finder: string;
    register: string;
    docs: string;
    article: string;
    alternatives: string;
  };
}
