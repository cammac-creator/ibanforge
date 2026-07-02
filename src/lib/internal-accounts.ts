/**
 * Internal/test accounts: keys created by the founder or by Claude-run
 * audits, smoke tests and the site playground. Their traffic is real HTTP
 * but not market signal, so business-facing views must exclude it.
 *
 * Mirrors INTERNAL_RE in frontend/app/[locale]/dashboard/(protected)/customers/page.tsx
 * (the CRM hides the same accounts) — keep the two patterns in sync.
 */
export const INTERNAL_EMAIL_RE =
  /(@ibanforge\.com|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|cam@ogens\.ch|ptibootch@|gpt-store@)/i;

export function isInternalEmail(email: string | null | undefined): boolean {
  return email != null && INTERNAL_EMAIL_RE.test(email);
}
