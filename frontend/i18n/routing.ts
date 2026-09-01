import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'de'],
  defaultLocale: 'en',
  /*
   * FRT-10 (audit 2026-09-01): next-intl set NEXT_LOCALE with Path and SameSite
   * but no Secure, so it travelled in clear over any http:// link. It carries
   * nothing sensitive, which is exactly why there is no reason to let it out of
   * TLS. Browsers accept a Secure cookie on http://localhost, so local dev is
   * unaffected.
   */
  localeCookie: { secure: true },
});
