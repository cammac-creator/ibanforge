using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using IBANforge.Sdk.Models;

namespace IBANforge.Sdk;

/// <summary>
/// IBANforge: official .NET SDK.
///
/// Mirrors the TypeScript and Python SDKs: API-key auth, a typed exception
/// hierarchy, and coverage of every public endpoint (validate, batch, BIC,
/// CH clearing, compliance, format, structures, test IBANs, payment
/// references, address checks, demo, credit bundles, usage, key generation).
///
/// <code>
/// // Free format check (no key needed)
/// using var anon = new IBANforgeClient();
/// var formatted = await anon.FormatIbanAsync("CH1000230000000012345");
///
/// // Authenticated calls (required for paid endpoints unless you go x402)
/// using var client = new IBANforgeClient(new IBANforgeOptions { ApiKey = "ifk_..." });
/// var result = await client.ValidateIbanAsync("CH1000230000000012345");
///
/// // Generate a free key in one line
/// var key = await IBANforgeClient.GenerateApiKeyAsync("you@company.com");
/// </code>
///
/// ⚠️ The SWIFT IBAN Registry's illustration (<c>CH9300762011623852957</c>) carries
/// a bank code no institution holds, so validating it comes back with a null
/// <c>Bic</c> and null <c>Clearing</c>. Use a register-allocated code instead,
/// or <see cref="TestIbanAsync"/>, which mints one with its proof.
/// </summary>
public sealed class IBANforgeClient : IDisposable
{
    /// <summary>Production API base URL, used when no override is configured.</summary>
    public const string DefaultBaseUrl = "https://api.ibanforge.com";

    /// <summary>SDK version, also sent as part of the <c>User-Agent</c> header.</summary>
    public const string Version = "1.5.0";

    private const string ApiKeyEnvironmentVariable = "IBANFORGE_API_KEY";
    private const string BaseUrlEnvironmentVariable = "IBANFORGE_API_BASE";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly string? _apiKey;
    private readonly string _baseUrl;
    private readonly TimeSpan _timeout;
    private bool _disposed;

    /// <summary>Creates a client with default options: no API key, production base URL, 30s timeout, each overridable by environment variable.</summary>
    public IBANforgeClient() : this(new IBANforgeOptions())
    {
    }

    /// <summary>Creates a client that owns (and disposes) its own internal <see cref="HttpClient"/>.</summary>
    public IBANforgeClient(IBANforgeOptions options)
        // Named arguments so the null-check runs before HttpClient() is
        // allocated (evaluation order follows the call site, not the target
        // parameter list): a null options never leaves an orphaned HttpClient behind.
        : this(options: options ?? throw new ArgumentNullException(nameof(options)), httpClient: new HttpClient(), ownsHttpClient: true)
    {
    }

    /// <summary>
    /// Creates a client backed by a caller-supplied <see cref="HttpClient"/>,
    /// compatible with <c>IHttpClientFactory</c>. This <see cref="HttpClient"/> is
    /// never disposed by <see cref="Dispose"/>: its lifecycle stays with whoever
    /// created it.
    /// </summary>
    public IBANforgeClient(HttpClient httpClient, IBANforgeOptions? options = null)
        : this(httpClient ?? throw new ArgumentNullException(nameof(httpClient)), options ?? new IBANforgeOptions(), ownsHttpClient: false)
    {
    }

    private IBANforgeClient(HttpClient httpClient, IBANforgeOptions options, bool ownsHttpClient)
    {
        _httpClient = httpClient;
        _ownsHttpClient = ownsHttpClient;

        // Explicit option wins, then the environment, then production; resolved
        // per instance rather than cached statically, so a test (or a process
        // that sets the variable late) is never fighting a stale snapshot.
        _apiKey = options.ApiKey ?? Environment.GetEnvironmentVariable(ApiKeyEnvironmentVariable);
        var baseUrl = options.BaseUrl ?? Environment.GetEnvironmentVariable(BaseUrlEnvironmentVariable) ?? DefaultBaseUrl;
        _baseUrl = baseUrl.TrimEnd('/');
        _timeout = options.Timeout;
    }

