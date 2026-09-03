package com.ibanforge.sdk.model;

/** One entry of {@link TestIbanResult#testIbans()}. */
public record TestIbanEntry(
    String iban,
    String formatted,
    /** ISO 3166-1 country code, e.g. "CH". */
    String country,
    TestIbanProof proof,
    String note
) {
}
