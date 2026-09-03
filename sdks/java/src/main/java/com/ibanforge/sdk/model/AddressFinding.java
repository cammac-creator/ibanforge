package com.ibanforge.sdk.model;

/** One rule applied by {@code POST /v1/address/check}, with the guideline it comes from. */
public record AddressFinding(
    String rule,
    /** e.g. "pass", "fail", "not_applicable". */
    String verdict,
    String detail,
    String source
) {
}
