package com.ibanforge.sdk.model;

/** Scope + freshness disclosure attached to every {@link ComplianceResult}. */
public record ComplianceMeta(
    /** Always "bank_bic_only" -- screening is at the bank BIC, never the beneficiary. */
    String scope,
    String disclaimer,
    String sanctionsAsOf,
    String fatfAsOf,
    String sources,
    String countryRiskAsOf,
    /** Says in prose why {@code risk_indicators.country_risk} and {@code fatf_status} can disagree. */
    String countryRiskScope
) {
}
