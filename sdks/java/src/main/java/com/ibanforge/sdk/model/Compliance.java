package com.ibanforge.sdk.model;

import java.util.List;

/** The {@code compliance} block nested inside a {@link ComplianceResult}. */
public record Compliance(
    Sanctions sanctions,
    Reachability reachability,
    VoP vop,
    /** Null when the IBAN did not validate: there was nothing to score. 0 (safest) .. 100. */
    Double riskScore,
    /**
     * One of "low", "medium", "elevated", "high", "critical", "unassessable".
     *
     * <p>{@code unassessable} means the IBAN itself failed validation, so no screening was
     * possible. It is the absence of a verdict, never a favourable one: do not fold it into a
     * "safe to pay" branch.
     */
    String riskLevel,
    List<String> flags
) {
}
