package com.ibanforge.sdk.model;

import java.util.List;

/**
 * Result of {@code POST /v1/iban/compliance} -- the validate result PLUS a nested
 * {@link #compliance()} block. There is no top-level risk score; read it at
 * {@code result.compliance().riskScore()}.
 *
 * <p>Scope: sanctions screening is BANK-level (BIC8) only, not beneficiary-name -- see
 * {@link #meta()}.
 *
 * <p>Carries every field of {@link IBANValidationResult} (the TypeScript SDK types this as an
 * {@code extends}) plus {@link #compliance()} and {@link #meta()}, flattened into one record
 * because the JSON itself is one flat object.
 */
public record ComplianceResult(
    String iban,
    boolean valid,
    String formatted,
    Country country,
    String checkDigits,
    BBAN bban,
    BIC bic,
    Issuer issuer,
    SEPA sepa,
    RiskIndicators riskIndicators,
    BankCodeCheck bankCodeCheck,
    Clearing clearing,
    List<NextStep> nextSteps,
    String error,
    String errorDetail,
    double costUsdc,
    Double processingMs,
    Compliance compliance,
    ComplianceMeta meta
) {
}
