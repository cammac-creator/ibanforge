using System.Net;
using IBANforge.Sdk;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>Covers <c>UsageAsync</c>, <c>GenerateApiKeyAsync</c> and <c>HealthAsync</c>.</summary>
public sealed class KeysHealthTests
{
    // sdks/fixtures/quickstart-api.json -> "keys-usage"
    private const string KeysUsageBody = """
        {"used":10,"limit":200,"remaining":190,"month":"2026-08","key_prefix":"ifk_REDACTED"}
        """;

    // sdks/fixtures/quickstart-api.json -> "keys-usage-wrong-key" (status 401)
    private const string KeysUsageWrongKeyBody = """
        {"error":"invalid_key","message":"API key not found or inactive"}
        """;

    // sdks/fixtures/quickstart-api.json -> "health"
    private const string HealthBody = """
        {"status":"ok","version":"1.4.3","uptime_seconds":1,"bic_database_entries":121716,"ch_clearing_entries":1165,"bic_data_last_updated":"2026-08-01 04:16:12","databases":{"bic":"ok","stats":"ok","compliance":"ok"}}
        """;

    // sdks/fixtures/quickstart-api.json -> "keys-generate"
    private const string KeysGenerateBody = """
        {"api_key":"ifk_REDACTED","key_prefix":"ifk_REDACTED","email":"you@company.com","monthly_limit":200,"message":"Save this key — it will not be shown again.","terms_url":"https://ibanforge.com/legal/terms"}
        """;

    [Fact]
    public async Task UsageAsync_WithApiKey_SendsAuthHeader_AndDeserializes()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, KeysUsageBody);
        using var client = TestClients.Create(handler, apiKey: "ifk_live_key");

        var result = await client.UsageAsync();

        Assert.Equal("/v1/keys/usage", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal("Bearer ifk_live_key", handler.SingleRequest.Headers.Authorization!.ToString());
        Assert.Equal(10, result.Used);
        Assert.Equal(200, result.Limit);
        Assert.Equal(190, result.Remaining);
        Assert.Equal("2026-08", result.Month);
    }

    [Fact]
    public async Task UsageAsync_WithoutApiKey_ThrowsAuthException_WithoutNetworkCall()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, KeysUsageBody);
        using var client = TestClients.Create(handler, apiKey: null);

        var ex = await Assert.ThrowsAsync<AuthException>(() => client.UsageAsync());

        Assert.Null(ex.Status);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UsageAsync_ServerRejectsKey_MapsRealFixtureTo401AuthException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Unauthorized, KeysUsageWrongKeyBody);
        using var client = TestClients.Create(handler, apiKey: "ifk_wrong");

        var ex = await Assert.ThrowsAsync<AuthException>(() => client.UsageAsync());

        Assert.Equal(401, ex.Status);
        Assert.Equal("API key not found or inactive", ex.Message);
        Assert.Equal("invalid_key", ex.Code);
    }

    [Fact]
    public async Task HealthAsync_Get_AndDeserializes()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, HealthBody);
        using var client = TestClients.Create(handler, apiKey: null);

        var result = await client.HealthAsync();

        Assert.Equal("/health", handler.SingleRequest.RequestUri!.AbsolutePath);
        Assert.Equal("ok", result.Status);
        Assert.Equal(121716, result.BicDatabaseEntries);
        Assert.Equal(1165, result.ChClearingEntries);
        Assert.Equal("ok", result.Databases!["stats"]);
    }

    [Fact]
    public async Task GenerateApiKeyAsync_WithoutCode_OmitsCodeFromBody_AndSendsNoAuthHeader()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Created, KeysGenerateBody);
        var httpClient = new HttpClient(handler);

        var result = await IBANforgeClient.GenerateApiKeyAsync("you@company.com", httpClient: httpClient);

        var request = handler.SingleRequest;
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/v1/keys/generate", request.RequestUri!.AbsolutePath);
        Assert.Null(request.Headers.Authorization);
        Assert.Equal("""{"email":"you@company.com"}""", handler.RequestBodies.Single());

        Assert.Equal("ifk_REDACTED", result.ApiKeyValue);
        Assert.Equal(200, result.MonthlyLimit);
        Assert.Equal("https://ibanforge.com/legal/terms", result.TermsUrl);
    }

    [Fact]
    public async Task GenerateApiKeyAsync_WithCode_IncludesCodeInBody()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Created, KeysGenerateBody);
        var httpClient = new HttpClient(handler);

        await IBANforgeClient.GenerateApiKeyAsync("you@company.com", code: "123456", httpClient: httpClient);

        Assert.Equal("""{"email":"you@company.com","code":"123456"}""", handler.RequestBodies.Single());
    }

    [Fact]
    public async Task GenerateApiKeyAsync_DoesNotDisposeCallerSuppliedHttpClient()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Created, KeysGenerateBody);
        var httpClient = new HttpClient(handler);

        await IBANforgeClient.GenerateApiKeyAsync("you@company.com", httpClient: httpClient);

        // A disposed HttpClient throws ObjectDisposedException on the next send;
        // a second successful call through the SAME instance proves
        // GenerateApiKeyAsync did not dispose the caller-supplied client.
        await IBANforgeClient.GenerateApiKeyAsync("second@company.com", httpClient: httpClient);

        Assert.Equal(2, handler.Requests.Count);
    }
}
