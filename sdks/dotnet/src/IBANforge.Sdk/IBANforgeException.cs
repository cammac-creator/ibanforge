using System.Text.Json;

namespace IBANforge.Sdk;

/// <summary>
/// Base class for every exception the IBANforge SDK throws.
///
/// A malformed IBAN is NOT an exception: it comes back HTTP 200 with
/// <c>{"valid": false, "error": "checksum_failed"}</c>. Exceptions here are for
/// transport and authorization failures, mirroring the TypeScript and Python
/// SDKs' error hierarchy exactly, so the same status code maps to the same
/// exception type in every language.
/// </summary>
public class IBANforgeException : Exception
{
    /// <summary>The HTTP status code, when the failure came from the API. Null for a client-side or network failure.</summary>
    public int? Status { get; }

    /// <summary>
    /// The parsed response body: a <see cref="JsonElement"/> when the response was
    /// valid JSON (the common case), or the raw response text when it was not.
    /// Null when there was no HTTP response at all (timeout, network error, or a
    /// client-side guard such as <see cref="IBANforgeClient.ValidateBatchAsync"/>
    /// rejecting an empty list before any request is sent).
    /// </summary>
    public object? Body { get; }

    /// <summary>
    /// The API's machine-readable error slug (<c>invalid_key</c>, <c>disposable_email</c>,
    /// <c>verification_required</c>, <c>rate_limited</c>, etc.), lifted out of
    /// <see cref="Body"/> so a caller can branch on one property instead of
    /// inspecting a body whose shape it must first prove is even an object.
    /// Null when the body carries no <c>error</c> string.
    /// </summary>
    public string? Code { get; }

    /// <summary>Creates an exception with a message and, when the failure came from an HTTP response, its status and body.</summary>
    public IBANforgeException(string message, int? status = null, object? body = null)
        : this(message, status, body, innerException: null)
    {
    }

    /// <summary>Creates an exception with a message, optional status/body, and an inner exception (used for wrapped network failures).</summary>
    public IBANforgeException(string message, int? status, object? body, Exception? innerException)
        : base(message, innerException)
    {
        Status = status;
        Body = body;
        Code = ExtractCode(body);
    }

    /// <summary>
    /// Pulls the <c>error</c> slug out of a parsed JSON body. Every documented
    /// IBANforge error response is <c>{"error": "&lt;snake_case token&gt;", "message": "&lt;sentence&gt;"}</c>
    /// (audit DX-02, 2026-09-01); this reads the first half so callers do not
    /// have to.
    /// </summary>
    private static string? ExtractCode(object? body)
    {
        if (body is JsonElement element &&
            element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("error", out var errorProp) &&
            errorProp.ValueKind == JsonValueKind.String)
        {
            return errorProp.GetString();
        }

        return null;
    }
}

/// <summary>401 / 403: missing, invalid, or revoked API key.</summary>
public sealed class AuthException : IBANforgeException
{
    /// <inheritdoc />
    public AuthException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
    }
}

/// <summary>
/// 402: payment required. <see cref="Accepts"/> carries the x402 payment
/// challenge (scheme, network, price, payTo, timeout) lifted out of the
/// response body, so an x402-capable caller can pay and retry instead of
/// dead-ending on a bare error message.
/// </summary>
public sealed class PaymentRequiredException : IBANforgeException
{
    /// <summary>The x402 <c>accepts</c> payment requirement from the response body, when present.</summary>
    public JsonElement? Accepts { get; }

    /// <inheritdoc />
    public PaymentRequiredException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
        if (body is JsonElement element &&
            element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("accepts", out var accepts))
        {
            Accepts = accepts;
        }
    }
}

/// <summary>
/// 413: the request body is over the API's limit (1&#160;MB, and a batch is
/// capped at 100 IBANs before that). Broken out of <see cref="InvalidInputException"/>
/// (audit DX-09, 2026-09-01): 413 is a distinct, reproducible answer with a
/// distinct remedy (split the payload), and a caller that catches "malformed
/// input" would otherwise retry the same oversized body forever.
/// </summary>
public sealed class PayloadTooLargeException : IBANforgeException
{
    /// <inheritdoc />
    public PayloadTooLargeException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
    }
}

/// <summary>
/// 429 with <c>error == "quota_exceeded"</c>: the API key's monthly quota is
/// exhausted. The API usually falls through to 402 instead (advertising x402
/// payment so a caller can keep going per-call); this is only raised when the
/// server explicitly returns 429 for a quota reason.
/// </summary>
public sealed class QuotaExhaustedException : IBANforgeException
{
    /// <inheritdoc />
    public QuotaExhaustedException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
    }
}

/// <summary>429: global (per-IP) transport rate limit, unrelated to any API key's quota.</summary>
public sealed class RateLimitException : IBANforgeException
{
    /// <inheritdoc />
    public RateLimitException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
    }
}

/// <summary>Any other 4xx: malformed input (bad IBAN length, bad BIC format, missing query parameter, etc.).</summary>
public sealed class InvalidInputException : IBANforgeException
{
    /// <inheritdoc />
    public InvalidInputException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
    }
}

/// <summary>5xx: server-side failure. Safe to retry with backoff.</summary>
public sealed class ApiException : IBANforgeException
{
    /// <inheritdoc />
    public ApiException(string message, int? status = null, object? body = null) : base(message, status, body)
    {
    }
}
