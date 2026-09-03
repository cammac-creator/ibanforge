package com.ibanforge.sdk.model;

/**
 * Result of the FREE {@code GET /v1/iban/format} pre-flight check: pure mod-97 + structure,
 * no directory lookups. No BIC, no SEPA, no compliance data -- use
 * {@link com.ibanforge.sdk.IBANforge#validateIban} for that.
 */
public record IBANFormatResult(
    String iban,
    String formatted,
    boolean valid,
    Country country,
    String checkDigits,
    BBAN bban,
    String error,
    String errorDetail,
    String upgradeToFullValidation
) {
}
