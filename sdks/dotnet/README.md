# IBANforge.Sdk

Official .NET SDK for the [IBANforge](https://ibanforge.com?src=sdk-dotnet) API: IBAN
validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA/VoP, payment
reference and ISO 20022 address checks, and compliance triage. Targets
`net8.0`, no dependency beyond the base class library (`System.Text.Json` and
`HttpClient`).

Mirrors the [TypeScript](../typescript) and [Python](../python) SDKs: the same
routes, the same response shapes, the same typed-exception hierarchy. Pick
whichever language fits, the mental model transfers directly.

## Install

```bash
dotnet add package IBANforge.Sdk
```

> Publication on NuGet.org is pending. Until then, reference the project
> directly (`dotnet add reference ../path/to/IBANforge.Sdk.csproj`) or build
> your own package locally with `dotnet pack` and point NuGet at the resulting
> `.nupkg`.

## Quickstart

```csharp
using IBANforge.Sdk;

using var client = new IBANforgeClient(new IBANforgeOptions { ApiKey = "ifk_..." });
var result = await client.ValidateIbanAsync("CH1000230000000012345");

Console.WriteLine(result.Valid);                 // true
Console.WriteLine(result.Bic?.BankName);          // "UBS Switzerland AG"
Console.WriteLine(result.BankCodeCheck?.Status);  // "verified": the bank code is really allocated
Console.WriteLine(result.Sepa?.Member);           // true
```

⚠️ The SWIFT IBAN Registry's illustration (`CH9300762011623852957`) carries a
bank code no institution holds, so validating it comes back with a null `Bic`
and null `Clearing`. Use a register-allocated code, or call
`TestIbanAsync()`, which mints one with the register row that proves it.

## The free tier

No API key needed at all:

```csharp
using var client = new IBANforgeClient();
var formatted = await client.FormatIbanAsync("CH1000230000000012345");
```

`FormatIbanAsync` (mod-97 + structure only, no BIC/SEPA/compliance data),
`IbanStructuresAsync`, `IbanStructureAsync`, `TestIbanAsync`,
`ValidateReferenceAsync`, `CheckAddressAsync`, `CreditBundlesAsync`,
`DemoAsync` and `HealthAsync` are all free and require no key.

Everything else needs an `ifk_...` API key. Get one, 200 requests per month,
free, in one line:

```csharp
var key = await IBANforgeClient.GenerateApiKeyAsync("you@company.com");
using var client = new IBANforgeClient(new IBANforgeOptions { ApiKey = key.ApiKeyValue });
```

Use a mailbox you can read: fictional and disposable domains (`example.com`,
`mailinator`, …) are refused with `disposable_email`. `key.ApiKeyValue` is
shown once: store it before the process exits.

`ApiKey` and `BaseUrl` also fall back to the `IBANFORGE_API_KEY` and
`IBANFORGE_API_BASE` environment variables (the same names the MCP server
reads), so a client with no explicit options still picks up a key set in the
environment:

```csharp
using var client = new IBANforgeClient(); // reads IBANFORGE_API_KEY / IBANFORGE_API_BASE if set
```

## ASP.NET Core / `IHttpClientFactory`

`IBANforgeClient` accepts a caller-supplied `HttpClient`, so it composes
cleanly with `IHttpClientFactory`: its lifecycle, pooling and any
`DelegatingHandler`s (retry, logging, …) stay with whoever registered it.
`IBANforgeClient` never disposes an `HttpClient` it did not create itself.

```csharp
builder.Services.AddHttpClient("ibanforge");

// wherever you resolve it:
var httpClient = httpClientFactory.CreateClient("ibanforge");
using var client = new IBANforgeClient(httpClient, new IBANforgeOptions { ApiKey = apiKey });
```

Prefer a `using var client = new IBANforgeClient(options)` (no `HttpClient`
argument) for short-lived scripts and tools: that constructor owns an internal
`HttpClient` and disposes it when the client is disposed.

## Error handling

A malformed IBAN is **not** an exception: it comes back HTTP 200 with
`{"valid": false, "error": "checksum_failed"}`. Exceptions are for transport
and authorization failures, mapped from the HTTP status exactly like the
TypeScript and Python SDKs:

| Status | Exception | Notes |
|---|---|---|
| 401 / 403 | `AuthException` | Missing, invalid, or revoked API key |
| 402 | `PaymentRequiredException` | `.Accepts` carries the x402 payment challenge |
| 413 | `PayloadTooLargeException` | Body over the API's limit; split the payload |
| 429, `error: "quota_exceeded"` | `QuotaExhaustedException` | Monthly key quota exhausted |
| 429, otherwise | `RateLimitException` | Per-IP transport rate limit |
| other 4xx | `InvalidInputException` | Malformed request |
| 5xx | `ApiException` | Server-side failure; safe to retry |
| timeout / network error | `IBANforgeException` | Base type; see below |

All of these derive from `IBANforgeException`, which exposes:

- `Status` (`int?`): the HTTP status, when there was one.
- `Body` (`object?`): the parsed response body, a `JsonElement` when the
  response was valid JSON, the raw text otherwise.
- `Code` (`string?`): the API's machine-readable error slug (e.g.
  `invalid_key`, `disposable_email`, `verification_required`, `rate_limited`),
  lifted out of `Body` so you can branch on one property.

