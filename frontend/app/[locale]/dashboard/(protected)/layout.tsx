import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { TopNav } from '@/components/dashboard/top-nav';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <TopNav />
      <main className="px-4 py-6 md:px-8 md:py-8 max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  );
}
