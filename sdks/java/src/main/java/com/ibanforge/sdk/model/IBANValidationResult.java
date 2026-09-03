package com.ibanforge.sdk.model;

import java.util.List;

/**
 * Result of {@code POST /v1/iban/validate} (and the entries inside an {@link IBANBatchResult}).
 *
 * <p>The IBAN {@code CH9300762011623852957} -- the SWIFT registry's illustration -- carries a
 * bank code no institution holds, so it comes back with {@link #bic()} and {@link #clearing()}
 * both null. Use {@link com.ibanforge.sdk.IBANforge#testIban} for a fixture whose bank code is
 * really allocated.
 */
public record IBANValidationResult(
    String iban,
    boolean valid,
    String formatted,
    Country country,
    String checkDigits,
    BBAN bban,
    /** Null when no directory knows the bank code -- check {@link #bankCodeCheck()}. */
    BIC bic,
    Issuer issuer,
    SEPA sepa,
    RiskIndicators riskIndicators,
    BankCodeCheck bankCodeCheck,
    /** Swiss/Liechtenstein IBANs only, and only when the IID is allocated. */
    Clearing clearing,
    List<NextStep> nextSteps,
    String error,
    String errorDetail,
    double costUsdc,
    Double processingMs
) {
}
