using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>
/// The <c>sanctions</c> block of a <see cref="Compliance"/> verdict.
///
/// <see cref="BankScreened"/> false means the screening did not run (no bank
/// could be identified), never that the bank came back clean. Absence of a
/// verdict, not a favourable one.
/// </summary>
public sealed record ComplianceSanctions
{
    /// <summary>Whether the IBAN's country is under sanctions.</summary>
    [JsonPropertyName("country_sanctioned")]
    public bool CountrySanctioned { get; init; }

    /// <summary>Whether the resolved bank (BIC8) is under sanctions.</summary>
    [JsonPropertyName("bank_sanctioned")]
    public bool BankSanctioned { get; init; }

    /// <summary>Which sanctions lists matched, if any.</summary>
    [JsonPropertyName("matched_lists")]
    public List<string> MatchedLists { get; init; } = new();

    /// <summary>FATF jurisdiction status.</summary>
    [JsonPropertyName("fatf_status")]
    public string FatfStatus { get; init; } = string.Empty;

    /// <summary>Whether bank-level sanctions screening actually ran for this IBAN.</summary>
    [JsonPropertyName("bank_screened")]
    public bool? BankScreened { get; init; }
}

/// <summary>The <c>reachability</c> block of a <see cref="Compliance"/> verdict.</summary>
public sealed record ComplianceReachability
{
    /// <summary>Whether the account is reachable over SEPA Instant.</summary>
    [JsonPropertyName("sepa_instant")]
    public bool SepaInstant { get; init; }

    /// <summary>Whether the account is reachable over SEPA Credit Transfer.</summary>
    [JsonPropertyName("sct")]
    public bool Sct { get; init; }

    /// <summary>Whether the account is reachable over SEPA Direct Debit.</summary>
    [JsonPropertyName("sdd")]
    public bool Sdd { get; init; }

    /// <summary>Whether reachability screening actually ran for this IBAN.</summary>
    [JsonPropertyName("screened")]
    public bool? Screened { get; init; }
}

/// <summary>The <c>vop</c> (Verification of Payee) block of a <see cref="Compliance"/> verdict.</summary>
public sealed record ComplianceVop
{
    /// <summary>Whether the institution participates in Verification of Payee.</summary>
    [JsonPropertyName("participant")]
    public bool Participant { get; init; }

    /// <summary>Participation status detail.</summary>
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    /// <summary>Whether VoP screening actually ran for this IBAN.</summary>
    [JsonPropertyName("screened")]
    public bool? Screened { get; init; }
}

/// <summary>
/// The <c>compliance</c> block nested in a <see cref="ComplianceResult"/>.
///
/// Informational triage only, not a regulated AML/CFT product. Sanctions
/// screening is at the BANK (BIC8) level only; see <see cref="ComplianceMeta.Disclaimer"/>.
/// </summary>
public sealed record Compliance
{
    /// <summary>Sanctions screening verdict.</summary>
    [JsonPropertyName("sanctions")]
    public ComplianceSanctions Sanctions { get; init; } = new();

    /// <summary>Payment-rail reachability.</summary>
    [JsonPropertyName("reachability")]
    public ComplianceReachability Reachability { get; init; } = new();

    /// <summary>Verification of Payee status.</summary>
    [JsonPropertyName("vop")]
    public ComplianceVop Vop { get; init; } = new();

    /// <summary>0-100 risk score, or null when the IBAN did not validate: there was nothing to score.</summary>
    [JsonPropertyName("risk_score")]
    public double? RiskScore { get; init; }

    /// <summary>
    /// One of <c>"low"</c>, <c>"medium"</c>, <c>"elevated"</c>, <c>"high"</c>,
    /// <c>"critical"</c>, <c>"unassessable"</c>. <c>"unassessable"</c> means the
    /// IBAN itself failed validation, so no screening was possible: absence of a
    /// verdict, never a favourable one. Do not fold it into a "safe to pay" branch.
    /// </summary>
    [JsonPropertyName("risk_level")]
    public string RiskLevel { get; init; } = string.Empty;

    /// <summary>Flags raised during screening.</summary>
    [JsonPropertyName("flags")]
    public List<string> Flags { get; init; } = new();
}

/// <summary>Metadata describing the scope and freshness of a <see cref="ComplianceResult"/>.</summary>
public sealed record ComplianceMeta
{
    /// <summary>Always <c>"bank_bic_only"</c>: screening is at the bank BIC, never the beneficiary.</summary>
    [JsonPropertyName("scope")]
    public string Scope { get; init; } = "bank_bic_only";

    /// <summary>Full-text disclaimer describing what this screening does and does not cover.</summary>
    [JsonPropertyName("disclaimer")]
    public string Disclaimer { get; init; } = string.Empty;

    /// <summary>When the sanctions lists were last refreshed, or null.</summary>
    [JsonPropertyName("sanctions_as_of")]
    public string? SanctionsAsOf { get; init; }

    /// <summary>When the FATF status was last refreshed, or null.</summary>
    [JsonPropertyName("fatf_as_of")]
    public string? FatfAsOf { get; init; }

    /// <summary>Source lists consulted, or null.</summary>
    [JsonPropertyName("sources")]
    public string? Sources { get; init; }

    /// <summary>When the country-risk editorial data was last refreshed, or null.</summary>
    [JsonPropertyName("country_risk_as_of")]
    public string? CountryRiskAsOf { get; init; }

    /// <summary>
    /// Explains in prose why <c>risk_indicators.country_risk</c> and
    /// <see cref="ComplianceSanctions.FatfStatus"/> can disagree: the former is a
    /// separate editorial AML axis layered on top of the latter, not a restatement
    /// of it.
    /// </summary>
    [JsonPropertyName("country_risk_scope")]
    public string? CountryRiskScope { get; init; }
}

/// <summary>
/// Result of <see cref="IBANforgeClient.CheckComplianceAsync"/>: the validate
/// result PLUS a nested <see cref="Compliance"/> block. There is no
/// top-level risk score; read it at <c>result.Compliance.RiskScore</c>.
/// </summary>
public sealed record ComplianceResult : IbanValidationResult
{
    /// <summary>The compliance verdict.</summary>
    [JsonPropertyName("compliance")]
    public Compliance Compliance { get; init; } = new();

    /// <summary>Scope and freshness metadata for this screening.</summary>
    [JsonPropertyName("meta")]
    public ComplianceMeta? Meta { get; init; }
}
