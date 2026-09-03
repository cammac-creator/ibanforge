using System.Text.Json;
using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>
/// The ISO 20022 postal address tags <see cref="IBANforgeClient.CheckAddressAsync"/>
/// reads, for the SPS 2026 / Fedwire / T2 structured-address deadlines.
///
/// Any ISO tag not modelled explicitly below (an unusual line, a scheme-specific
/// extension) can still be sent through <see cref="ExtraTags"/>, mirroring the
/// TypeScript SDK's <c>[tag: string]: unknown</c> index signature.
/// </summary>
public sealed record PostalAddress
{
    /// <summary>Town name (<c>TwnNm</c>).</summary>
    [JsonPropertyName("twn_nm")]
    public string? TwnNm { get; init; }

    /// <summary>ISO 3166-1 alpha-2 country code (<c>Ctry</c>).</summary>
    [JsonPropertyName("ctry")]
    public string? Ctry { get; init; }

    /// <summary>Postal code (<c>PstCd</c>).</summary>
    [JsonPropertyName("pst_cd")]
    public string? PstCd { get; init; }

    /// <summary>Street name (<c>StrtNm</c>).</summary>
    [JsonPropertyName("strt_nm")]
    public string? StrtNm { get; init; }

    /// <summary>Building number (<c>BldgNb</c>).</summary>
    [JsonPropertyName("bldg_nb")]
    public string? BldgNb { get; init; }

    /// <summary>Address type (<c>AdrTp</c>). Forbidden by SPS ("N: Must not be sent").</summary>
    [JsonPropertyName("adr_tp")]
    public string? AdrTp { get; init; }

    /// <summary>Free-form address lines (<c>AdrLine</c>).</summary>
    [JsonPropertyName("adr_line")]
    public List<string>? AdrLine { get; init; }

    /// <summary>Any additional ISO 20022 tag not modelled above.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtraTags { get; init; }
}

/// <summary>One rule applied by <see cref="IBANforgeClient.CheckAddressAsync"/>, with the guideline it comes from.</summary>
public sealed record AddressFinding
{
    /// <summary>Stable identifier for the rule evaluated, e.g. <c>"adr_line_no_repeat"</c>.</summary>
    [JsonPropertyName("rule")]
    public string Rule { get; init; } = string.Empty;

    /// <summary>
    /// One of <c>"pass"</c>, <c>"fail"</c>, <c>"not_applicable"</c> (a rule whose
    /// precondition was not met, a real answer rather than a polite pass), or another
    /// value the server may add.
    /// </summary>
    [JsonPropertyName("verdict")]
    public string Verdict { get; init; } = string.Empty;

    /// <summary>Explanation of the verdict.</summary>
    [JsonPropertyName("detail")]
    public string Detail { get; init; } = string.Empty;

    /// <summary>The document this rule comes from, with its date.</summary>
    [JsonPropertyName("source")]
    public string Source { get; init; } = string.Empty;
}

/// <summary>
/// Result of <see cref="IBANforgeClient.CheckAddressAsync"/>: a structured ISO
/// 20022 postal address measured against a payment scheme's rules. FREE.
/// </summary>
public sealed record AddressCheckResult
{
    /// <summary>The scheme the address was checked against.</summary>
    [JsonPropertyName("scheme")]
    public string Scheme { get; init; } = string.Empty;

    /// <summary>True when no finding failed. Rules that did not apply do not count against it.</summary>
    [JsonPropertyName("conforms")]
    public bool Conforms { get; init; }

    /// <summary>One finding per rule evaluated.</summary>
    [JsonPropertyName("findings")]
    public List<AddressFinding> Findings { get; init; } = new();

    /// <summary>Free-text note, e.g. why no <c>cbpr+</c> scheme is offered.</summary>
    [JsonPropertyName("note")]
    public string? Note { get; init; }
}
