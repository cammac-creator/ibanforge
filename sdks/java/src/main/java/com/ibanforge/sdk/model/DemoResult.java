package com.ibanforge.sdk.model;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/** Result of the FREE {@code GET /v1/demo} -- worked examples of every endpoint. */
public record DemoResult(
    String message,
    List<IBANValidationResult> ibanExamples,
    List<BICLookupResult> bicExamples,
    /** Shape is intentionally undocumented upstream; read it as a raw tree. */
    JsonNode complianceExample
) {
}
