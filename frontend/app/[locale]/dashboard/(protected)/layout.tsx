import { isAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import styles from '@/components/dashboard/workspace.module.css';
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
      <div className={styles.shell}>
        <TopNav />
        <main id="dashboard-content" tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </div>
    </DashboardTooltipProvider>
    </ClientMessages>
  );
}
