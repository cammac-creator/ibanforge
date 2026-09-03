package com.ibanforge.sdk.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/** What the API suggests doing next, given this exact verdict. */
public record NextStep(
    String code,
    /**
     * What to do. Named {@code doStep} rather than {@code do} because {@code do} is a reserved
     * word in Java; the JSON field is {@code "do"}.
     */
    @JsonProperty("do") String doStep,
    String because,
    /** HTTP method + path to call next, e.g. "POST /v1/iban/compliance". */
    String action
) {
}
