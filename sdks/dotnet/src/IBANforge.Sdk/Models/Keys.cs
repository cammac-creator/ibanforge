using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>
/// Result of <see cref="IBANforgeClient.GenerateApiKeyAsync"/>.
///
/// <see cref="ApiKeyValue"/> is shown once, never again: store it before the
/// process exits.
/// </summary>
public sealed record ApiKey
{
    /// <summary>The <c>ifk_*</c> secret key. Shown once.</summary>
    [JsonPropertyName("api_key")]
    public string ApiKeyValue { get; init; } = string.Empty;

    /// <summary>The key's non-secret display prefix.</summary>
    [JsonPropertyName("key_prefix")]
    public string KeyPrefix { get; init; } = string.Empty;

    /// <summary>The email the key was issued to.</summary>
    [JsonPropertyName("email")]
    public string? Email { get; init; }

    /// <summary>Monthly request quota for this key.</summary>
    [JsonPropertyName("monthly_limit")]
    public int? MonthlyLimit { get; init; }

    /// <summary>Human-readable message accompanying the key.</summary>
    [JsonPropertyName("message")]
    public string? Message { get; init; }

    /// <summary>Link to the terms this key is issued under.</summary>
    [JsonPropertyName("terms_url")]
    public string? TermsUrl { get; init; }
}

/// <summary>
/// Result of <see cref="IBANforgeClient.UsageAsync"/>: the current month's
/// quota usage for the configured API key.
/// </summary>
public sealed record ApiKeyUsage
{
    /// <summary>The key's non-secret display prefix.</summary>
    [JsonPropertyName("key_prefix")]
    public string KeyPrefix { get; init; } = string.Empty;

    /// <summary>Calls consumed this calendar month.</summary>
    [JsonPropertyName("used")]
    public int Used { get; init; }

    /// <summary>Monthly quota for this key (200 on the free tier).</summary>
    [JsonPropertyName("limit")]
    public int Limit { get; init; }

    /// <summary>Calls remaining this month.</summary>
    [JsonPropertyName("remaining")]
    public int Remaining { get; init; }

    /// <summary><c>"YYYY-MM"</c> of the quota window.</summary>
    [JsonPropertyName("month")]
    public string Month { get; init; } = string.Empty;
}
