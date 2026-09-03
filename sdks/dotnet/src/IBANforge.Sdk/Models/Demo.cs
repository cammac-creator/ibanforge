using System.Text.Json;
using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>
/// Result of <see cref="IBANforgeClient.DemoAsync"/>: worked examples of every
/// endpoint, no key and no payment required.
///
/// The example entries are illustrative and may carry extra labelling fields or
/// omit fields a live call always returns (e.g. <c>bic_examples</c> entries omit
/// <see cref="BicLookupResult.ValidFormat"/>); treat this as a demo, not a
/// strict contract.
/// </summary>
public sealed record DemoResult
{
    /// <summary>Human-readable description of what this endpoint returns.</summary>
    [JsonPropertyName("message")]
    public string Message { get; init; } = string.Empty;

    /// <summary>Worked IBAN validation examples.</summary>
    [JsonPropertyName("iban_examples")]
    public List<IbanValidationResult>? IbanExamples { get; init; }

    /// <summary>Worked BIC lookup examples.</summary>
    [JsonPropertyName("bic_examples")]
    public List<BicLookupResult>? BicExamples { get; init; }

    /// <summary>
    /// A worked compliance check example. Left as raw JSON (rather than typed as
    /// <see cref="ComplianceResult"/>) because the server nests it under
    /// descriptive wrapper fields (<c>description</c>, <c>endpoint</c>, <c>cost</c>,
    /// <c>result</c>) rather than returning a bare result; mirrors the TypeScript
    /// SDK's <c>unknown</c> typing for this field exactly.
    /// </summary>
    [JsonPropertyName("compliance_example")]
    public JsonElement? ComplianceExample { get; init; }
}
