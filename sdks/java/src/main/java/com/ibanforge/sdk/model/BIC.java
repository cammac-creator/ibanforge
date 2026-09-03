package com.ibanforge.sdk.model;

/**
 * BIC/SWIFT enrichment nested inside an {@link IBANValidationResult}.
 *
 * <p>Note the JSON field is {@code bank_name}, not {@code bankName}'s bare {@code name} -- an
 * earlier README typo cost readers a copy-paste {@code KeyError} in the Python SDK.
 */
public record BIC(
    String code,
    String bankName,
    /**
     * Where the consulted register places THIS bank code. May legitimately differ from
     * {@link RegisteredAddress#city()}, which is the legal seat: German BLZ 37040044 resolves
     * to Commerzbank in Koeln while the entity is registered in Frankfurt. Both true, different
     * questions.
     */
    String city,
    /** Which directory this row came from (GLEIF, SIX, a curated map, ...). */
    String source,
    /** Month the source was last refreshed. */
    String asOf,
    /**
     * Where the bank code to BIC pairing came from: one of "national_register", "curated_map",
     * "directory_prefix". Only {@code national_register} is settlement-grade.
     */
    String basis,
    /**
     * Whether this BIC may be stored and settled against. Derived from {@link #basis()}. NOT
     * {@link BankCodeCheck#authoritative()}, which answers whether a register was consulted
     * about the BANK CODE -- in Switzerland it confirms the code while this BIC still comes
     * from the curated map.
     */
    Boolean authoritative,
    /**
     * Legal Entity Identifier of the resolved institution. Null means GLEIF publishes no LEI
     * for this BIC, never that the institution has none.
     */
    String lei,
    String leiStatus,
    /** Null for a branch BIC: only head-office rows carry a registered address. */
    RegisteredAddress address
) {
}
