package com.ibanforge.sdk.model;

/** Quick risk signals attached to a validated IBAN. */
public record RiskIndicators(
    /** One of "bank", "digital_bank", "emi", "payment_institution", or null. */
    String issuerType,
    /** One of "standard", "elevated", "high". */
    String countryRisk,
    boolean testBic,
    boolean sepaReachable,
    /** "country" when reachability is inferred from the zone, not the institution. */
    String sepaReachableScope,
    boolean vopCoverage
) {
}
