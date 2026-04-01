import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from '@/components/dashboard/logout-button';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      <aside className="w-56 border-r border-zinc-800 p-4 flex flex-col space-y-1">
        <div className="mb-6 px-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            IBANforge
          </span>
        </div>

        <nav className="flex-1 space-y-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
          >
            Overview
          </Link>
          <Link
            href="/dashboard/api-stats"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
          >
            API Stats
          </Link>
          <Link
            href="/dashboard/monitoring"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
          >
            Monitoring
          </Link>
        </nav>

        <div className="pt-4 border-t border-zinc-800">
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
