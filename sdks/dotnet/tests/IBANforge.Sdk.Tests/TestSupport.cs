using System.Net;
using System.Text;
using IBANforge.Sdk;

namespace IBANforge.Sdk.Tests;

/// <summary>
/// A terminal <see cref="HttpMessageHandler"/> that never touches the network:
/// it records every outgoing request and answers from a caller-supplied
/// responder, so tests can assert on method/path/headers/body and control the
/// response deterministically.
/// </summary>
internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _responder;

    /// <summary>Every request this handler has seen, in order.</summary>
    public List<HttpRequestMessage> Requests { get; } = new();

    /// <summary>The request body text for each captured request (null when the request had no body), same order as <see cref="Requests"/>.</summary>
    public List<string?> RequestBodies { get; } = new();

    public FakeHttpMessageHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> responder)
    {
        _responder = responder;
    }

    /// <summary>Answers every request with the same fixed status and JSON body.</summary>
    public FakeHttpMessageHandler(HttpStatusCode statusCode, string jsonBody)
        : this(_ => Task.FromResult(new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(jsonBody, Encoding.UTF8, "application/json"),
        }))
    {
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        RequestBodies.Add(request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken));
        return await _responder(request).ConfigureAwait(false);
    }

    /// <summary>The single request captured, when exactly one was made. Throws otherwise.</summary>
    public HttpRequestMessage SingleRequest => Requests.Single();
}

/// <summary>A handler that delays past whatever timeout the caller configures, to exercise timeout/cancellation behaviour.</summary>
internal sealed class DelayingHttpMessageHandler : HttpMessageHandler
{
    private readonly TimeSpan _delay;

    public DelayingHttpMessageHandler(TimeSpan delay)
    {
        _delay = delay;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(_delay, cancellationToken).ConfigureAwait(false);
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
    }
}

/// <summary>Loads the larger recorded-API-response bodies from Fixtures/*.json (copied to the output directory at build time), so they never need hand-retyping into test source.</summary>
internal static class Fixtures
{
    public static string Load(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", $"{name}.json"));
}

/// <summary>Shared client-construction helpers for tests.</summary>
internal static class TestClients
{
    /// <summary>
    /// Builds a client wired to <paramref name="handler"/>, with an explicit
    /// dummy API key and base URL so it can never fall through to a real
    /// environment variable or the production host.
    /// </summary>
    public static IBANforgeClient Create(HttpMessageHandler handler, string? apiKey = "ifk_test_key", string baseUrl = "https://fake.ibanforge.test")
    {
        var httpClient = new HttpClient(handler);
        return new IBANforgeClient(httpClient, new IBANforgeOptions { ApiKey = apiKey, BaseUrl = baseUrl });
    }
}
