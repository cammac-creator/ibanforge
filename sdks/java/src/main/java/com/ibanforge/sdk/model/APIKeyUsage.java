package com.ibanforge.sdk.model;

/** Result of {@code GET /v1/keys/usage} -- the configured key's quota for the current month. */
public record APIKeyUsage(
    String keyPrefix,
    /** Calls consumed this calendar month. */
    int used,
    /** Monthly quota for this key (200 on the free tier). */
    int limit,
    int remaining,
    /** "YYYY-MM" of the quota window. */
    String month
) {
}
