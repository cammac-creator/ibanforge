import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { TopNav } from '@/components/dashboard/top-nav';
import { DashboardTooltipProvider } from '@/components/dashboard/tooltip-provider';
import { ClientMessages } from "@/components/client-messages"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) redirect('/dashboard/login');

  return (
    <ClientMessages ns={["dashboard"]}>
    <DashboardTooltipProvider>
      <div className="min-h-screen bg-[var(--ink-0)] text-white">
        <TopNav />
        <main className="px-4 py-6 md:px-8 md:py-8 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
    </DashboardTooltipProvider>
    </ClientMessages>
  );
}
