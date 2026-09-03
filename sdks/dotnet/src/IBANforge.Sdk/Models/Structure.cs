using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>One entry of <see cref="IbanStructureList.Countries"/>.</summary>
public sealed record IbanStructureCountrySummary
{
    /// <summary>ISO 3166-1 alpha-2 code.</summary>
    [JsonPropertyName("code")]
    public string Code { get; init; } = string.Empty;

    /// <summary>Display name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    /// <summary>Total IBAN length for this country.</summary>
    [JsonPropertyName("iban_length")]
    public int IbanLength { get; init; }

    /// <summary>Whether the country is a SEPA member.</summary>
    [JsonPropertyName("sepa_member")]
    public bool SepaMember { get; init; }

    /// <summary>Whether a BBAN structure breakdown is available.</summary>
    [JsonPropertyName("has_bban_structure")]
    public bool HasBbanStructure { get; init; }

    /// <summary>Whether an example IBAN is available.</summary>
    [JsonPropertyName("has_example")]
    public bool HasExample { get; init; }
}

/// <summary>
/// Result of <see cref="IBANforgeClient.IbanStructuresAsync"/>: every country
/// the API can parse, with its IBAN length. FREE.
/// </summary>
public sealed record IbanStructureList
{
    /// <summary>Total number of countries listed.</summary>
    [JsonPropertyName("total")]
    public int Total { get; init; }

    /// <summary>One entry per supported country.</summary>
    [JsonPropertyName("countries")]
    public List<IbanStructureCountrySummary> Countries { get; init; } = new();

    /// <summary>Route to fetch a single country's full template, e.g. <c>"GET /v1/iban/structure/:country"</c>.</summary>
    [JsonPropertyName("endpoint_per_country")]
    public string EndpointPerCountry { get; init; } = string.Empty;

    /// <summary>Cost of this call in USDC (always 0: this route is free).</summary>
    [JsonPropertyName("cost_usdc")]
    public double? CostUsdc { get; init; }
}

/// <summary>One field of a <see cref="IbanStructure.Bban"/> template.</summary>
public sealed record BbanFieldSpec
{
    /// <summary>0-indexed start offset within the BBAN portion of the IBAN.</summary>
    [JsonPropertyName("start")]
    public int Start { get; init; }

    /// <summary>Field length in characters.</summary>
    [JsonPropertyName("length")]
    public int Length { get; init; }

    /// <summary>Charset specifier, e.g. <c>"5!n"</c> (5 numeric) or <c>"12!c"</c> (12 alphanumeric).</summary>
    [JsonPropertyName("charset")]
    public string Charset { get; init; } = string.Empty;
}

/// <summary>
/// Result of <see cref="IBANforgeClient.IbanStructureAsync"/>: one country's
/// BBAN template: field offsets, lengths, charsets. FREE.
/// </summary>
public sealed record IbanStructure
{
    /// <summary>The country this template describes.</summary>
    [JsonPropertyName("country")]
    public Country Country { get; init; } = new();

    /// <summary>Total IBAN length for this country.</summary>
    [JsonPropertyName("iban_length")]
    public int IbanLength { get; init; }

    /// <summary>BBAN length (IBAN length minus country code and check digits).</summary>
    [JsonPropertyName("bban_length")]
    public int BbanLength { get; init; }

    /// <summary>BBAN fields, keyed by field name (e.g. <c>"bank_code"</c>, <c>"account_number"</c>).</summary>
    [JsonPropertyName("bban")]
    public Dictionary<string, BbanFieldSpec> Bban { get; init; } = new();

    /// <summary>Compact BBAN pattern, e.g. <c>"5!n12!c"</c>.</summary>
    [JsonPropertyName("bban_pattern")]
    public string BbanPattern { get; init; } = string.Empty;

    /// <summary>SEPA membership and reachability for this country.</summary>
    [JsonPropertyName("sepa")]
    public Sepa? Sepa { get; init; }

    /// <summary>An illustrative IBAN for this country.</summary>
    [JsonPropertyName("example_iban")]
    public string? ExampleIban { get; init; }

    /// <summary>Warns that the registry's example may carry an unallocated bank code.</summary>
    [JsonPropertyName("example_iban_note")]
    public string? ExampleIbanNote { get; init; }

    /// <summary>Free-text notes about this country's BBAN layout.</summary>
    [JsonPropertyName("notes")]
    public string? Notes { get; init; }

    /// <summary>Points at full validation for enrichment beyond structure.</summary>
    [JsonPropertyName("upgrade_hint")]
    public string? UpgradeHint { get; init; }

    /// <summary>Cost of this call in USDC (always 0: this route is free).</summary>
    [JsonPropertyName("cost_usdc")]
    public double? CostUsdc { get; init; }
}
