/**
 * Is `url` a resource served by our own API?
 *
 * Third-party catalogs (the CDP Bazaar, marketplaces) list resources that
 * anyone can register. A prefix test on `https://api.ibanforge.com` also
 * accepts `https://api.ibanforge.com.attacker.example/x` and
 * `https://api.ibanforge.com@attacker.example/x`, so a stranger could inflate
 * the count we read as "our listings". Parsed, the host has to be ours
 * exactly, over https, on the default port, with no credentials in the URL.
 */
export const OWN_API_HOST = 'api.ibanforge.com';

export function isOwnApiResource(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === OWN_API_HOST &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === ''
  );
}
