package com.ibanforge.sdk;

/** 429 -- global (per-IP) transport rate limit exceeded. Back off and retry. */
public class RateLimitException extends IBANforgeException {
    public RateLimitException(String message, Integer status, Object body) {
        super(message, status, body);
    }
}
