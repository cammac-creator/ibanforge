package com.ibanforge.sdk.model;

import java.util.Map;

/**
 * Is this bank code actually allocated in the national register?
 *
 * <p>The product's sharpest answer: an IBAN can pass mod-97 and still name a bank that does not
 * exist. {@code status == "not_in_register"} with {@code authoritative == true} means do not
 * send -- a plain checksum validator calls the same IBAN outright invalid, which is a
 * different (and wrong) claim.
 */
public record BankCodeCheck(
    String value,
    /** One of "verified", "not_in_register", "unavailable". */
    String status,
    /**
     * Why the verdict is not "verified", present on every other status. The one value that
     * licenses stopping a payment is "not_allocated", and it only ever comes with
     * {@code authoritative == true}. "national_register_unavailable" and "lookup_failed"
     * describe IBANforge, not the beneficiary.
     */
    String reason,
    String match,
    String register,
    /** True only when the register is the country's official one. */
    boolean authoritative,
    Map<String, String> institution,
    String asOf
) {
}
