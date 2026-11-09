/**
 * The providers that have an "alternative" page, and where each fact on it
 * comes from.
 *
 * Only providers people search for by name and whose public pages we re-read
 * in full, with every claim checked against the page it quotes. The same
 * reading feeds `/compare` (its footnote gives the same date). A fact that was
 * not on a page we read is not on these pages: in particular, nothing here says
 * that a provider lacks something, because a page that is silent proves nothing.
 *
 * To add a provider: re-read its pages, date them, add it here and write its
 * copy in the three languages. To refresh a price: re-read the page, change
 * the figure in the three copy files and `READ_ON` below together.
 */

/** The day the providers' public pages were re-read (the /compare footnote says the same). */
export const READ_ON = '2026-09-24';

export const VENDOR_SLUGS = ['ibanapi', 'iban-com', 'abstractapi'] as const;

export type VendorSlug = (typeof VENDOR_SLUGS)[number];

export interface VendorSource {
  url: string;
  /** What the page is, shown as the link text. */
  label: string;
}

export interface Vendor {
  slug: VendorSlug;
  /** The name as the provider writes it. */
  name: string;
  sources: VendorSource[];
  /**
   * The day this provider's pages were re-read, when that is later than
   * `READ_ON`. Its page then shows its own date, and /compare names it in its
   * footnote; the other providers keep `READ_ON`.
   */
  readOn?: string;
}

export const VENDORS: Record<VendorSlug, Vendor> = {
  ibanapi: {
    slug: 'ibanapi',
    name: 'IBANAPI',
    sources: [
      { url: 'https://ibanapi.com/', label: 'ibanapi.com' },
      { url: 'https://ibanapi.com/prices', label: 'ibanapi.com/prices' },
    ],
  },
  'iban-com': {
    slug: 'iban-com',
    name: 'iban.com',
    sources: [
      { url: 'https://www.iban.com/pricing', label: 'iban.com/pricing' },
      { url: 'https://www.iban.com/products', label: 'iban.com/products' },
      { url: 'https://www.iban.com/developers', label: 'iban.com/developers' },
      { url: 'https://www.iban.com/bav-service', label: 'iban.com/bav-service' },
      { url: 'https://www.iban.com/terms', label: 'iban.com/terms' },
      { url: 'https://www.iban.de/preise.html', label: 'iban.de/preise' },
      { url: 'https://www.iban.de/impressum.html', label: 'iban.de/impressum' },
      { url: 'https://www.iban.de/entwickler.html', label: 'iban.de/entwickler' },
    ],
  },
  abstractapi: {
    slug: 'abstractapi',
    name: 'AbstractAPI',
    // Re-read on 09/11/2026: same figures as on 24/09. ⚠️ The HTML as served
    // carries placeholders ($99, 60,000 a month, 3 requests a second) that the
    // page's own script replaces on load with the first tier of its sliders
    // ($63 billed annually for 60,000 a year, $69 billed monthly for 5,000 a
    // month, 25 requests a second). A reader that does not run the script, like
    // a page-to-text fetcher, reads the placeholders: read it in a browser.
    readOn: '2026-11-09',
    sources: [
      { url: 'https://www.abstractapi.com/api/iban-validation', label: 'abstractapi.com/api/iban-validation' },
      { url: 'https://docs.abstractapi.com/api/iban-validation', label: 'docs.abstractapi.com/api/iban-validation' },
    ],
  },
};

/** The day a provider's facts were last re-read: its own date, or the common one. */
export function vendorReadOn(slug: VendorSlug): string {
  return VENDORS[slug].readOn ?? READ_ON;
}

export function isVendorSlug(value: string): value is VendorSlug {
  return (VENDOR_SLUGS as readonly string[]).includes(value);
}
