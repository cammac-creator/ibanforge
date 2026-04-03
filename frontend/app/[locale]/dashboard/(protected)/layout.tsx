import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from '@/components/dashboard/logout-button';
import { SidebarNav } from '@/components/dashboard/sidebar-nav';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 border-r border-zinc-800 flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-zinc-800">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="text-amber-400 font-bold text-sm">IF</span>
            </div>
            <div>
              <span className="text-sm font-semibold text-white tracking-wide">IBANforge</span>
              <span className="block text-[10px] text-zinc-500 leading-none">Dashboard</span>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <SidebarNav />
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t border-zinc-800 space-y-1">
          <Link
            href="/"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition"
          >
            <span className="text-base">←</span>
            <span>Retour au site</span>
          </Link>
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <span className="text-amber-400 font-bold text-xs">IF</span>
            </div>
            <span className="text-sm font-semibold text-white">IBANforge</span>
          </Link>
          <MobileMenu />
        </div>
      </div>

      <main className="flex-1 p-4 md:p-8 md:pt-6 mt-14 md:mt-0 overflow-auto">{children}</main>
    </div>
  );
}

function MobileMenu() {
  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer p-2 rounded-lg hover:bg-zinc-800 transition">
        <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </summary>
      <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl p-2 z-50">
        <Link href="/dashboard" className="block px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg">
          📊 Vue d&apos;ensemble
        </Link>
        <Link href="/dashboard/api-stats" className="block px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg">
          📈 API Stats
        </Link>
        <Link href="/dashboard/monitoring" className="block px-3 py-2 text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg">
          🔍 Monitoring
        </Link>
        <hr className="my-1 border-zinc-800" />
        <Link href="/" className="block px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg">
          ← Retour au site
        </Link>
      </div>
    </details>
  );
}
