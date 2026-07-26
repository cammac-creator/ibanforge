import { redirect } from 'next/navigation';

/**
 * Clients and prospects were two near-twin pages. They are one page now, at
 * /dashboard/contacts. This route stays as a redirection so bookmarks and any
 * link still land somewhere useful.
 *
 * redirect, not permanentRedirect: 307 keeps the browser asking, where a 308
 * would be cached hard and would outlive any future reshaping of these paths.
 */
export default async function CustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/contacts`);
}
