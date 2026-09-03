package com.ibanforge.sdk.model;

/** Result of {@code POST /v1/keys/generate}. {@link #apiKey()} is shown once, never again. */
public record APIKey(
    String apiKey,
    String keyPrefix,
    String email,
    Integer monthlyLimit,
    String message,
    String termsUrl
) {
}
