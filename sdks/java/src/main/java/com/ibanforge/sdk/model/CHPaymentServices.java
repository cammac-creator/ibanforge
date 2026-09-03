package com.ibanforge.sdk.model;

/** Swiss payment-rail participation flags nested inside a {@link CHClearingResult}. */
public record CHPaymentServices(
    boolean sic,
    boolean rtgsChf,
    boolean instantPaymentsChf,
    boolean eurosic,
    boolean lsvBddChf,
    boolean lsvBddEur
) {
}
