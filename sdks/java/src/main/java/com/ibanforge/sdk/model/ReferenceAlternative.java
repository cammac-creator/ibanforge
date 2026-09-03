package com.ibanforge.sdk.model;

/** Another scheme the same digits also satisfy, nested inside {@link ReferenceValidationResult}. */
public record ReferenceAlternative(String scheme, boolean valid, String note) {
}
