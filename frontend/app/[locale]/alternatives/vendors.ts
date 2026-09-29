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
    sources: [
      { url: 'https://www.abstractapi.com/api/iban-validation', label: 'abstractapi.com/api/iban-validation' },
      { url: 'https://docs.abstractapi.com/api/iban-validation', label: 'docs.abstractapi.com/api/iban-validation' },
    ],
  },
};

export function isVendorSlug(value: string): value is VendorSlug {
  return (VENDOR_SLUGS as readonly string[]).includes(value);
}
