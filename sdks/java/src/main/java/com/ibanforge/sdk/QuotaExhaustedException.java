package com.ibanforge.sdk;

/**
 * 429 with {@code error: "quota_exceeded"} -- the API key's monthly quota is exhausted.
 *
 * <p>By default the IBANforge API falls back to advertising x402 payment requirements
 * (HTTP 402) instead of returning 429, so a caller can keep going by paying per call. This
 * exception is only raised when the server explicitly returns 429 with this slug.
 */
public class QuotaExhaustedException extends IBANforgeException {
    public QuotaExhaustedException(String message, Integer status, Object body) {
        super(message, status, body);
    }
}
