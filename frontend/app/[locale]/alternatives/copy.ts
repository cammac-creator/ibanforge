/**
 * The words of the "alternative" pages, one file per language, beside the
 * routes (same reason as `iban-validation-api/copy.ts`).
 *
 * Comparative advertising, so the rules are strict and the test beside this
 * file holds what it can:
 *  - every fact about a provider is one its own public pages state, re-read
 *    on the date in `vendors.ts`, and its page links to those sources;
 *  - a price is always given with its period and what it buys;
 *  - nothing says a provider lacks something (a silent page proves nothing);
 *  - each page says what the other provider does well and when to choose it;
 *  - a comparison of amounts is labelled a calculation, at equal scope.
 *
 * 🚨 The free doors of IBANforge are written by hand here, as on the API page,
 * so that the prose guards of the API repository can read them:
 * `src/routes/free-doors-claims.test.ts` (the weekly trial and the monthly key
 * never share a sentence) and `src/lib/trial-figures-static.test.ts` list these
 * three files. `page-data.test.ts` pins every figure to the constants.
 *
 * Placeholders, filled by the page: {deAsOf} and {chAsOf} are the editions of
 * the German and Swiss registers, {readOn} the day the providers' pages were read.
 */

export type AlternativesLocale = 'en' | 'fr' | 'de';

export interface VendorCopy {
  meta: {
    /** Without the brand: the locale layout appends "| IBANforge". */
    title: string;
    description: string;
  };
  h1: string;
  lead: string;
  /** One line for the index card. */
  summary: string;
  strengths: string[];
  prices: string[];
  /** The same need priced at both, labelled a calculation. */
  calculation: string;
  /** When this provider is the better choice. */
  betterFor: string[];
  /** Any other fact worth a reader's time (a sister site, a limit of scope). */
  note?: string;
}

export interface OursCopy {
  heading: string;
  items: string[];
  limitsHeading: string;
  limits: string[];
  pricesHeading: string;
  /** The free ways in, one sentence each: never two free figures in one sentence. */
  free: string[];
  /** Pro, the packs and x402, at the prices of the code. */
  paid: string[];
}

export interface AlternativesCopy {
  ogLocale: string;
  breadcrumbHome: string;
  breadcrumbIndex: string;
  eyebrow: string;
  disclosure: string;
  labels: {
    strengths: string;
    /** `{name}` is the provider. */
    theirPrices: string;
    /** `{readOn}` is the day its pages were read. */
    readOn: string;
    ourPricesNote: string;
    allPrices: string;
    calculation: string;
    betterFor: string;
    sources: string;
    next: string;
    compare: string;
    compareBody: string;
    api: string;
    apiBody: string;
    sandbox: string;
    sandboxBody: string;
  };
  ours: OursCopy;
  index: {
    meta: { title: string; description: string };
    h1: string;
    lead: string;
    cardCta: string;
    compareLine: string;
  };
  /** The link the /compare page shows towards these pages. */
  fromCompare: { heading: string; body: string };
  vendors: Record<'ibanapi' | 'iban-com' | 'abstractapi', VendorCopy>;
}
