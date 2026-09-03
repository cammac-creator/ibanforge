using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>The <c>proof</c> block of a <see cref="TestIbanEntry"/>: the register row backing its bank code.</summary>
public sealed record TestIbanProof
{
    /// <summary>Confirms the bank code is really allocated.</summary>
    [JsonPropertyName("bank_code_check")]
    public BankCodeCheck BankCodeCheck { get; init; } = new();

    /// <summary>The resolved BIC, when the register carries one.</summary>
    [JsonPropertyName("bic")]
    public Bic? Bic { get; init; }
}

/// <summary>One minted test IBAN, with the register row that proves its bank code is real.</summary>
public sealed record TestIbanEntry
{
    /// <summary>The test IBAN.</summary>
    [JsonPropertyName("iban")]
    public string Iban { get; init; } = string.Empty;

    /// <summary>The IBAN with the conventional 4-character grouping.</summary>
    [JsonPropertyName("formatted")]
    public string Formatted { get; init; } = string.Empty;

    /// <summary>ISO 3166-1 alpha-2 country code.</summary>
    [JsonPropertyName("country")]
    public string Country { get; init; } = string.Empty;

    /// <summary>The register row backing this IBAN's bank code.</summary>
    [JsonPropertyName("proof")]
    public TestIbanProof Proof { get; init; } = new();

    /// <summary>Explains that the account digits are random and this is not a real account.</summary>
    [JsonPropertyName("note")]
    public string Note { get; init; } = string.Empty;
}

/// <summary>
/// Result of <see cref="IBANforgeClient.TestIbanAsync"/>: structurally valid
/// IBANs whose bank code is REALLY allocated (drawn from the national register)
/// and whose account digits are random. FREE.
///
/// Use this instead of the SWIFT registry's illustration for fixtures and
/// demos: that one's bank code belongs to nobody, so every enrichment field
/// comes back null.
/// </summary>
public sealed record TestIbanResult
{
    /// <summary>The minted test IBANs.</summary>
    [JsonPropertyName("test_ibans")]
    public List<TestIbanEntry> TestIbans { get; init; } = new();

    /// <summary>Explains that bank codes are real but account digits are not; never send money to these.</summary>
    [JsonPropertyName("disclaimer")]
    public string Disclaimer { get; init; } = string.Empty;

    /// <summary>Link to further documentation.</summary>
    [JsonPropertyName("docs")]
    public string? Docs { get; init; }

    /// <summary>Cost of this call in USDC (always 0: this route is free).</summary>
    [JsonPropertyName("cost_usdc")]
    public double? CostUsdc { get; init; }
}
