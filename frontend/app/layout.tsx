import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // The locale layout owns the "%s | IBANforge" template. A template here too
  // ran the locale default through it, so the home was served as
  // "IBANforge — … | IBANforge" (audit 2026-09-04, S11).
  title: "IBANforge",
  description: "IBAN validation & BIC/SWIFT lookup API for developers and AI agents",
  metadataBase: new URL("https://ibanforge.com"),
  // Two Google verification tokens since 2026-09-06: the owner's, and the
  // service account gsc-reader (project uikrap) that reads Search Console for
  // the dashboard. A verification token is public by design.
  verification: {
    google: ["-lRtR9x7lOtMJqQ_KXeLVWx_whEhAIPllG65GkDx44A", "iunFAZ2F8eHriObs57wUEiARToZTatf_B9kqTWA1NoQ"],
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
