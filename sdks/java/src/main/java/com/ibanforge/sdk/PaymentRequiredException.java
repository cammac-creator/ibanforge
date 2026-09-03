package com.ibanforge.sdk;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 402 -- payment required. The caller must either authenticate with an API key
 * ({@code Authorization: Bearer ifk_...}) or pay per call via the x402 protocol on Base.
 *
 * <p>{@link #getAccepts()} carries the x402 challenge lifted out of the response body, so an
 * x402-capable caller can pay and retry instead of dead-ending.
 */
public class PaymentRequiredException extends IBANforgeException {

    private final JsonNode accepts;

    public PaymentRequiredException(String message, Integer status, Object body) {
        super(message, status, body);
        this.accepts = extractAccepts(body);
    }

    private static JsonNode extractAccepts(Object body) {
        if (body instanceof JsonNode node && node.isObject()) {
            JsonNode accepts = node.get("accepts");
            if (accepts != null && !accepts.isNull()) {
                return accepts;
            }
        }
        return null;
    }

    /** The x402 payment requirements from the response body's {@code accepts} field, or null. */
    public JsonNode getAccepts() {
        return accepts;
    }
}
