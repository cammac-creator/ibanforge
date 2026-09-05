import type { Metadata } from "next";
import { ClientMessages } from "@/components/client-messages"

export const metadata: Metadata = {
  title: "Dashboard Login",
  description: "Sign in to your IBANforge dashboard.",
};

export default function DashboardLoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientMessages ns={["dashboard"]}>{children}</ClientMessages>;
}
