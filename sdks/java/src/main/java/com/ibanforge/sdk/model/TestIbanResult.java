package com.ibanforge.sdk.model;

import java.util.List;

/**
 * Result of the FREE {@code GET /v1/test-iban} -- structurally valid IBANs whose bank code is
 * REALLY allocated (drawn from the national register served by the API) and whose account
 * digits are random. Use this instead of a registry illustration for fixtures and demos.
 */
public record TestIbanResult(
    List<TestIbanEntry> testIbans,
    String disclaimer,
    String docs,
    Double costUsdc
) {
}
