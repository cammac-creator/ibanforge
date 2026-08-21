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

/**
 * Expose the rule above to SQL as `is_internal_email(email)`.
 *
 * A query that has to skip internal accounts otherwise needs one bound
 * parameter per internal key, which is a statement whose size grows with the
 * table — it threw "too many SQL variables" past SQLite's 2000-parameter
 * ceiling once the local database held enough keys. Rewriting the rule as LIKE
 * patterns was the other option and the worse one: two definitions of
 * "internal" drift, and this one already drifted once (probe domains read as
 * clients for weeks, and a digest reported a collapse that never happened).
 *
 * Registered per connection, idempotent, so callers can just ask before use.
 */
export function registerInternalEmailFn(db: {
  function: (name: string, opts: { deterministic: boolean }, fn: (email: unknown) => number) => unknown;
}): void {
  const registered = REGISTERED as WeakSet<object>;
  if (registered.has(db as object)) return;
  db.function('is_internal_email', { deterministic: true }, (email: unknown) =>
    isInternalEmail(typeof email === 'string' ? email : null) ? 1 : 0,
  );
  registered.add(db as object);
}

const REGISTERED = new WeakSet<object>();
