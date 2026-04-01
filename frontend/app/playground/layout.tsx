import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Playground",
  description:
    "Test the IBANforge API for free — validate IBANs and look up BIC/SWIFT codes without signup or payment.",
};

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
