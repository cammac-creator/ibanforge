/**
 * Deep links from the Clients tab into a Contacts thread.
 *
 * Contact selection is local state in CrmApp, so a plain link to
 * /dashboard/contacts lands on the page with nothing open — the operator then
 * has to find the same person again by hand, which is the opposite of what
 * "open the thread" promises. The address travels in the query string, and the
 * two ends of that contract live here so they cannot drift apart.
 */

/** The query parameter both ends agree on. */
export const CLIENT_PARAM = 'client';

export function contactsHref(locale: string, contactId: string): string {
  const params = new URLSearchParams({ [CLIENT_PARAM]: contactId.toLowerCase() });
  return `/${locale}/dashboard/contacts?${params}`;
}

/**
 * The contact to open on arrival, or null.
 *
 * Returns null rather than a best guess when the address matches nobody: the
 * CRM hides some addresses, and silently opening a different customer's thread
 * beside a composer is a far worse failure than opening none.
 */
export function contactIdFromParam(raw: string | null | undefined, contactIds: string[]): string | null {
  if (!raw) return null;
  const wanted = raw.trim().toLowerCase();
  if (!wanted) return null;
  return contactIds.find((id) => id.toLowerCase() === wanted) ?? null;
}
