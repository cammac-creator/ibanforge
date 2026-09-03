using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>An ISO 3166-1 alpha-2 country.</summary>
public sealed record Country
{
    /// <summary>ISO 3166-1 alpha-2 code, e.g. <c>"CH"</c>.</summary>
    [JsonPropertyName("code")]
    public string Code { get; init; } = string.Empty;

    /// <summary>Display name, e.g. <c>"Switzerland"</c>.</summary>
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;
}

/// <summary>The Basic Bank Account Number parsed out of an IBAN.</summary>
public sealed record Bban
{
    /// <summary>National bank code.</summary>
    [JsonPropertyName("bank_code")]
    public string BankCode { get; init; } = string.Empty;

    /// <summary>Branch/sort code, when the country's BBAN carries one separately from the bank code.</summary>
    [JsonPropertyName("branch_code")]
    public string? BranchCode { get; init; }

    /// <summary>The account number portion of the BBAN.</summary>
    [JsonPropertyName("account_number")]
    public string AccountNumber { get; init; } = string.Empty;
}

/// <summary>
/// Registered / head-office address as GLEIF files it.
///
/// Shared by <see cref="Bic"/> and <see cref="BicLookupResult"/> because the API
/// builds both from the same helper.
/// </summary>
public sealed record RegisteredAddress
{
    /// <summary>Always <c>"registered"</c>.</summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = "registered";

    /// <summary>Street, or null when GLEIF carries none.</summary>
    [JsonPropertyName("street")]
    public string? Street { get; init; }

    /// <summary>Postal code, or null.</summary>
    [JsonPropertyName("post_code")]
    public string? PostCode { get; init; }

    /// <summary>Region/subdivision, or null.</summary>
    [JsonPropertyName("region")]
    public string? Region { get; init; }

    /// <summary>City, or null.</summary>
    [JsonPropertyName("city")]
    public string? City { get; init; }

    /// <summary>ISO 3166-1 alpha-2 country code.</summary>
    [JsonPropertyName("country")]
    public string Country { get; init; } = string.Empty;

    /// <summary>
    /// Latin reading: GLEIF's official English form for a non-Latin entity, or the
    /// address itself when already Latin. Null when the entity is non-Latin and
    /// GLEIF ships no Latin form, a transliteration is never invented.
    /// </summary>
    [JsonPropertyName("romanized")]
    public string? Romanized { get; init; }

    /// <summary>One of <c>"original_latin"</c>, <c>"gleif_english"</c>, <c>"unavailable"</c>.</summary>
    [JsonPropertyName("romanization")]
    public string Romanization { get; init; } = string.Empty;

    /// <summary>The dataset this address came from, e.g. <c>"GLEIF"</c>.</summary>
    [JsonPropertyName("source")]
    public string Source { get; init; } = string.Empty;

    /// <summary>Language of the address text, or null.</summary>
    [JsonPropertyName("language")]
    public string? Language { get; init; }

    /// <summary>
    /// When the entity last filed this address. Frequently a year old, and NOT the
    /// same date as a sibling <see cref="Bic"/>'s <c>as_of</c>: that one dates the
    /// monthly directory refresh, not the filing.
    /// </summary>
    [JsonPropertyName("as_of")]
    public string? AsOf { get; init; }
}

/// <summary>What the API suggests doing next, given this exact verdict.</summary>
public sealed record NextStep
{
    /// <summary>Stable machine-readable code for this suggestion.</summary>
    [JsonPropertyName("code")]
    public string Code { get; init; } = string.Empty;

    /// <summary>What to do.</summary>
    [JsonPropertyName("do")]
    public string Do { get; init; } = string.Empty;

    /// <summary>Why this suggestion applies to this result.</summary>
    [JsonPropertyName("because")]
    public string Because { get; init; } = string.Empty;

    /// <summary>The concrete follow-up call, e.g. <c>"POST /v1/iban/compliance"</c>, when there is one.</summary>
    [JsonPropertyName("action")]
    public string? Action { get; init; }
}
