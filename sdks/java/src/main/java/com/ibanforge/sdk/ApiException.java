package com.ibanforge.sdk;

/** 5xx -- server-side failure. Retry with backoff. */
public class ApiException extends IBANforgeException {
    public ApiException(String message) {
        super(message);
    }

    public ApiException(String message, Integer status, Object body) {
        super(message, status, body);
    }
}
