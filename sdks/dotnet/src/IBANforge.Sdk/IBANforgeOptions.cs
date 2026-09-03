namespace IBANforge.Sdk;

/// <summary>
/// Configuration for <see cref="IBANforgeClient"/>.
///
/// Every option falls back to an environment variable, then to a production
/// default, resolved once per client instance (never cached at process start),
/// so a test, or a process that sets the variable late, is never fighting a
/// stale snapshot:
/// <list type="bullet">
/// <item><description><see cref="ApiKey"/> falls back to <c>IBANFORGE_API_KEY</c>, the same variable the MCP server reads.</description></item>
/// <item><description><see cref="BaseUrl"/> falls back to <c>IBANFORGE_API_BASE</c>, then <c>https://api.ibanforge.com</c>.</description></item>
/// </list>
/// </summary>
public sealed class IBANforgeOptions
{
    /// <summary>
    /// <c>ifk_*</c> API key. Required for paid endpoints (unless paying per-call
    /// via x402). Free endpoints such as <see cref="IBANforgeClient.FormatIbanAsync"/>
    /// work without one.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>
    /// Override the API base URL (default <c>https://api.ibanforge.com</c>). A
    /// trailing slash is stripped. Used to point the client at a local server in
    /// tests or a staging deployment in CI.
    /// </summary>
    public string? BaseUrl { get; set; }

    /// <summary>Per-request timeout. Defaults to 30 seconds.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);
}
