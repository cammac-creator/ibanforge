package com.ibanforge.sdk.model;

/**
 * Result of the FREE {@code GET|POST /v1/reference/validate} -- a QR-bill (QRR), ISO 11649
 * (RF), Belgian OGM/VCS or Finnish payment reference, checked against its published
 * check-digit rule.
 */
public record ReferenceValidationResult(
    /** Uppercased, separators removed: what was actually judged. */
    String reference,
    /** Null when nothing recognised the string. */
    String scheme,
    /**
     * Null is a real answer, not a missing one: Norwegian KID and Swedish OCR are configured
     * per creditor account by the beneficiary's bank, so {@code false} there would reject
     * perfectly good references.
     */
    Boolean valid,
    String status,
    /** A STRING, because an OGM remainder can legitimately start with a zero. */
    String checkDigitExpected,
    /** The dated document the rule was read from. Keep it when relaying. */
    String source,
    String asOf,
    String note,
    /** Set when the same digits also satisfy another country's length rule. */
    ReferenceAlternative alsoValidAs,
    /** What the paid pairing check adds, and what it costs. */
    String pairingVerdict
) {
}
