import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live — the pipeline as a village",
  description:
    "Watch a real IBAN validation cross the IBANforge pipeline, slowed down: toll gate, mod-97 scribe, BIC library, national registers, verdict, forge.",
};

export default function LiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
