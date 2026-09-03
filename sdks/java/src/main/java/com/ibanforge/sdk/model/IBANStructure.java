package com.ibanforge.sdk.model;

import java.util.Map;

/** Result of the FREE {@code GET /v1/iban/structure/:country} -- one country's BBAN template. */
public record IBANStructure(
    Country country,
    int ibanLength,
    int bbanLength,
    /** Field name (e.g. "bank_code", "account_number") to its offset/length/charset. */
    Map<String, BBANFieldSpec> bban,
    String bbanPattern,
    SEPA sepa,
    String exampleIban,
    /** Warns that the registry's example may carry an unallocated bank code. */
    String exampleIbanNote,
    String notes,
    String upgradeHint,
    Double costUsdc
) {
}
