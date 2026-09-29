/**
 * The words of the "Which bank does this IBAN belong to?" page, one file per
 * language, beside the route (the reason is the one `iban-validation-api/copy.ts`
 * gives: long copy, one route, no churn in the shared catalogues).
 *
 * Written for people, not developers: the search terms that already bring the
 * site readers are "DE55 welche Bank", "IBAN welche Bank Österreich", "BIC
 * Commerzbank Heidelberg". The page answers the question, explains the trap
 * (the two digits after DE are check digits), and reads the bank code of an
 * IBAN in the browser.
 *
 * Placeholders, replaced by the page or the finder, never written by hand:
 *   {cd}       the two check digits the reader typed
 *   {code}     the bank code read from the IBAN
 *   {needed}   how many characters the bank code needs
 *   {length}   the length of a complete IBAN of that country
 *   {country}  the two letters typed
 *   {asOf}     the edition of the register, in words
 *   {successor} the code the Bundesbank names as successor
 */

export type WelcheBankLocale = 'en' | 'fr' | 'de';

/** What the finder says, state by state. */
export interface FinderCopy {
  label: string;
  placeholder: string;
  privacy: string;
  example: string;
  /** "DE55": the two digits named for what they are. */
  partialTitle: string;
  /** Country and fewer than two check digits. */
  partialStart: string;
  /** Per country: where the bank code sits, and how many characters to type. */
  partialBody: Record<'DE' | 'AT' | 'CH' | 'LI', string>;
  /** The name of the bank code, per country, before the code itself. */
  codeName: Record<'DE' | 'AT' | 'CH' | 'LI', string>;
  status: {
    deAllocated: string;
    deRetired: string;
    deRetiredSuccessor: string;
    deMissing: string;
    atUnchecked: string;
    chAllocated: string;
    chMissing: string;
  };
  checksum: {
    pass: string;
    fail: string;
    incomplete: string;
  };
  bareBlz: string;
  open: string;
  openSuccessor: string;
  errors: {
    characters: string;
    country: string;
    tooLong: string;
  };
  unsupported: string;
  unsupportedLink: string;
}

export interface WelcheBankCopy {
  meta: {
    /** Without the brand: the locale layout appends "| IBANforge". */
    title: string;
    description: string;
    ogLocale: string;
  };
  breadcrumbHome: string;
  hero: {
    eyebrow: string;
    h1: string;
    lead: string;
  };
  finder: FinderCopy;
  anatomy: {
    heading: string;
    intro: string;
    parts: {
      country: { label: string; note: string };
      check: { label: string; note: string };
      bank: { label: string; note: string };
      account: { label: string; note: string };
    };
  };
  trap: {
    heading: string;
    paragraphs: string[];
  };
  countries: {
    heading: string;
    intro: string;
    cols: { country: string; length: string; position: string; code: string; register: string };
    rows: Array<{ cc: 'DE' | 'AT' | 'CH' | 'LI'; country: string; code: string; register: string }>;
    positions: string;
  };
  tells: {
    heading: string;
    yes: string[];
    no: string[];
  };
  developers: {
    heading: string;
    body: string;
    api: string;
    sandbox: string;
    article: string;
  };
  sources: {
    /** `{asOf}` is the edition of the Bundesbank file. */
    de: string;
    /** `{asOf}` is the day the SIX BankMaster edition is valid from. */
    ch: string;
    at: string;
  };
}
