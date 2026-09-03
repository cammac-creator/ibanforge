package com.ibanforge.sdk;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Base class for every exception the IBANforge SDK throws.
 *
 * <p>Carries the HTTP status (when the failure came from the API), the parsed response body,
 * and the API's machine-readable error slug lifted out of that body -- so a caller can branch
 * on one attribute instead of digging through a body that may not even be JSON.
 *
 * <p>A malformed IBAN is NOT an exception: it comes back as a normal 200 response with
 * {@code valid: false} and an {@code error} field on the result itself. Exceptions here are for
 * transport and authorization failures only.
 */
public class IBANforgeException extends RuntimeException {

    private final Integer status;
    private final Object body;
    private final String code;

    public IBANforgeException(String message) {
        this(message, null, null);
    }

    /**
     * @param status the HTTP status, or null for a client-side / network failure.
     * @param body   the parsed response body: a {@link JsonNode} when the response was valid
     *               JSON, otherwise the raw response text as a {@link String}. May be null.
     */
    public IBANforgeException(String message, Integer status, Object body) {
        super(message);
        this.status = status;
        this.body = body;
        this.code = extractCode(body);
    }

    private static String extractCode(Object body) {
        if (body instanceof JsonNode node && node.isObject()) {
            JsonNode error = node.get("error");
            if (error != null && error.isTextual()) {
                return error.asText();
            }
        }
        return null;
    }

    /** The HTTP status, when the failure came from the API. Null for a network/timeout failure. */
    public Integer getStatus() {
        return status;
    }

    /**
     * The parsed response body: a {@link JsonNode} when the response was valid JSON, otherwise
     * the raw response text as a {@link String}. Null when there was no response to parse.
     */
    public Object getBody() {
        return body;
    }

    /**
     * The API's machine-readable error slug ({@code invalid_key}, {@code disposable_email},
     * {@code verification_required}, {@code rate_limited}, ...), lifted out of the response
     * body. Null when the body carries no {@code error} field, or is not a JSON object.
     */
    public String getCode() {
        return code;
    }
}
