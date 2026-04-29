import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fraunces, Caveat } from "next/font/google";
import { FamilleClient } from "./famille-client";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pour ma famille",
  description: "Une lettre d'Alain à sa famille — comprendre IBANforge sans jargon.",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "fr") notFound();

  return (
    <div className={`${fraunces.variable} ${caveat.variable}`}>
      <FamilleClient />
    </div>
  );
}
