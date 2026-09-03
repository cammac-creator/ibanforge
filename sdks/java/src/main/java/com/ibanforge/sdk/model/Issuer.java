package com.ibanforge.sdk.model;

/** Classification of the institution behind an IBAN. */
public record Issuer(
    /** One of "bank", "digital_bank", "emi", "payment_institution". */
    String type,
    String name,
    String classification
) {
}
