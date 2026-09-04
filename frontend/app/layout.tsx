import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // The locale layout owns the "%s | IBANforge" template. A template here too
  // ran the locale default through it, so the home was served as
  // "IBANforge — … | IBANforge" (audit 2026-09-04, S11).
  title: "IBANforge",
  description: "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  metadataBase: new URL("https://ibanforge.com"),
  verification: {
    google: "-lRtR9x7lOtMJqQ_KXeLVWx_whEhAIPllG65GkDx44A",
  },
  twitter: {
    card: "summary_large_image",
    title: "IBANforge",
    description: "IBAN validation & BIC/SWIFT lookup API",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
