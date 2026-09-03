package com.ibanforge.sdk.model;

/**
 * Registered / head-office address as GLEIF files it.
 *
 * <p>Shared by {@link BIC#address()} and {@link BICLookupResult#address()}, because the API
 * builds both from the same helper.
 */
public record RegisteredAddress(
    /** Always "registered". */
    String type,
    String street,
    String postCode,
    String region,
    String city,
    String country,
    /**
     * Latin reading: GLEIF's official English form for a non-Latin entity, or the address
     * itself when already Latin. Null when the entity is non-Latin and GLEIF ships no Latin
     * form -- a transliteration is never invented.
     */
    String romanized,
    /** One of "original_latin", "gleif_english", "unavailable". */
    String romanization,
    String source,
    String language,
    /**
     * When the entity last filed this address. Frequently a year old, and NOT the {@code asOf}
     * on the {@link BIC} beside it -- that one dates the monthly directory refresh.
     */
    String asOf
) {
}
