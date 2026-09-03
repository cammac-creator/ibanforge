package com.ibanforge.sdk;

/**
 * 413 -- the request body is over the API's limit (1 MB, and a batch is capped at 100 IBANs
 * before that).
 *
 * <p>Broken out of {@link InvalidInputException} on 2026-09-01 (audit DX-09): 413 is a
 * distinct, reproducible answer with a distinct remedy -- split the payload -- and a caller
 * that catches "malformed input" would otherwise retry the same body forever.
 */
public class PayloadTooLargeException extends IBANforgeException {
    public PayloadTooLargeException(String message, Integer status, Object body) {
        super(message, status, body);
    }
}