```csharp
try
{
    var result = await client.ValidateIbanAsync(iban);
}
catch (PaymentRequiredException ex)
{
    // ex.Accepts carries the x402 challenge (scheme, network, price, payTo, ...)
}
catch (AuthException ex) when (ex.Code == "verification_required")
{
    // a mailbox already requested a key this week: read the six-digit code it was sent
}
catch (IBANforgeException ex)
{
    Console.WriteLine($"{ex.GetType().Name}: {ex.Message} (status {ex.Status}, code {ex.Code})");
}
```

A per-call `CancellationToken` is honoured on every method: cancelling it
propagates as an ordinary `OperationCanceledException`, never wrapped. The
client's own request timeout (`IBANforgeOptions.Timeout`, 30 seconds by
default) surfaces as `IBANforgeException` instead, so the two are always
distinguishable in a `catch`.

## Coverage

Every public IBANforge endpoint has a matching method, returning strongly
typed records under `IBANforge.Sdk.Models`:

| Method | Route |
|---|---|
| `FormatIbanAsync` | `GET /v1/iban/format` |
| `ValidateIbanAsync` | `POST /v1/iban/validate` |
| `ValidateBatchAsync` | `POST /v1/iban/batch` |
| `CheckComplianceAsync` | `POST /v1/iban/compliance` |
| `LookupBicAsync` | `GET /v1/bic/:code` |
| `LookupChClearingAsync` | `GET /v1/ch/clearing/:iid` |
| `IbanStructuresAsync` | `GET /v1/iban/structure` |
| `IbanStructureAsync` | `GET /v1/iban/structure/:country` |
| `TestIbanAsync` | `GET /v1/test-iban` |
| `ValidateReferenceAsync` | `GET /v1/reference/validate` |
| `CheckAddressAsync` | `POST /v1/address/check` |
| `CreditBundlesAsync` | `GET /v1/credits/bundles` |
| `DemoAsync` | `GET /v1/demo` |
| `GenerateApiKeyAsync` (static) | `POST /v1/keys/generate` |
| `UsageAsync` | `GET /v1/keys/usage` |
| `HealthAsync` | `GET /health` |

## Development

```bash
dotnet test    # from sdks/dotnet, or from src/tests individually
dotnet pack src/IBANforge.Sdk/IBANforge.Sdk.csproj -c Release
```

Tests run entirely offline against a fake `HttpMessageHandler`: no network
access, no real API key required.
