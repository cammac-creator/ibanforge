using IBANforge.Sdk;
using Xunit;

namespace IBANforge.Sdk.Tests;

/// <summary>
/// The client's own timeout must surface as <see cref="IBANforgeException"/> (never a bare
/// <see cref="OperationCanceledException"/>), while cancellation the CALLER asked for must
/// propagate untouched, mirroring the brief's "sauf si le CancellationToken de l'appelant
/// est annulé" carve-out exactly.
/// </summary>
public sealed class TimeoutAndCancellationTests
{
    [Fact]
    public async Task InternalTimeout_ThrowsIBANforgeException_WithTimeoutMessage()
    {
        // The handler outlives the client's configured timeout by two orders of
        // magnitude, so the race can only resolve one way.
        var handler = new DelayingHttpMessageHandler(TimeSpan.FromSeconds(5));
        var httpClient = new HttpClient(handler);
        using var client = new IBANforgeClient(httpClient, new IBANforgeOptions
        {
            BaseUrl = "https://fake.ibanforge.test",
            Timeout = TimeSpan.FromMilliseconds(50),
        });

        var ex = await Assert.ThrowsAsync<IBANforgeException>(() => client.FormatIbanAsync("CH1000230000000012345"));

        Assert.Contains("timed out", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("50ms", ex.Message);
        Assert.Null(ex.Status);
        Assert.IsNotType<AuthException>(ex);
    }

    [Fact]
    public async Task CallerCancellation_PropagatesAsOperationCanceledException_NotWrappedAsIBANforgeException()
    {
        var handler = new DelayingHttpMessageHandler(TimeSpan.FromSeconds(5));
        var httpClient = new HttpClient(handler);
        // A generous 5s client timeout, so only the caller's own token can win this race.
        using var client = new IBANforgeClient(httpClient, new IBANforgeOptions
        {
            BaseUrl = "https://fake.ibanforge.test",
            Timeout = TimeSpan.FromSeconds(5),
        });
        using var callerCts = new CancellationTokenSource();
        callerCts.CancelAfter(TimeSpan.FromMilliseconds(30));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => client.FormatIbanAsync("CH1000230000000012345", callerCts.Token));
    }

    [Fact]
    public async Task AlreadyCancelledToken_PropagatesAsOperationCanceledException()
    {
        var handler = new FakeHttpMessageHandler(System.Net.HttpStatusCode.OK, "{}");
        using var client = TestClients.Create(handler);
        using var callerCts = new CancellationTokenSource();
        await callerCts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => client.FormatIbanAsync("CH1000230000000012345", callerCts.Token));
    }
}
