package com.ibanforge.sdk.model;

import java.util.List;

/**
 * Result of the FREE {@code POST /v1/address/check} -- a structured ISO 20022 postal address
 * measured against a payment scheme's rules ({@code sps}, {@code hvps_plus}, {@code fedwire}).
 */
public record AddressCheckResult(
    String scheme,
    boolean conforms,
    List<AddressFinding> findings,
    String note
) {
}
