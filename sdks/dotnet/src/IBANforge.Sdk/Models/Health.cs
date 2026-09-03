using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>Result of <see cref="IBANforgeClient.HealthAsync"/>: the public health endpoint.</summary>
public sealed record HealthInfo
{
    /// <summary>Server status, e.g. <c>"ok"</c>.</summary>
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    /// <summary>Deployed API version.</summary>
    [JsonPropertyName("version")]
    public string Version { get; init; } = string.Empty;

    /// <summary>Server uptime in seconds.</summary>
    [JsonPropertyName("uptime_seconds")]
    public double? UptimeSeconds { get; init; }

    /// <summary>Number of BIC entries in the database. Drifts at each monthly refresh; never hardcode it.</summary>
    [JsonPropertyName("bic_database_entries")]
    public int BicDatabaseEntries { get; init; }

    /// <summary>Number of Swiss clearing entries in the database.</summary>
    [JsonPropertyName("ch_clearing_entries")]
    public int? ChClearingEntries { get; init; }

    /// <summary>When the BIC data was last refreshed.</summary>
    [JsonPropertyName("bic_data_last_updated")]
    public string? BicDataLastUpdated { get; init; }

    /// <summary>Per-database health status, keyed by database name.</summary>
    [JsonPropertyName("databases")]
    public Dictionary<string, string>? Databases { get; init; }
}
