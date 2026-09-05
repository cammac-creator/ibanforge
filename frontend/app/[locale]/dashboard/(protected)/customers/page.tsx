import { redirect } from 'next/navigation';
import { localePath } from '@/lib/locale-path';

/**
 * The old Clients page lived here. It lives at /dashboard/clients now, and this
 * route stays as a redirection so an old bookmark still lands somewhere useful.
 *
 * It pointed at /dashboard/contacts until 2026-09-01 (audit TABS-20), which was
 * the wrong door: this URL was the CUSTOMER page, and Contacts answers a
 * different question — the conversation, not the usage. Its neighbour
 * prospects/ keeps pointing at Contacts, which is right: prospecting is
 * correspondence.
 *
 * redirect, not permanentRedirect: 307 keeps the browser asking, where a 308
 * would be cached hard and would outlive any future reshaping of these paths.
 */
export default async function CustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(localePath(locale, '/dashboard/clients'));
}
