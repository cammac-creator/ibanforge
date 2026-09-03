package com.ibanforge.sdk;

/** 401 / 403 -- API key is missing, invalid, revoked, or mailbox verification is required. */
public class AuthException extends IBANforgeException {
    public AuthException(String message) {
        super(message);
    }

    public AuthException(String message, Integer status, Object body) {
        super(message, status, body);
    }
}
