package com.ibanforge.sdk.model;

import java.util.List;

/** Result of {@code POST /v1/iban/batch} -- up to 100 IBANs validated in one call. */
public record IBANBatchResult(
    List<IBANValidationResult> results,
    int count,
    int validCount,
    double costUsdc,
    Double processingMs
) {
}
