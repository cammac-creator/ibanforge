# IBANforge Java SDK

Official Java SDK for the [IBANforge API](https://ibanforge.com?src=sdk-java) -- IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA/VoP reachability and compliance risk scoring. Zero runtime dependencies beyond Jackson (uses the JDK's built-in `java.net.http.HttpClient`).

## Install

Published on [Maven Central](https://central.sonatype.com/artifact/com.ibanforge/ibanforge-sdk):

```xml
<dependency>
  <groupId>com.ibanforge</groupId>
  <artifactId>ibanforge-sdk</artifactId>
  <version>1.8.1</version>
</dependency>
```

## Quick start

```java
import com.ibanforge.sdk.IBANforge;
import com.ibanforge.sdk.model.IBANValidationResult;

IBANforge client = IBANforge.create(); // lit IBANFORGE_API_KEY si définie

IBANValidationResult r = client.validateIban("CH1000230000000012345");
System.out.println(r.valid());                 // true
if (r.bic() != null) System.out.println(r.bic().bankName());
if (r.bankCodeCheck() != null) System.out.println(r.bankCodeCheck().status());
```

`apiKey` and `baseUrl` also fall back to the `IBANFORGE_API_KEY` and `IBANFORGE_API_BASE` environment variables -- the same names the MCP server reads, so one setting configures both.

Without a configured key, this single `validateIban` call uses the limited REST trial on `POST /v1/iban/validate`. It does not unlock batch or BIC lookup. Consult the current [access limits](https://api.ibanforge.com/.well-known/rate-limits.yml) and keep the same key for subsequent calls. The IBAN above is a fictitious example with an allocated bank code; no result establishes that its account exists, identifies its holder or authorizes a payment.

## The free door: no key needed

`formatIban` is a pure mod-97 + structure check -- no directory lookups, no API key, no cost. Use it to filter obviously malformed IBANs before paying for full enrichment:

```java
IBANforge free = IBANforge.create(); // aucune clé requise pour cette route
IBANFormatResult fmt = free.formatIban("CH1000230000000012345");
System.out.println(fmt.valid());              // true
System.out.println(fmt.bban().bankCode());    // "00230"
```

A syntactically wrong IBAN comes back **200 with `valid: false`**, not an exception -- exceptions are reserved for transport and authorization failures:

```java
IBANFormatResult bad = free.formatIban("CH1100230000000012345");
System.out.println(bad.valid());  // false
System.out.println(bad.error());  // "checksum_failed"
```

`ibanStructures()`, `ibanStructure(country)`, `testIban()`, `validateReference(reference)`, `checkAddress(scheme, address)`, `creditBundles()`, and `demo()` are all free too -- see the table below.

## Create a key once, then reuse it

Start with the [key guide](https://ibanforge.com/docs/api-keys?src=sdk-java). An empty HTTP request creates a key without an email address:

```bash
curl --fail-with-body -X POST https://api.ibanforge.com/v1/keys/generate
```

Run this once during setup, not on application startup or for every document. Save the returned `api_key` securely and supply it as `IBANFORGE_API_KEY` to the application; do not log it or commit it. Read the returned `monthly_limit` and any `notice` instead of assuming a fixed allowance. A new anonymous key has a smaller allowance than one claimed through a mailbox. After its first authenticated use, follow the guide to claim that same key if needed.

The Java SDK's creation method takes an email address; it has no no-argument creation method. Use the HTTP path above for anonymous creation, or, only when you choose to supply a mailbox you control:

```java
import com.ibanforge.sdk.model.APIKey;

APIKey key = IBANforge.generateApiKey(email);
System.out.println(key.monthlyLimit()); // plafond réellement renvoyé
// Conserver key.apiKey() dans un stockage de secrets, sans l'afficher.
```

Here `email` is your chosen address, not a placeholder to send unchanged. Fictional and disposable domains are refused. Creation can return a key immediately or answer `403 verification_required` if a key was already issued from the network recently. Only in that case, read the code sent to that mailbox and repeat the request with it:

```java
APIKey key = IBANforge.generateApiKey(email, verificationCode);
```

This creation flow is different from claiming a key you already hold. Do not create another key to claim one, reset its allowance or work around a refusal. During a signup alert, a key without a verified mailbox can start with a reduced allowance. `monthlyLimit()` remains the value to use; this SDK version does not expose the response's `notice` field. The HTTP key guide documents that field and the claim flow. Neither this SDK nor these examples automatically buy credits or pay an x402 challenge.

## All methods

Prices and limits can change independently of this SDK. See [current pricing](https://ibanforge.com/pricing?src=sdk-java) and the [access limits](https://api.ibanforge.com/.well-known/rate-limits.yml); “key” below means an existing key with available allowance or credits.

| Method | Access | What it does |
|---|---|---|
| `formatIban(iban)` | **free** | mod-97 + structure only. Pre-filter before paying. |
| `validateIban(iban)` | REST trial or key | Enrichment where available -- BIC, issuer/EMI class, SEPA + VoP reachability, bank-code register check, Swiss BC-Nummer |
| `validateBatch(ibans)` | Key | Up to 100 in one call; one unit per IBAN |
| `lookupBic(code)` | Key | BIC to bank, country, city, LEI and registered address where available |
| `lookupChClearing(iid)` | Key | Swiss BC-Nummer / IID to SIX rail participation + QR-IID |
| `checkCompliance(iban)` | Key | Bank-level sanctions screening, FATF, SEPA + VoP reachability and risk indicators; not holder screening |
| `validateReference(reference)` | **free** | QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish reference, checked against the dated document that publishes the rule |
| `checkAddress(scheme, address)` | **free** | A structured ISO 20022 postal address measured against a scheme's rules (`sps`, `hvps_plus`, `fedwire`), each finding citing its guideline |
| `ibanStructures()` | **free** | Every supported country and its IBAN length |
| `ibanStructure(country)` | **free** | One country's BBAN template |
| `testIban()` | **free** | Test IBANs with a REAL bank code, plus the register row proving it |
| `creditBundles()` | **free** | Prepaid packs and their per-call price |
| `demo()` | **free** | Worked examples of every endpoint |
| `usage()` | **free** | This key's quota for the current month |
| `health()` | **free** | API version, database size |
| `IBANforge.generateApiKey(email)` | **free** | Create a key with your chosen address; read its returned allowance |

## Typed exceptions

Every failure throws a subclass of `IBANforgeException`, carrying `getStatus()`, `getCode()` (the API's error slug) and `getBody()` (a Jackson `JsonNode`, or the raw response text when the body was not JSON):

```java
import com.ibanforge.sdk.AuthException;
import com.ibanforge.sdk.InvalidInputException;

try {
    IBANforge.builder().apiKey("ifk_wrong").build().usage();
} catch (AuthException e) {
    System.out.println(e.getStatus()); // 401
    System.out.println(e.getCode());   // "invalid_key"
}

try {
    IBANforge.create().lookupBic("NOTABIC");
} catch (InvalidInputException e) {
    System.out.println(e.getCode());   // "invalid_bic_format"
    System.out.println(e.getStatus()); // 400
}
```

| Class | HTTP | When |
|---|---|---|
| `AuthException` | 401 / 403 | Missing, revoked or mistyped key; mailbox verification required |
| `PaymentRequiredException` | 402 | Access allowance unavailable or exhausted. Inspect `getBody()` and `getAccepts()`; the SDK does not pay automatically |
| `QuotaExhaustedException` | 429 | `quota_exceeded`; inspect usage and the API response before retrying |
| `RateLimitException` | 429 | Too fast -- back off |
| `PayloadTooLargeException` | 413 | The body is over the limit -- split it, do not retry the same payload |
| `InvalidInputException` | other 4xx | Malformed request (a malformed *IBAN* is a 200, see above) |
| `ApiException` | 5xx | Server-side failure -- retry with backoff |

All of them extend `IBANforgeException`, so catching that base class catches everything.

## Config

```java
IBANforge client = IBANforge.builder()
    .apiKey("ifk_...")             // or the IBANFORGE_API_KEY environment variable
    .baseUrl("https://api.ibanforge.com") // or IBANFORGE_API_BASE
    .timeout(Duration.ofSeconds(30))      // default 30s
    .httpClient(myHttpClient)             // optional: bring your own java.net.http.HttpClient
    .build();

HealthInfo h = client.health();
System.out.println(h.status()); // "ok"
```

## Full documentation

[ibanforge.com/docs](https://ibanforge.com/docs?src=sdk-java) - [agent guide](https://ibanforge.com/agents?src=sdk-java) - [OpenAPI](https://ibanforge.com/openapi?src=sdk-java)

## License

MIT
