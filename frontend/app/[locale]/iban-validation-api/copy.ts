/**
 * The words of the IBAN validation API page, one file per language.
 *
 * Written for developers and software teams who search for an API ("IBAN
 * validation API", "IBAN prüfen per API", "API de validation IBAN"): the page
 * that answers that query was missing, and the home, rebuilt on 28/09/2026,
 * speaks to a different reader.
 *
 * Why these words do not live in `messages/*.json`: the page is one route in
 * three languages, and its copy is long. Keeping it beside the route keeps the
 * shared catalogues out of this change, and a type (below) keeps the three
 * languages in step, which is what the parity test does for the catalogues.
 *
 * 🚨 The figures of the free doors are written by hand in each file, as the
 * catalogues do, so that the guards that read prose on disk can see them:
 * `src/routes/free-doors-claims.test.ts` (the weekly trial and the monthly key
 * never share a sentence) and `src/lib/trial-figures-static.test.ts` (the
 * trial is counted by the week) both list these three files. `page-data.test.ts`
 * beside them pins every figure to the constant the API applies.
 *
 * `{countries}` is replaced by the number of IBAN countries the export read
 * (`data/countries.json`), never written by hand.
 */

export type ApiPageLocale = "en" | "fr" | "de";

export interface ApiPageCheck {
  title: string;
  /** The field of the answer that carries this check, printed in monospace. */
  field: string;
  body: string;
}

export interface ApiPageDoor {
  tag: string;
  title: string;
  body: string;
}

export interface ApiPageLink {
  /** Site path (localised by the page) or an absolute URL. */
  href: string;
  title: string;
  body: string;
}

export interface ApiPageCopy {
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
    /**
     * The answer to "how do I do it", in the words of that question. Printed
     * right above the command: a reader, or an assistant reading the HTML with
     * no JavaScript, gets the sentence and the command before any heading.
     */
    answer: string;
    lead: string;
    facts: string[];
    ctaKey: string;
    ctaSandbox: string;
    ctaDocs: string;
  };
  checks: {
    heading: string;
    intro: string;
    items: [ApiPageCheck, ApiPageCheck, ApiPageCheck, ApiPageCheck, ApiPageCheck, ApiPageCheck];
  };
  notDo: {
    heading: string;
    items: string[];
    sources: string;
  };
  firstCall: {
    intro: string;
    trial: string;
    tabsLabel: string;
    /** Above the start of the answer, in the hero. `{date}`, `{asOf}`: see answerCaption. */
    startLabel: string;
    startLink: string;
    answerHeading: string;
    /** `{date}` is the day the answer was captured, `{asOf}` the edition of the register it read. */
    answerCaption: string;
    withKey: string;
  };
  mod97: {
    heading: string;
    body: string;
    /** `{date}` is the day the export ran. */
    caption: string;
  };
  doors: {
    heading: string;
    intro: string;
    trial: ApiPageDoor;
    anonymous: ApiPageDoor;
    claimed: ApiPageDoor;
    keyCta: string;
    paidHeading: string;
    paid: string[];
    pricingLink: string;
  };
  tools: {
    heading: string;
    links: ApiPageLink[];
  };
  closing: {
    heading: string;
    body: string;
  };
}
