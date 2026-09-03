using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>
/// Result of <see cref="IBANforgeClient.ValidateIbanAsync"/>.
///
/// Not <c>sealed</c> (unlike every other model in this SDK) because
/// <see cref="ComplianceResult"/> mirrors the TypeScript SDK's
/// <c>ComplianceResult extends IBANValidationResult</c> exactly: every field
/// here plus a nested <c>compliance</c> block.
/// </summary>
public record IbanValidationResult
{
    /// <summary>The IBAN as submitted.</summary>
    [JsonPropertyName("iban")]
    public string Iban { get; init; } = string.Empty;

    /// <summary>Whether the IBAN passed structural and checksum validation.</summary>
    [JsonPropertyName("valid")]
    public bool Valid { get; init; }

    /// <summary>The IBAN with the conventional 4-character grouping.</summary>
    [JsonPropertyName("formatted")]
    public string? Formatted { get; init; }

    /// <summary>The IBAN's country.</summary>
    [JsonPropertyName("country")]
    public Country? Country { get; init; }

    /// <summary>The 2-digit IBAN check digits.</summary>
    [JsonPropertyName("check_digits")]
    public string? CheckDigits { get; init; }

    /// <summary>The parsed Basic Bank Account Number.</summary>
    [JsonPropertyName("bban")]
    public Bban? Bban { get; init; }

    /// <summary>Null when no directory knows the bank code: check <see cref="BankCodeCheck"/> for why.</summary>
    [JsonPropertyName("bic")]
    public Bic? Bic { get; init; }

    /// <summary>Issuer / institution classification.</summary>
    [JsonPropertyName("issuer")]
    public Issuer? Issuer { get; init; }

    /// <summary>SEPA membership and reachability.</summary>
    [JsonPropertyName("sepa")]
    public Sepa? Sepa { get; init; }

    /// <summary>Computed risk indicators.</summary>
    [JsonPropertyName("risk_indicators")]
    public RiskIndicators? RiskIndicators { get; init; }

    /// <summary>Whether the bank code is actually allocated in the national register.</summary>
    [JsonPropertyName("bank_code_check")]
    public BankCodeCheck? BankCodeCheck { get; init; }

    /// <summary>Swiss/Liechtenstein clearing data, and only when the IID is allocated.</summary>
    [JsonPropertyName("clearing")]
    public Clearing? Clearing { get; init; }

    /// <summary>What the API suggests doing next, given this exact verdict.</summary>
    [JsonPropertyName("next_steps")]
    public List<NextStep>? NextSteps { get; init; }

    /// <summary>Machine-readable error slug, when <see cref="Valid"/> is false.</summary>
    [JsonPropertyName("error")]
    public string? Error { get; init; }

    /// <summary>Human-readable detail for <see cref="Error"/>.</summary>
    [JsonPropertyName("error_detail")]
    public string? ErrorDetail { get; init; }

    /// <summary>Cost of this call in USDC.</summary>
    [JsonPropertyName("cost_usdc")]
    public double CostUsdc { get; init; }

    /// <summary>Server-side processing time in milliseconds.</summary>
    [JsonPropertyName("processing_ms")]
    public double? ProcessingMs { get; init; }
}

/// <summary>
/// Result of <see cref="IBANforgeClient.FormatIbanAsync"/>: the FREE pre-flight
/// check (mod-97 + structure only). No BIC, no SEPA, no compliance data; use
/// <see cref="IBANforgeClient.ValidateIbanAsync"/> for full enrichment.
/// </summary>
public sealed record IbanFormatResult
{
    /// <summary>The IBAN as submitted.</summary>
    [JsonPropertyName("iban")]
    public string Iban { get; init; } = string.Empty;

    /// <summary>The IBAN with the conventional 4-character grouping.</summary>
    [JsonPropertyName("formatted")]
    public string? Formatted { get; init; }

    /// <summary>Whether the IBAN passed structural and checksum validation.</summary>
    [JsonPropertyName("valid")]
    public bool Valid { get; init; }

    /// <summary>The IBAN's country.</summary>
    [JsonPropertyName("country")]
    public Country? Country { get; init; }

    /// <summary>The 2-digit IBAN check digits.</summary>
    [JsonPropertyName("check_digits")]
    public string? CheckDigits { get; init; }

    /// <summary>The parsed Basic Bank Account Number.</summary>
    [JsonPropertyName("bban")]
    public Bban? Bban { get; init; }

    /// <summary>Machine-readable error slug, when <see cref="Valid"/> is false.</summary>
    [JsonPropertyName("error")]
    public string? Error { get; init; }

    /// <summary>Human-readable detail for <see cref="Error"/>.</summary>
    [JsonPropertyName("error_detail")]
    public string? ErrorDetail { get; init; }

    /// <summary>Points at <see cref="IBANforgeClient.ValidateIbanAsync"/> for full enrichment.</summary>
    [JsonPropertyName("upgrade_to_full_validation")]
    public string? UpgradeToFullValidation { get; init; }
}

/// <summary>Result of <see cref="IBANforgeClient.ValidateBatchAsync"/>: up to 100 IBANs validated in one call.</summary>
public sealed record IbanBatchResult
{
    /// <summary>One validation result per submitted IBAN, in the same order.</summary>
    [JsonPropertyName("results")]
    public List<IbanValidationResult> Results { get; init; } = new();

    /// <summary>Number of IBANs submitted.</summary>
    [JsonPropertyName("count")]
    public int Count { get; init; }

    /// <summary>Number of IBANs that validated successfully.</summary>
    [JsonPropertyName("valid_count")]
    public int ValidCount { get; init; }

    /// <summary>Total cost of this call in USDC.</summary>
    [JsonPropertyName("cost_usdc")]
    public double CostUsdc { get; init; }

    /// <summary>Server-side processing time in milliseconds.</summary>
    [JsonPropertyName("processing_ms")]
    public double? ProcessingMs { get; init; }
}
