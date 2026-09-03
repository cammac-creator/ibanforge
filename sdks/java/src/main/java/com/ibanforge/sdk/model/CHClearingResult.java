package com.ibanforge.sdk.model;

import java.util.List;
import java.util.Map;

/**
 * Result of {@code GET /v1/ch/clearing/:iid} -- Swiss BC-Nummer / IID resolution, backed by
 * SIX BankMaster.
 */
public record CHClearingResult(
    String iid,
    boolean found,
    String redirectedFrom,
    CHInstitution institution,
    Map<String, String> address,
    String bic,
    CHPaymentServices paymentServices,
    String sicIid,
    String qrIid,
    String qrIidSource,
    List<String> qrIids,
    String validOn,
    String note,
    String error,
    String message,
    Double costUsdc,
    Double processingMs
) {
}
