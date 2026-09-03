using System.Text.Json.Serialization;

namespace IBANforge.Sdk.Models;

/// <summary>One prepaid credit pack offered by <see cref="IBANforgeClient.CreditBundlesAsync"/>.</summary>
public sealed record CreditBundle
{
    /// <summary>Short identifier for this bundle, e.g. <c>"1k"</c>.</summary>
    [JsonPropertyName("slug")]
    public string Slug { get; init; } = string.Empty;

    /// <summary>Number of API credits in the bundle.</summary>
    [JsonPropertyName("credits")]
    public int Credits { get; init; }

    /// <summary>Total price of the bundle in USDC.</summary>
    [JsonPropertyName("price_usdc")]
    public double PriceUsdc { get; init; }

    /// <summary>Effective price per call once the bundle is applied.</summary>
    [JsonPropertyName("price_per_call_usdc")]
    public double PricePerCallUsdc { get; init; }

    /// <summary>Route to purchase this bundle.</summary>
    [JsonPropertyName("buy_endpoint")]
    public string BuyEndpoint { get; init; } = string.Empty;
}

/// <summary>
/// Result of <see cref="IBANforgeClient.CreditBundlesAsync"/>: prepaid packs,
/// free to list.
/// </summary>
public sealed record CreditBundleList
{
    /// <summary>The available bundles.</summary>
    [JsonPropertyName("bundles")]
    public List<CreditBundle> Bundles { get; init; } = new();

    /// <summary>How bundles are paid for, e.g. <c>"x402 USDC on Base mainnet"</c>.</summary>
    [JsonPropertyName("payment_method")]
    public string PaymentMethod { get; init; } = string.Empty;

    /// <summary>Link to further documentation.</summary>
    [JsonPropertyName("documentation")]
    public string? Documentation { get; init; }
}
