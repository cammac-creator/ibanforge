using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>Set when the same digits also satisfy another country's payment-reference length rule.</summary>
public sealed record AlsoValidAs
{
    /// <summary>The other scheme these digits also satisfy.</summary>
    [JsonPropertyName("scheme")]
    public string Scheme { get; init; } = string.Empty;

    /// <summary>Whether it validates under that scheme too.</summary>
    [JsonPropertyName("valid")]
    public bool Valid { get; init; }

    /// <summary>Free-text clarification.</summary>
    [JsonPropertyName("note")]
    public string? Note { get; init; }
}

/// <summary>
/// Result of <see cref="IBANforgeClient.ValidateReferenceAsync"/>: a structured
/// payment reference (QRR, RF/ISO 11649, Belgian OGM/VCS, Finnish viitenumero, …)
/// checked against its published check-digit rule. FREE.
///
/// This checks the reference ALONE. The pairing verdict (whether it may
/// legally travel with a given account) is read from <see cref="PairingVerdict"/>
/// only when a <c>reference</c> field was sent to
/// <see cref="IBANforgeClient.ValidateIbanAsync"/> instead.
/// </summary>
public sealed record ReferenceValidationResult
{
    /// <summary>Uppercased, separators removed: what was actually judged.</summary>
    [JsonPropertyName("reference")]
    public string Reference { get; init; } = string.Empty;

    /// <summary>The recognised scheme, or null when nothing recognised the string.</summary>
    [JsonPropertyName("scheme")]
    public string? Scheme { get; init; }

    /// <summary>
    /// Null is a real answer, not a missing one: Norwegian KID and Swedish OCR are
    /// configured per creditor account by the beneficiary's bank, so <c>false</c>
    /// here would reject perfectly good references.
    /// </summary>
    [JsonPropertyName("valid")]
    public bool? Valid { get; init; }

    /// <summary>Machine-readable status token.</summary>
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    /// <summary>The expected check digit, as a string: an OGM remainder can legitimately start with a zero.</summary>
    [JsonPropertyName("check_digit_expected")]
    public string? CheckDigitExpected { get; init; }

    /// <summary>The dated document the rule was read from, or null. Keep it when relaying this result.</summary>
    [JsonPropertyName("source")]
    public string? Source { get; init; }

    /// <summary>When the source document was last checked.</summary>
    [JsonPropertyName("as_of")]
    public string? AsOf { get; init; }

    /// <summary>Free-text explanation of the verdict.</summary>
    [JsonPropertyName("note")]
    public string Note { get; init; } = string.Empty;

    /// <summary>Set when the same digits also satisfy another country's length rule.</summary>
    [JsonPropertyName("also_valid_as")]
    public AlsoValidAs? AlsoValidAs { get; init; }

    /// <summary>What the paid pairing check (via <see cref="IBANforgeClient.ValidateIbanAsync"/>) adds, and what it costs.</summary>
    [JsonPropertyName("pairing_verdict")]
    public string? PairingVerdict { get; init; }
}
