import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { TopNav } from '@/components/dashboard/top-nav';
import { DashboardTooltipProvider } from '@/components/dashboard/tooltip-provider';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <DashboardTooltipProvider>
      <div className="min-h-screen bg-zinc-950 text-white">
        <TopNav />
        <main className="px-4 py-6 md:px-8 md:py-8 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </DashboardTooltipProvider>
  );
}
