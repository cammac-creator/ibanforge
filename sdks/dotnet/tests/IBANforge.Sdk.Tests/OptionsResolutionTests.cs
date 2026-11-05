using System.Net;
using IBANforge.Sdk;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>
/// Sauvegarde et restaure une variable pendant un test, même si celui-ci échoue.
/// Cela ne verrouille pas l’environnement du processus : les autres classes
/// doivent construire leurs clients avec des options explicites.
/// </summary>
internal sealed class EnvVarScope : IDisposable
{
    private readonly string _name;
    private readonly string? _original;

    public EnvVarScope(string name, string? value)
    {
        _name = name;
        _original = Environment.GetEnvironmentVariable(name);
        Environment.SetEnvironmentVariable(name, value);
    }

    public void Dispose() => Environment.SetEnvironmentVariable(_name, _original);
}

/// <summary>
/// Vérifie la priorité des options, de l’environnement et des valeurs par défaut,
/// la normalisation de l’origine et la propriété du HttpClient. Les variables
/// modifiées sont restaurées par <see cref="EnvVarScope"/>.
/// </summary>
public sealed class OptionsResolutionTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ifk_explicite_fictive")]
    public async Task ClientDeTest_NeLitPasLEnvironnement(string? apiKey)
    {
        using var apiKeyScope = new EnvVarScope("IBANFORGE_API_KEY", "ifk_ambiante_fictive");
        using var baseUrlScope = new EnvVarScope("IBANFORGE_API_BASE", "https://ambiante.example.test");
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"iban":"x","valid":false}""");
        using var client = TestClients.Create(handler, apiKey: apiKey);

        await client.FormatIbanAsync("CH1000230000000012345");

        Assert.Equal("fake.ibanforge.test", handler.SingleRequest.RequestUri!.Host);
        if (string.IsNullOrEmpty(apiKey)) Assert.Null(handler.SingleRequest.Headers.Authorization);
        else Assert.Equal("Bearer " + apiKey, handler.SingleRequest.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task NoOverrides_UsesProductionHost_WithoutTouchingTheRealNetwork()
    {
        using var apiKeyScope = new EnvVarScope("IBANFORGE_API_KEY", null);
        using var baseUrlScope = new EnvVarScope("IBANFORGE_API_BASE", null);
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"iban":"x","valid":false}""");
        using var client = new IBANforgeClient(new HttpClient(handler));

        await client.FormatIbanAsync("CH1000230000000012345");

        // The handler is terminal: even though the URI names the real host, no
        // socket is ever opened: HttpClient hands the request straight to our
        // fake handler instead of the network stack.
        Assert.Equal("api.ibanforge.com", handler.SingleRequest.RequestUri!.Host);
        Assert.Equal("https", handler.SingleRequest.RequestUri!.Scheme);
        Assert.Null(handler.SingleRequest.Headers.Authorization);
    }

    [Fact]
    public async Task ApiKey_FallsBackToEnvironmentVariable_WhenOptionOmitted()
    {
        using var apiKeyScope = new EnvVarScope("IBANFORGE_API_KEY", "ifk_from_env");
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"iban":"x","valid":false}""");
        using var client = new IBANforgeClient(new HttpClient(handler), new IBANforgeOptions { BaseUrl = "https://fake.ibanforge.test" });

        await client.FormatIbanAsync("CH1000230000000012345");

        Assert.Equal("Bearer ifk_from_env", handler.SingleRequest.Headers.Authorization!.ToString());
    }

    [Fact]
    public async Task BaseUrl_FallsBackToEnvironmentVariable_WhenOptionOmitted()
    {
        using var baseUrlScope = new EnvVarScope("IBANFORGE_API_BASE", "https://staging.ibanforge.test");
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"iban":"x","valid":false}""");
        using var client = new IBANforgeClient(new HttpClient(handler));

        await client.FormatIbanAsync("CH1000230000000012345");

        Assert.Equal("staging.ibanforge.test", handler.SingleRequest.RequestUri!.Host);
    }

    [Fact]
    public async Task ExplicitOptions_OverrideEnvironmentVariables()
    {
        using var apiKeyScope = new EnvVarScope("IBANFORGE_API_KEY", "ifk_from_env");
        using var baseUrlScope = new EnvVarScope("IBANFORGE_API_BASE", "https://staging.ibanforge.test");
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"iban":"x","valid":false}""");
        using var client = new IBANforgeClient(new HttpClient(handler), new IBANforgeOptions
        {
            ApiKey = "ifk_explicit",
            BaseUrl = "https://explicit.ibanforge.test",
        });

        await client.FormatIbanAsync("CH1000230000000012345");

        Assert.Equal("Bearer ifk_explicit", handler.SingleRequest.Headers.Authorization!.ToString());
        Assert.Equal("explicit.ibanforge.test", handler.SingleRequest.RequestUri!.Host);
    }

    [Fact]
    public async Task BaseUrl_TrailingSlashIsTrimmed_NoDoubleSlashInPath()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, """{"iban":"x","valid":false}""");
        using var client = new IBANforgeClient(new HttpClient(handler), new IBANforgeOptions { BaseUrl = "https://fake.ibanforge.test/" });

        await client.FormatIbanAsync("CH1000230000000012345");

        Assert.Equal("/v1/iban/format", handler.SingleRequest.RequestUri!.AbsolutePath);
    }

    [Fact]
    public void Constructor_NullOptions_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => new IBANforgeClient((IBANforgeOptions)null!));
    }

    [Fact]
    public void Constructor_NullHttpClient_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => new IBANforgeClient((HttpClient)null!));
    }

    [Fact]
    public async Task Dispose_OnOwnedHttpClient_PreventsFurtherCalls()
    {
        var client = new IBANforgeClient(new IBANforgeOptions { ApiKey = "ifk_x", BaseUrl = "https://fake.ibanforge.test" });
        client.Dispose();

        await Assert.ThrowsAsync<ObjectDisposedException>(() => client.FormatIbanAsync("CH1000230000000012345"));
    }

    [Fact]
    public void Dispose_OnCallerSuppliedHttpClient_LeavesItUsable()
    {
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, "{}");
        var httpClient = new HttpClient(handler);
        var client = new IBANforgeClient(httpClient, new IBANforgeOptions { BaseUrl = "https://fake.ibanforge.test" });

        client.Dispose();

        // Would throw ObjectDisposedException if IBANforgeClient had (incorrectly) disposed it.
        httpClient.Timeout = TimeSpan.FromSeconds(7);
    }
}
