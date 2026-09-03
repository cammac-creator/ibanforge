using System.Net;
using System.Text.Json;
using IBANforge.Sdk;
using IBANforge.Sdk.Models;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>
/// Full status-code to exception-type mapping, mirroring the TypeScript SDK's
/// <c>raiseForStatus</c> and the Python SDK's <c>_raise_for_status</c> exactly.
/// Uses <c>LookupBicAsync</c> as the vehicle for every case (any endpoint works;
/// the mapping lives in shared plumbing) so the real "bic-invalid-format" fixture
/// can carry the one case a fixture actually exists for.
/// </summary>
public sealed class ErrorMappingTests
{
    // sdks/fixtures/quickstart-api.json -> "bic-invalid-format" (status 400)
    private const string BicInvalidFormatBody = """
        {"error":"invalid_bic_format","message":"BIC code must be 8 or 11 alphanumeric characters"}
        """;

    private static Task<BicLookupResult> Call(FakeHttpMessageHandler handler)
    {
        using var client = TestClients.Create(handler);
        return client.LookupBicAsync("NOTABIC");
    }

    [Fact]
    public async Task Status401_MapsToAuthException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Unauthorized, """{"error":"invalid_key","message":"API key not found or inactive"}""");

        var ex = await Assert.ThrowsAsync<AuthException>(() => Call(handler));

        Assert.Equal(401, ex.Status);
        Assert.Equal("invalid_key", ex.Code);
        Assert.Equal("API key not found or inactive", ex.Message);
    }

    [Fact]
    public async Task Status403_MapsToAuthException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.Forbidden, """{"error":"verification_required","message":"Confirm the six-digit code sent to your mailbox."}""");

        var ex = await Assert.ThrowsAsync<AuthException>(() => Call(handler));

        Assert.Equal(403, ex.Status);
        Assert.Equal("verification_required", ex.Code);
    }

    [Fact]
    public async Task Status402_MapsToPaymentRequiredException_WithAcceptsFromBody()
    {
        const string body = """
            {"error":"payment_required","message":"Payment required for this endpoint.","accepts":{"scheme":"exact","network":"eip155:8453","price":"$0.003","payTo":"0x0000000000000000000000000000000000dEaD","maxTimeoutSeconds":60}}
            """;
        var handler = new FakeHttpMessageHandler(HttpStatusCode.PaymentRequired, body);

        var ex = await Assert.ThrowsAsync<PaymentRequiredException>(() => Call(handler));

        Assert.Equal(402, ex.Status);
        Assert.Equal("payment_required", ex.Code);
        Assert.NotNull(ex.Accepts);
        Assert.Equal("exact", ex.Accepts!.Value.GetProperty("scheme").GetString());
        Assert.Equal("$0.003", ex.Accepts.Value.GetProperty("price").GetString());
    }

    [Fact]
    public async Task Status413_MapsToPayloadTooLargeException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.RequestEntityTooLarge, """{"error":"payload_too_large","message":"Request body exceeds the 1 MB limit."}""");

        var ex = await Assert.ThrowsAsync<PayloadTooLargeException>(() => Call(handler));

        Assert.Equal(413, ex.Status);
        Assert.Equal("payload_too_large", ex.Code);
    }

    [Fact]
    public async Task Status429_WithQuotaExceededSlug_MapsToQuotaExhaustedException()
    {
        var handler = new FakeHttpMessageHandler((HttpStatusCode)429, """{"error":"quota_exceeded","message":"Monthly quota exhausted."}""");

        var ex = await Assert.ThrowsAsync<QuotaExhaustedException>(() => Call(handler));

        Assert.Equal(429, ex.Status);
        Assert.Equal("quota_exceeded", ex.Code);
    }

    [Fact]
    public async Task Status429_WithoutQuotaSlug_MapsToRateLimitException()
    {
        var handler = new FakeHttpMessageHandler((HttpStatusCode)429, """{"error":"rate_limited","message":"Too many requests."}""");

        var ex = await Assert.ThrowsAsync<RateLimitException>(() => Call(handler));

        Assert.Equal(429, ex.Status);
        Assert.Equal("rate_limited", ex.Code);
    }

    [Fact]
    public async Task Status400_RealFixture_MapsToInvalidInputException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.BadRequest, BicInvalidFormatBody);

        var ex = await Assert.ThrowsAsync<InvalidInputException>(() => Call(handler));

        Assert.Equal(400, ex.Status);
        Assert.Equal("invalid_bic_format", ex.Code);
        Assert.Equal("BIC code must be 8 or 11 alphanumeric characters", ex.Message);
        Assert.IsType<JsonElement>(ex.Body);
    }

    [Fact]
    public async Task Status500_MapsToApiException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.InternalServerError, """{"error":"internal_error","message":"Something went wrong."}""");

        var ex = await Assert.ThrowsAsync<ApiException>(() => Call(handler));

        Assert.Equal(500, ex.Status);
        Assert.Equal("internal_error", ex.Code);
    }

    [Fact]
    public async Task Status503_AlsoMapsToApiException()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.ServiceUnavailable, """{"error":"unavailable","message":"Temporarily down for maintenance."}""");

        var ex = await Assert.ThrowsAsync<ApiException>(() => Call(handler));

        Assert.Equal(503, ex.Status);
    }

    [Fact]
    public async Task MessageResolution_PrefersMessageOverErrorDetailAndError()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.BadRequest, """{"error":"bad_iban","error_detail":"Detail text.","message":"Human sentence."}""");

        var ex = await Assert.ThrowsAsync<InvalidInputException>(() => Call(handler));

        Assert.Equal("Human sentence.", ex.Message);
    }

    [Fact]
    public async Task MessageResolution_FallsBackToErrorDetail_WhenMessageAbsent()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.BadRequest, """{"error":"bad_iban","error_detail":"Detail text."}""");

        var ex = await Assert.ThrowsAsync<InvalidInputException>(() => Call(handler));

        Assert.Equal("Detail text.", ex.Message);
    }

    [Fact]
    public async Task MessageResolution_FallsBackToErrorSlug_WhenMessageAndDetailAbsent()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.BadRequest, """{"error":"bad_iban"}""");

        var ex = await Assert.ThrowsAsync<InvalidInputException>(() => Call(handler));

        Assert.Equal("bad_iban", ex.Message);
    }

    [Fact]
    public async Task NonJsonBody_BecomesRawStringBody_AndMessageFallsBackToStatus()
    {
        var handler = new FakeHttpMessageHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("upstream nginx 502", System.Text.Encoding.UTF8, "text/plain"),
            ReasonPhrase = "Internal Server Error",
        }));

        var ex = await Assert.ThrowsAsync<ApiException>(() => Call(handler));

        Assert.Equal(500, ex.Status);
        Assert.IsType<string>(ex.Body);
        Assert.Equal("upstream nginx 502", ex.Body);
        Assert.Null(ex.Code);
        Assert.Equal("Internal Server Error", ex.Message);
    }
}
