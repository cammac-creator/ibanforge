# IBANforge Java SDK

Official Java SDK for the [IBANforge API](https://ibanforge.com?src=sdk-java) -- IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA/VoP reachability and compliance risk scoring. Zero runtime dependencies beyond Jackson (uses the JDK's built-in `java.net.http.HttpClient`).

## Install

Maven Central publication is pending (it is at the project owner's hand). Until then, build and install from the repository:

```bash
git clone https://github.com/cammac-creator/ibanforge.git
cd ibanforge/sdks/java
mvn install
```

Then depend on it like any local artifact:

```xml
<dependency>
  <groupId>com.ibanforge</groupId>
  <artifactId>ibanforge-sdk</artifactId>
  <version>1.5.0</version>
</dependency>
```

## Quick start

```java
IBANforge client = IBANforge.builder().apiKey("ifk_...").build();

IBANValidationResult r = client.validateIban("CH1000230000000012345");
System.out.println(r.valid());                 // true
System.out.println(r.bic().bankName());         // "UBS Switzerland AG"
System.out.println(r.bankCodeCheck().status()); // "verified"
System.out.println(r.sepa().member());          // true
```

`apiKey` and `baseUrl` also fall back to the `IBANFORGE_API_KEY` and `IBANFORGE_API_BASE` environment variables -- the same names the MCP server reads, so one setting configures both.

## The free door: no key needed

`formatIban` is a pure mod-97 + structure check -- no directory lookups, no API key, no cost. Use it to filter obviously malformed IBANs before paying for full enrichment:

```java
IBANforge free = IBANforge.create(); // no key
IBANFormatResult fmt = free.formatIban("CH1000230000000012345");
System.out.println(fmt.valid());              // true
System.out.println(fmt.bban().bankCode());    // "00230"
```

A syntactically wrong IBAN comes back **200 with `valid: false`**, not an exception -- exceptions are reserved for transport and authorization failures:

```java
IBANFormatResult bad = free.formatIban("CH93007620116238529XX");
System.out.println(bad.valid());  // false
System.out.println(bad.error());  // "checksum_failed"
```

`ibanStructures()`, `ibanStructure(country)`, `testIban()`, `validateReference(reference)`, `checkAddress(scheme, address)`, `creditBundles()`, and `demo()` are all free too -- see the table below.

## Get a free key in one line

```java
APIKey key = IBANforge.generateApiKey("you@company.com");
System.out.println(key.monthlyLimit()); // 200
// key.apiKey() is shown ONCE -- store it now.
```

Or grab one interactively at [ibanforge.com](https://ibanforge.com?src=sdk-java). Use a mailbox you can read: fictional and disposable domains (`example.com`, `mailinator`, ...) are refused with `disposable_email`. A **second** key from the same network within seven days answers `403 verification_required` and mails a six-digit code -- replay the call with it:

```java
APIKey key = IBANforge.generateApiKey("you@company.com", "123456");
```

## All methods

| Method | Cost | What it does |
|---|---|---|
| `formatIban(iban)` | **free** | mod-97 + structure only. Pre-filter before paying. |
| `validateIban(iban)` | $0.005 | Full enrichment -- BIC, issuer/EMI class, SEPA + VoP, bank-code register check, Swiss BC-Nummer |
| `validateBatch(ibans)` | $0.002 / IBAN | Up to 100 in one call |
| `lookupBic(code)` | $0.003 | BIC to bank, country, city, LEI, registered address |
| `lookupChClearing(iid)` | $0.003 | Swiss BC-Nummer / IID to SIX rail participation + QR-IID |
| `checkCompliance(iban)` | $0.02 | Sanctions (bank BIC) + FATF + SEPA + VoP + risk score 0-100 |
| `validateReference(reference)` | **free** | QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish reference, checked against the dated document that publishes the rule |
| `checkAddress(scheme, address)` | **free** | A structured ISO 20022 postal address measured against a scheme's rules (`sps`, `hvps_plus`, `fedwire`), each finding citing its guideline |
| `ibanStructures()` | **free** | Every supported country and its IBAN length |
| `ibanStructure(country)` | **free** | One country's BBAN template |
| `testIban()` | **free** | Test IBANs with a REAL bank code, plus the register row proving it |
| `creditBundles()` | **free** | Prepaid packs and their per-call price |
| `demo()` | **free** | Worked examples of every endpoint |
| `usage()` | **free** | This key's quota for the current month |
| `health()` | **free** | API version, database size |
| `IBANforge.generateApiKey(email)` | **free** | 200 requests/month |

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
| `PaymentRequiredException` | 402 | No key and no credit. `getAccepts()` carries the x402 challenge -- pay and retry, no dead end |
| `QuotaExhaustedException` | 429 | Monthly free quota spent (the API usually answers 402 instead, so you can pay through) |
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
