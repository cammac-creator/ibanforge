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

> Published on [nuget.org](https://www.nuget.org/packages/IBANforge.Sdk) since 1.5.0
> (2026-09-06), through nuget.org trusted publishing from this repository's CI.
> To build from source instead: `dotnet pack src/IBANforge.Sdk/IBANforge.Sdk.csproj -c Release`.

## Quickstart

```csharp
using IBANforge.Sdk;

using var client = new IBANforgeClient(); // lit IBANFORGE_API_KEY si définie
var result = await client.ValidateIbanAsync("CH1000230000000012345");

Console.WriteLine(result.Valid);                 // true
Console.WriteLine(result.Bic?.BankName);          // "UBS Switzerland AG"
Console.WriteLine(result.BankCodeCheck?.Status);  // "verified": the bank code is really allocated
Console.WriteLine(result.Sepa?.Member);           // true
```

Without a configured key, this single `ValidateIbanAsync` call uses the limited REST trial on `POST /v1/iban/validate`. It does not unlock batch or BIC lookup. Consult the current [access limits](https://api.ibanforge.com/.well-known/rate-limits.yml) and keep the same key for subsequent calls. The IBAN above is fictitious, with an allocated bank code; the response does not establish account existence, identify its holder or authorize a payment.

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

`ValidateIbanAsync` also has the limited REST trial described above. For batch, BIC lookup and other authenticated calls, reuse a key with available allowance or credits. See [current pricing](https://ibanforge.com/pricing?src=sdk-dotnet); the SDK does not buy credits or pay an x402 challenge automatically.

## Create a key once, then reuse it

Start with the [key guide](https://ibanforge.com/docs/api-keys?src=sdk-dotnet). An empty HTTP request creates a key without an email address:

```bash
curl --fail-with-body -X POST https://api.ibanforge.com/v1/keys/generate
```

Run this once during setup, not on application startup or for every document. Store the returned `api_key` securely and supply it as `IBANFORGE_API_KEY`; do not log it or commit it. Read `monthly_limit` and any `notice` instead of assuming a fixed allowance. An anonymous key has a smaller allowance than one claimed through a mailbox. After its first authenticated use, follow the guide to claim the same key if needed.

The .NET SDK's creation method requires an email argument and rejects `null`. Use the HTTP path above for anonymous creation, or, only when you choose to supply a mailbox you control:

```csharp
var key = await IBANforgeClient.GenerateApiKeyAsync(email);
Console.WriteLine(key.MonthlyLimit); // plafond réellement renvoyé
// Conserver key.ApiKeyValue dans un stockage de secrets, sans l'afficher.
using var client = new IBANforgeClient(new IBANforgeOptions { ApiKey = key.ApiKeyValue });
```

Here `email` is your chosen address, not a placeholder to send unchanged. Fictional and disposable domains are refused. Creation can return a key immediately or answer `403 verification_required` if a key was already issued from the network recently. Only in that case, read the code sent to that mailbox and repeat the request:

```csharp
var key = await IBANforgeClient.GenerateApiKeyAsync(email, code: verificationCode);
```

This creation flow is different from claiming a key you already hold. Do not create another key to claim one, reset its allowance or work around a refusal. During a signup alert, a key without a verified mailbox can start with a reduced allowance. `MonthlyLimit` remains the value to use; this SDK version does not expose the response's `notice` field. The HTTP key guide documents that field and the claim flow. `ApiKeyValue` is shown once: store it before the process exits.

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
| 401 / 403 | `AuthException` | Missing, invalid, or revoked API key; mailbox verification required |
| 402 | `PaymentRequiredException` | `.Accepts` carries the x402 payment challenge |
| 413 | `PayloadTooLargeException` | Body over the API's limit; split the payload |
| 429, `error: "quota_exceeded"` | `QuotaExhaustedException` | Monthly key quota exhausted |
| 429, otherwise | `RateLimitException` | Per-IP transport rate limit |
| other 4xx | `InvalidInputException` | Malformed request |
| 5xx | `ApiException` | Server-side failure; retry with backoff only when appropriate for the operation |
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
    // Pendant une création avec adresse : lire le code reçu, puis répéter avec ce code.
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

The methods below return typed records under `IBANforge.Sdk.Models`. Account actions such as claiming an existing key use the HTTP flow in the key guide; do not assume that every API route has an SDK method.

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
