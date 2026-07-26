import type { Contact } from '@/lib/crm/types';

/**
 * Archiving is how a contact stops asking for attention without being deleted,
 * and 'rejete' rows never reach this code at all since build-contacts drops
 * them. The prospect page this replaces defaulted its filter to 'actifs', which
 * hid archived rows from every view but the archive one; the same rule holds
 * here, applied by every filter predicate except the Archivés chip and by every
 * counter on the page.
 *
 * A plain module with no directive on purpose. The page is a Server Component
 * and the list is a Client Component, and both need this exact rule: a second
 * copy would be free to drift, while exporting it from the client file would
 * turn it into a client reference the server cannot call.
 */
export function isArchived(c: Contact): boolean {
  return c.sourcing?.status === 'archive';
}
