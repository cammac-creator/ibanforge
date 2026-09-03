using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>The <c>institution</c> block of a <see cref="ChClearingResult"/>.</summary>
public sealed record ChClearingInstitution
{
    /// <summary>Institution name.</summary>
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    /// <summary>Institution type.</summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = string.Empty;

    /// <summary>Whether this IID is a headquarters or a branch.</summary>
    [JsonPropertyName("iid_type")]
    public string IidType { get; init; } = string.Empty;

    /// <summary>The headquarters IID for this institution.</summary>
    [JsonPropertyName("headquarters_iid")]
    public string HeadquartersIid { get; init; } = string.Empty;
}

/// <summary>The <c>payment_services</c> block of a <see cref="ChClearingResult"/>: which Swiss payment rails this institution participates in.</summary>
public sealed record ChClearingPaymentServices
{
    /// <summary>Swiss Interbank Clearing.</summary>
    [JsonPropertyName("sic")]
    public bool Sic { get; init; }

    /// <summary>Real-time gross settlement in CHF.</summary>
    [JsonPropertyName("rtgs_chf")]
    public bool RtgsChf { get; init; }

    /// <summary>CHF instant payments.</summary>
    [JsonPropertyName("instant_payments_chf")]
    public bool InstantPaymentsChf { get; init; }

    /// <summary>euroSIC participation.</summary>
    [JsonPropertyName("eurosic")]
    public bool Eurosic { get; init; }

    /// <summary>LSV/BDD direct debit in CHF.</summary>
    [JsonPropertyName("lsv_bdd_chf")]
    public bool LsvBddChf { get; init; }

    /// <summary>LSV/BDD direct debit in EUR.</summary>
    [JsonPropertyName("lsv_bdd_eur")]
    public bool LsvBddEur { get; init; }
}

/// <summary>
/// Result of <see cref="IBANforgeClient.LookupChClearingAsync(string, System.Threading.CancellationToken)"/>:
/// a Swiss BC-Nummer / IID resolved against SIX BankMaster.
/// </summary>
public sealed record ChClearingResult
{
    /// <summary>The IID / BC-Nummer resolved (may differ from the one queried; see <see cref="RedirectedFrom"/>).</summary>
    [JsonPropertyName("iid")]
    public string Iid { get; init; } = string.Empty;

    /// <summary>Whether the IID was found in the register.</summary>
    [JsonPropertyName("found")]
    public bool Found { get; init; }

    /// <summary>Set when the queried IID redirected to a different (e.g. headquarters) IID.</summary>
    [JsonPropertyName("redirected_from")]
    public string? RedirectedFrom { get; init; }

    /// <summary>Institution identity.</summary>
    [JsonPropertyName("institution")]
    public ChClearingInstitution? Institution { get; init; }

    /// <summary>Postal address fields, keyed by field name (shape varies by source row).</summary>
    [JsonPropertyName("address")]
    public Dictionary<string, string?>? Address { get; init; }

    /// <summary>The institution's BIC, or null.</summary>
    [JsonPropertyName("bic")]
    public string? Bic { get; init; }

    /// <summary>Which Swiss payment rails this institution participates in.</summary>
    [JsonPropertyName("payment_services")]
    public ChClearingPaymentServices? PaymentServices { get; init; }

    /// <summary>SIC-specific IID, when it differs from <see cref="Iid"/>.</summary>
    [JsonPropertyName("sic_iid")]
    public string? SicIid { get; init; }

    /// <summary>First QR-IID allocated to the institution, or null when none.</summary>
    [JsonPropertyName("qr_iid")]
    public string? QrIid { get; init; }

    /// <summary>Source of the QR-IID allocation.</summary>
    [JsonPropertyName("qr_iid_source")]
    public string? QrIidSource { get; init; }

    /// <summary>An institution can hold several QR-IIDs; <see cref="QrIid"/> is the first.</summary>
    [JsonPropertyName("qr_iids")]
    public List<string>? QrIids { get; init; }

    /// <summary>Date this SIX BankMaster row is valid as of.</summary>
    [JsonPropertyName("valid_on")]
    public string? ValidOn { get; init; }

    /// <summary>Free-text note, when the API has one to add.</summary>
    [JsonPropertyName("note")]
    public string? Note { get; init; }

    /// <summary>Machine-readable error slug, when the lookup failed.</summary>
    [JsonPropertyName("error")]
    public string? Error { get; init; }

    /// <summary>Human-readable message, when the lookup failed.</summary>
    [JsonPropertyName("message")]
    public string? Message { get; init; }

    /// <summary>Cost of this call in USDC.</summary>
    [JsonPropertyName("cost_usdc")]
    public double? CostUsdc { get; init; }

    /// <summary>Server-side processing time in milliseconds.</summary>
    [JsonPropertyName("processing_ms")]
    public double? ProcessingMs { get; init; }
}
