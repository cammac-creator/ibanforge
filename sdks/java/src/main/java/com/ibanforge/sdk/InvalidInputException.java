package com.ibanforge.sdk;

/**
 * Other 4xx -- malformed request (bad IBAN length, bad BIC format, missing query param, an
 * oversized {@code validateBatch} call caught client-side before any network call, etc).
 *
 * <p>Note: a malformed IBAN is NOT this exception. It comes back as a normal 200 response with
 * {@code valid: false} on the result.
 */
public class InvalidInputException extends IBANforgeException {
    public InvalidInputException(String message) {
        super(message);
    }

    public InvalidInputException(String message, Integer status, Object body) {
        super(message, status, body);
    }
}