    /// <summary>Disposes the internally-owned <see cref="HttpClient"/>. A no-op when the client was constructed with a caller-supplied <see cref="HttpClient"/>.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_ownsHttpClient) _httpClient.Dispose();
    }

    // ---- IBAN ----

    /// <summary>FREE pre-flight check (mod-97 + structure). No API key required.</summary>
    public Task<IbanFormatResult> FormatIbanAsync(string iban, CancellationToken cancellationToken = default)
    {
        if (iban is null) throw new ArgumentNullException(nameof(iban));
        return GetAsync<IbanFormatResult>($"/v1/iban/format?iban={Uri.EscapeDataString(iban)}", cancellationToken);
    }

    /// <summary>Validates one IBAN with full enrichment ($0.005 / call with an API key).</summary>
    public Task<IbanValidationResult> ValidateIbanAsync(string iban, CancellationToken cancellationToken = default)
    {
        if (iban is null) throw new ArgumentNullException(nameof(iban));
        return PostAsync<IbanValidationResult>("/v1/iban/validate", new { iban }, cancellationToken);
    }

    /// <summary>Validates up to 100 IBANs in one call ($0.002 / IBAN with an API key).</summary>
    public Task<IbanBatchResult> ValidateBatchAsync(IEnumerable<string> ibans, CancellationToken cancellationToken = default)
    {
        if (ibans is null) throw new ArgumentNullException(nameof(ibans));
        var list = ibans as IReadOnlyList<string> ?? ibans.ToList();
        if (list.Count == 0) throw new InvalidInputException("ibans must contain at least one IBAN");
        if (list.Count > 100) throw new InvalidInputException($"ibans must be at most 100 entries (got {list.Count})");
        return PostAsync<IbanBatchResult>("/v1/iban/batch", new { ibans = list }, cancellationToken);
    }

    /// <summary>
    /// Pre-flight compliance triage on an IBAN ($0.02 / call with an API key).
    /// Read the score at <c>result.Compliance.RiskScore</c>. Informational, not a
    /// regulated AML/CFT product; sanctions screening is BANK-level (BIC8) only.
    /// </summary>
    public Task<ComplianceResult> CheckComplianceAsync(string iban, CancellationToken cancellationToken = default)
    {
        if (iban is null) throw new ArgumentNullException(nameof(iban));
        return PostAsync<ComplianceResult>("/v1/iban/compliance", new { iban }, cancellationToken);
    }

    // ---- BIC / SWIFT ----

    /// <summary>Resolves a BIC/SWIFT code into bank, country, city, LEI ($0.003 / call).</summary>
    public Task<BicLookupResult> LookupBicAsync(string code, CancellationToken cancellationToken = default)
    {
        if (code is null) throw new ArgumentNullException(nameof(code));
        return GetAsync<BicLookupResult>($"/v1/bic/{Uri.EscapeDataString(code)}", cancellationToken);
    }

    // ---- Swiss clearing ----

    /// <summary>Resolves a Swiss BC-Nummer / IID into institution data ($0.003 / call).</summary>
    public Task<ChClearingResult> LookupChClearingAsync(string iid, CancellationToken cancellationToken = default)
    {
        if (iid is null) throw new ArgumentNullException(nameof(iid));
        return GetAsync<ChClearingResult>($"/v1/ch/clearing/{Uri.EscapeDataString(iid)}", cancellationToken);
    }

    /// <summary>Resolves a Swiss BC-Nummer / IID into institution data ($0.003 / call).</summary>
    public Task<ChClearingResult> LookupChClearingAsync(long iid, CancellationToken cancellationToken = default)
        => LookupChClearingAsync(iid.ToString(CultureInfo.InvariantCulture), cancellationToken);

    // ---- Reference data (all FREE, no key needed) ----

    /// <summary>Lists every country the API can parse, with its IBAN length. FREE.</summary>
    public Task<IbanStructureList> IbanStructuresAsync(CancellationToken cancellationToken = default)
        => GetAsync<IbanStructureList>("/v1/iban/structure", cancellationToken);

    /// <summary>One country's BBAN template: field offsets, lengths, charsets. FREE.</summary>
    public Task<IbanStructure> IbanStructureAsync(string country, CancellationToken cancellationToken = default)
    {
        if (country is null) throw new ArgumentNullException(nameof(country));
        return GetAsync<IbanStructure>($"/v1/iban/structure/{Uri.EscapeDataString(country)}", cancellationToken);
    }

    /// <summary>
    /// Test IBANs whose bank code is REALLY allocated, with the register row that
    /// proves it. FREE.
    ///
    /// Use this instead of the SWIFT registry's illustration for fixtures and
    /// demos: that one's bank code belongs to nobody, so every enrichment field
    /// comes back null and your test looks like the API failed.
    /// </summary>
    public Task<TestIbanResult> TestIbanAsync(string? country = null, int? count = null, CancellationToken cancellationToken = default)
    {
        var query = new List<string>();
        if (!string.IsNullOrEmpty(country)) query.Add($"country={Uri.EscapeDataString(country)}");
        if (count.HasValue) query.Add($"count={count.Value.ToString(CultureInfo.InvariantCulture)}");
        var suffix = query.Count > 0 ? "?" + string.Join("&", query) : string.Empty;
        return GetAsync<TestIbanResult>($"/v1/test-iban{suffix}", cancellationToken);
    }

    /// <summary>
    /// Checks a QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish
    /// payment reference against the dated document that publishes its rule. FREE.
    ///
    /// This checks the reference ALONE. The pairing verdict (whether that
    /// reference may legally travel with a given account under the Swiss Payment
    /// Standards) is the paid half: send a <c>reference</c> field to
    /// <see cref="ValidateIbanAsync"/> and read the result's reference-check
    /// pairing field.
    /// </summary>
    public Task<ReferenceValidationResult> ValidateReferenceAsync(string reference, string? referenceType = null, CancellationToken cancellationToken = default)
    {
        if (reference is null) throw new ArgumentNullException(nameof(reference));
        var query = $"reference={Uri.EscapeDataString(reference)}";
        if (!string.IsNullOrEmpty(referenceType)) query += $"&reference_type={Uri.EscapeDataString(referenceType)}";
        return GetAsync<ReferenceValidationResult>($"/v1/reference/validate?{query}", cancellationToken);
    }

    /// <summary>
    /// Checks a structured ISO 20022 postal address against a scheme's rules
    /// (<c>sps</c>, <c>hvps_plus</c>, <c>fedwire</c>). FREE.
    ///
    /// Every finding names the guideline it was read from: relay its source with
    /// the verdict rather than the boolean alone.
    /// </summary>
    public Task<AddressCheckResult> CheckAddressAsync(string scheme, PostalAddress address, CancellationToken cancellationToken = default)
    {
        if (scheme is null) throw new ArgumentNullException(nameof(scheme));
        if (address is null) throw new ArgumentNullException(nameof(address));
        return PostAsync<AddressCheckResult>("/v1/address/check", new { scheme, address }, cancellationToken);
    }

    /// <summary>Prepaid credit packs and their per-call price. FREE to list.</summary>
    public Task<CreditBundleList> CreditBundlesAsync(CancellationToken cancellationToken = default)
        => GetAsync<CreditBundleList>("/v1/credits/bundles", cancellationToken);

    /// <summary>Worked examples of every endpoint, no key and no payment. FREE.</summary>
    public Task<DemoResult> DemoAsync(CancellationToken cancellationToken = default)
        => GetAsync<DemoResult>("/v1/demo", cancellationToken);

    // ---- API keys ----

    /// <summary>
    /// Creates a free API key (200 requests/month). The key is shown ONCE.
    ///
    /// Use a real mailbox: fictional and disposable domains (<c>example.com</c>,
    /// <c>mailinator</c>, …) are refused with <c>disposable_email</c>. A second
    /// key from the same network within seven days answers 403
    /// <c>verification_required</c> and mails a six-digit code; repeat the call
    /// with <paramref name="code"/> to claim it.
    /// </summary>
    /// <param name="email">Mailbox to issue the key to.</param>
    /// <param name="code">Six-digit verification code from a previous 403 <c>verification_required</c> response.</param>
    /// <param name="baseUrl">Override the API base URL for this call only.</param>
    /// <param name="timeout">Override the request timeout for this call only. Defaults to 30 seconds.</param>
    /// <param name="httpClient">
    /// Optional caller-supplied <see cref="HttpClient"/> (e.g. from <c>IHttpClientFactory</c>,
    /// or a fake handler in tests). When omitted, a temporary internal one is
    /// created and disposed for this single call.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    public static async Task<ApiKey> GenerateApiKeyAsync(
        string email,
        string? code = null,
        string? baseUrl = null,
        TimeSpan? timeout = null,
        HttpClient? httpClient = null,
        CancellationToken cancellationToken = default)
    {
        if (email is null) throw new ArgumentNullException(nameof(email));
        var options = new IBANforgeOptions { BaseUrl = baseUrl, Timeout = timeout ?? TimeSpan.FromSeconds(30) };
        using var client = httpClient is not null
            ? new IBANforgeClient(httpClient, options)
            : new IBANforgeClient(options);
        return await client.PostAsync<ApiKey>("/v1/keys/generate", new { email, code }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Current month's quota usage for the configured API key.</summary>
    public Task<ApiKeyUsage> UsageAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiKey))
        {
            throw new AuthException(
                "UsageAsync() requires an API key: set IBANforgeOptions.ApiKey (or the IBANFORGE_API_KEY environment variable) when constructing IBANforgeClient.");
        }

        return GetAsync<ApiKeyUsage>("/v1/keys/usage", cancellationToken);
    }

    // ---- Misc ----

    /// <summary>Public health endpoint: version, BIC count, uptime.</summary>
    public Task<HealthInfo> HealthAsync(CancellationToken cancellationToken = default)
        => GetAsync<HealthInfo>("/health", cancellationToken);

    // ---- Request plumbing ----

    private Task<T> GetAsync<T>(string path, CancellationToken cancellationToken)
        => SendAsync<T>(HttpMethod.Get, path, body: null, cancellationToken);

    private Task<T> PostAsync<T>(string path, object body, CancellationToken cancellationToken)
        => SendAsync<T>(HttpMethod.Post, path, body, cancellationToken);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(_timeout);

        HttpResponseMessage response;
        try
        {
            using var request = new HttpRequestMessage(method, _baseUrl + path);
            request.Headers.UserAgent.ParseAdd($"ibanforge-dotnet/{Version}");
            if (!string.IsNullOrEmpty(_apiKey))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
            }

            if (body is not null)
            {
                var json = JsonSerializer.Serialize(body, JsonOptions);
                request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            }

            response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // The caller's own token was not what fired, so this was our timeout.
            throw new IBANforgeException($"Request timed out after {(int)_timeout.TotalMilliseconds}ms");
        }
        catch (HttpRequestException ex)
        {
            throw new IBANforgeException($"Network error: {ex.Message}", null, null, ex);
        }

        using (response)
        {
            string text;
            try
            {
                text = await response.Content.ReadAsStringAsync(timeoutCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new IBANforgeException($"Request timed out after {(int)_timeout.TotalMilliseconds}ms");
            }

            if (!response.IsSuccessStatusCode)
            {
                throw BuildException(response, text);
            }

            var result = JsonSerializer.Deserialize<T>(text, JsonOptions);
            return result is null
                ? throw new IBANforgeException("The server returned an empty or null response body for a call expecting a JSON result.", (int)response.StatusCode, text)
                : result;
        }
    }

    /// <summary>
    /// Maps a non-2xx HTTP response to the matching typed exception, mirroring
    /// the TypeScript SDK's <c>raiseForStatus</c> and the Python SDK's
    /// <c>_raise_for_status</c> exactly: same status, same exception type, same
    /// message-resolution order.
    /// </summary>
    private static IBANforgeException BuildException(HttpResponseMessage response, string text)
    {
        JsonElement? parsed = null;
        try
        {
            using var document = JsonDocument.Parse(text);
            parsed = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            parsed = null;
        }

        object? body = parsed.HasValue ? parsed.Value : text;

        string? message = null;
        string? errorSlug = null;
        if (parsed.HasValue && parsed.Value.ValueKind == JsonValueKind.Object)
        {
            var o = parsed.Value;
            message = GetStringProperty(o, "message") ?? GetStringProperty(o, "error_detail") ?? GetStringProperty(o, "error");
            errorSlug = GetStringProperty(o, "error");
        }

        var status = (int)response.StatusCode;
        message ??= !string.IsNullOrEmpty(response.ReasonPhrase) ? response.ReasonPhrase! : $"HTTP {status}";

        return status switch
        {
            401 or 403 => new AuthException(message, status, body),
            402 => new PaymentRequiredException(message, status, body),
            413 => new PayloadTooLargeException(message, status, body),
            429 => errorSlug == "quota_exceeded"
                ? new QuotaExhaustedException(message, status, body)
                : new RateLimitException(message, status, body),
            >= 400 and < 500 => new InvalidInputException(message, status, body),
            >= 500 => new ApiException(message, status, body),
            _ => new IBANforgeException(message, status, body),
        };
    }

    private static string? GetStringProperty(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
