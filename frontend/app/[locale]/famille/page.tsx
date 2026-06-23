import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fraunces, Caveat, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
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

// Warm humanist sans for long-form body copy (distinctive, not Inter/Roboto).
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

// Mono for IBAN / code / technical labels — referenced throughout PAGE_CSS.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pour ma famille",
  description: "Les questions que ma famille me pose sur IBANforge — et mes réponses, sans jargon.",
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
    <div
      className={`${fraunces.variable} ${caveat.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <FamilleClient />
    </div>
  );
}
