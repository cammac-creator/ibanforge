/**
 * Internal/test accounts: keys created by the founder or by Claude-run
 * audits, smoke tests and the site playground. Their traffic is real HTTP
 * but not market signal, so business-facing views must exclude it.
 *
 * Mirrors INTERNAL_RE in frontend/lib/crm/build-contacts.ts (the CRM hides
 * the same accounts) — keep the two patterns in sync, with ONE deliberate
 * exception: @cohorte\.invalid (regrouped abuse cohorts) is internal HERE so
 * funnel/stats/business views drop it, but absent from the frontend mirror so
 * the cohort dossier stays VISIBLE in the CRM clients tab.
 */
export const INTERNAL_EMAIL_RE =
  // The .internal/.dev probe domains slipped through this filter for weeks:
  // three probe keys read as "clients" and inflated one week's billable count
  // enough to trigger a -76% scare in the first Monday digest.
  /(@ibanforge\.com|@ibanforge\.internal|@ibf-internal\.dev|@cohorte\.invalid|-probe@|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|cam@ogens\.ch|ptibootch@|gpt-store@|claudealainmartin06\+)/i;

export function isInternalEmail(email: string | null | undefined): boolean {
  return email != null && INTERNAL_EMAIL_RE.test(email);
}
