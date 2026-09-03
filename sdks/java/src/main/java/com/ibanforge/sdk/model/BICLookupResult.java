package com.ibanforge.sdk.model;

/** Result of {@code GET /v1/bic/:code}. */
public record BICLookupResult(
    String bic,
    String bic8,
    String bic11,
    boolean found,
    boolean validFormat,
    /** The bank's name. Named {@code institution} here, {@code bic.bankName} on validate. */
    String institution,
    Country country,
    String city,
    /** Registered address, when GLEIF carries one. */
    RegisteredAddress address,
    Boolean addressAvailable,
    String branchCode,
    String branchInfo,
    String lei,
    String leiStatus,
    Boolean isTestBic,
    String source,
    Double costUsdc,
    Double processingMs
) {
}
