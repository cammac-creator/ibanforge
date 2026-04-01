import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard Login",
  description: "Sign in to your IBANforge dashboard.",
};

export default function DashboardLoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
