package com.ibanforge.sdk.model;

/** Verification of Payee status nested inside {@link Compliance}. */
public record VoP(
    boolean participant,
    /** One of "active", "pending", "inactive", "not_found". */
    String status,
    Boolean screened
) {
}
