# @ibanforge/sdk

Official TypeScript/JavaScript SDK for the [IBANforge API](https://ibanforge.com?src=sdk-ts) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA + VoP reachability and compliance risk scoring. Zero runtime dependencies (uses native `fetch`).

> The examples below use recorded API responses. CI executes the TypeScript blocks and checks the annotated output against those recordings. Bank records, source dates, coverage, quotas and prices can change: these assertions do not prove the current live answer. Use the response you receive, including its source and date, for your integration.

## Install

```bash
npm install @ibanforge/sdk
```

## Quick start

The SDK sends the submitted IBAN to the API, including for the free format check. Use synthetic examples for your first test.

```typescript
import { IBANforge } from '@ibanforge/sdk';

// Free format check — no API key needed
const fmt = await new IBANforge().formatIban('CH1000230000000012345');
console.log(fmt.valid);                    // true
console.log(fmt.bban?.bank_code);          // '00230'
```

For the remaining examples, [create one reusable key](#get-a-reusable-key-without-e-mail) and replace `ifk_...` with it, or omit `apiKey` to use your server's `IBANFORGE_API_KEY`. Keep it in secret configuration, outside browser bundles and logs. Run these JavaScript-compatible snippets in a Node.js ES module (`.mjs`) or a TypeScript environment that supports top-level `await`.

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({ apiKey: 'ifk_...' });

const r = await client.validateIban('CH1000230000000012345');
console.log(r.valid);                      // true
console.log(r.bic?.code);                  // 'UBSWCHZH'
console.log(r.bic?.bank_name);             // 'UBS Switzerland AG'
console.log(r.sepa?.member);               // true
console.log(r.clearing?.iid);              // '00230'
console.log(r.clearing?.qr_iid);           // '30005'
console.log(r.bank_code_check?.status);    // 'verified'
```

`baseUrl` and `apiKey` also read `IBANFORGE_API_BASE` and `IBANFORGE_API_KEY` from the environment, so the same variables configure the SDK and the MCP server.

## Read the bank-code result separately from the checksum

A valid checksum does not establish that the bank code is allocated. `bank_code_check` describes the evidence available for that code, independently of `valid`:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({ apiKey: 'ifk_...' });

// Réponse enregistrée : format valide, code banque absent du registre utilisé.
const ghost = await client.validateIban('CH9300762011623852957');
console.log(ghost.valid);                     // true
console.log(ghost.bank_code_check?.status);   // 'not_in_register'
console.log(ghost.bank_code_check?.authoritative); // true
console.log(ghost.bic);                       // null
console.log(ghost.clearing);                  // null
console.log(ghost.next_steps?.[0].code);      // 'bank_code_not_allocated'
```

`valid` and `bank_code_check` answer different questions. In the recorded example, `not_in_register` with `authoritative: true` reports a code absent from the exhaustive register used, at its reference date. A partial source cannot prove absence. An unavailable source is not a negative result, and a verified code can also carry retirement information. Preserve `register`, its dates, `reason`, and any retirement or successor fields in your review record.

A missing BIC stays unknown; do not invent one or silently replace supplied banking details. These checks do not establish account existence, account ownership, or authorization to pay. SEPA and VoP fields describe country or participant coverage, not a beneficiary-name match. See the [validation response guide](https://ibanforge.com/docs/iban-validate?src=sdk-ts).

For a fixture or demo, request a synthetic test IBAN and inspect the proof returned. It does not identify a usable payment account:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const t = await new IBANforge().testIban({ country: 'CH' });   // free, no key
console.log(t.test_ibans[0].proof.bank_code_check.status);     // 'verified'
console.log(t.test_ibans[0].proof.bank_code_check.authoritative); // true
```

## Get a reusable key without e-mail

```typescript
import { IBANforge } from '@ibanforge/sdk';

const key = await IBANforge.generateApiKey();
console.log(key.monthly_limit);            // 25
// key.api_key is shown ONCE — store it now.
```

No address, card or confirmation is needed. Store the key in your secret configuration,
reuse it for subsequent calls, and read `usage()` for its actual allowance. Normally this
key provides 25 REST requests per month; temporary creation protection can lower that
allowance, so read `monthly_limit` from the response. Do not create a key per request.

After the key has served a call, `POST /v1/keys/claim` with
`Authorization: Bearer ifk_…` can raise its allowance: an explicitly supplied mailbox
and a six-digit code give 200 requests per month; an x402 payment made on the key gives
200 requests once. An exhausted quota does not authorize sending an address or making
a payment on the user's behalf. Follow the API's error details and retry delay.

The existing email argument and code option remain supported for callers who explicitly
choose that route. No email is inferred from environment variables or other accounts.

## All methods

The amounts below are per-call x402 prices in USDC, not charges added to an API-key allowance. On a key, each metered call uses one request or credit; a batch uses one per submitted IBAN, including invalid entries. Free reference routes remain free. Read `usage()` for the key's allowance and [pricing](https://ibanforge.com/pricing?src=sdk-ts) for current plans and payment options. This SDK does not buy credits or sign x402 payments automatically.

| Method | x402 price or free route | What it does |
|---|---|---|
| `formatIban(iban)` | **free** | mod-97 + structure only. Pre-filter before paying. |
| `validateIban(iban)` | $0.005 | Full enrichment — BIC, issuer/EMI class, SEPA + VoP, bank-code register check, Swiss BC-Nummer |
| `validateBatch([...])` | $0.002 / IBAN | Up to 100 in one call |
| `lookupBic(code)` | $0.003 | BIC → bank, country, city, LEI, registered address |
| `lookupChClearing(iid)` | $0.003 | Swiss BC-Nummer / IID → SIX rail participation + QR-IID |
| `checkCompliance(iban)` | $0.02 | Sanctions (bank BIC) + FATF + SEPA + VoP + risk score 0–100 |
| `validateReference(reference)` | **free** | QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish reference, checked against the dated document that publishes the rule |
| `checkAddress(scheme, address)` | **free** | A structured ISO 20022 postal address measured against a scheme's rules (`sps`, `hvps_plus`, `fedwire`), each finding citing its guideline |
| `ibanStructures()` | **free** | Every supported country and its IBAN length |
| `ibanStructure(country)` | **free** | One country's BBAN template |
| `testIban({country})` | **free** | Synthetic test IBANs with the bank-code proof available at generation |
| `creditBundles()` | **free** | Prepaid packs and their per-call price |
| `demo()` | **free** | Worked examples of every endpoint |
| `usage()` | **free** | This key's quota for the current month |
| `health()` | **free** | API version, database size |
| `IBANforge.generateApiKey(email?)` | **free** | Reusable key without e-mail; read its returned quota |

Batch and the two lookups, in practice:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({ apiKey: 'ifk_...' });

const batch = await client.validateBatch(['CH1000230000000012345', 'DE89370400440532013000']);
console.log(batch.count);                  // 2
console.log(batch.valid_count);            // 2

const bic = await client.lookupBic('UBSWCHZH80A');
console.log(bic.found);                    // true
console.log(bic.institution);              // 'UBS Switzerland AG'
console.log(bic.lei);                      // '549300WOIFUSNYH0FL22'

const ch = await client.lookupChClearing('230');
console.log(ch.institution?.name);         // 'UBS Switzerland AG'
console.log(ch.payment_services?.sic);     // true
console.log(ch.qr_iid);                    // '30005'

const u = await client.usage();
console.log(u.limit);                      // 200
```

The reference endpoints need no key at all:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge();

const structures = await client.ibanStructures();
console.log(structures.total);              // 89

const ch = await client.ibanStructure('CH');
console.log(ch.iban_length);                // 21
console.log(ch.bban_pattern);               // '5!n12!c'

const packs = await client.creditBundles();
console.log(packs.bundles[0].credits);      // 1000
console.log(packs.bundles[0].price_usdc);   // 5

const d = await client.demo();
console.log((d.iban_examples ?? []).length > 0); // true
```

## Compliance result shape

The score is nested under `compliance`. There is no top-level `risk_score`, and no `recommended_action`. The output below is a recorded example, not a current clearance. Read each check's `screened` state, `flags` and source dates in `meta`: an empty match list or a low score does not establish that every source was available.

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({ apiKey: 'ifk_...' });

const c = await client.checkCompliance('GB29NWBK60161331926819');
console.log(typeof c.compliance.risk_score);       // 'number'
console.log(c.compliance.risk_level);              // 'low'
console.log(c.compliance.sanctions.matched_lists); // []
console.log(c.compliance.sanctions.fatf_status);   // 'member'
console.log(c.meta?.scope);                        // 'bank_bic_only'
```

> Sanctions screening is at the **bank (BIC8)** level — it does not screen the beneficiary name and is not a regulated AML/CFT product. `risk_level: 'unassessable'` means nothing could be screened; it is the absence of a verdict, never a favourable one.

## A malformed IBAN is not an error

This one surprises people, so it is worth one block: a syntactically wrong IBAN comes back **200 with `valid: false`**, not an exception. Exceptions cover failed requests, including authorization, limits and server errors. A timeout does not mean `valid: false`.

```typescript
import { IBANforge } from '@ibanforge/sdk';

const bad = await new IBANforge().formatIban('CH93007620116238529XX');
console.log(bad.valid);                    // false
console.log(bad.error);                    // 'checksum_failed'
```

## Typed errors

HTTP failures throw a typed subclass of `IBANforgeError`, carrying `status`, `code` (the API's error slug, when present) and `body`. Network, timeout and response-decoding failures throw the base `IBANforgeError` without an HTTP status:

```typescript
import { IBANforge, AuthError, InvalidInputError } from '@ibanforge/sdk';

try {
  await new IBANforge({ apiKey: 'ifk_wrong' }).usage();
} catch (err) {
  if (err instanceof AuthError) {
    console.log(err.status);               // 401
    console.log(err.code);                 // 'invalid_key'
  }
}

try {
  await new IBANforge().lookupBic('NOTABIC');
} catch (err) {
  if (err instanceof InvalidInputError) {
    console.log(err.code);                 // 'invalid_bic_format'
    console.log(err.status);               // 400
  }
}
```

| Class | HTTP | When |
|---|---|---|
| `AuthError` | 401 / 403 | Read the error code: invalid/revoked key or an access restriction; `verification_required` specifically requests mailbox verification |
| `PaymentRequiredError` | 402 | No usable allowance or payment proof. `err.accepts` exposes any x402 challenge; inspect the error and current key usage before choosing an authorized next step |
| `QuotaExhaustedError` | 429 | Only HTTP 429 with `error: quota_exceeded`; exhausted API-key quota can instead return 402 |
| `RateLimitError` | 429 | Other HTTP 429 responses; read the reason and retry delay, then use bounded backoff |
| `PayloadTooLargeError` | 413 | The body is over the limit — split it, do not retry the same payload |
| `InvalidInputError` | other 4xx | Malformed request (a malformed *IBAN* is a 200, see above) |
| `APIError` | 5xx | Server-side failure; keep the result unavailable and retry only under a bounded policy |

Keep failed requests separate from invalid input. Neither a network error nor a 402/429/5xx response is a bank-code verdict. Do not loop on key creation or purchase credits automatically. A retry after an uncertain response may consume another unit; stop the workflow or queue it for review when its retry budget is exhausted.

## Config

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({
  apiKey: 'ifk_...',   // or the IBANFORGE_API_KEY environment variable
  baseUrl: undefined,  // or IBANFORGE_API_BASE; defaults to api.ibanforge.com
  timeoutMs: 30_000,   // default 30s
});

const h = await client.health();
console.log(h.status);                     // 'ok'
```

## Full documentation

[ibanforge.com/docs](https://ibanforge.com/docs?src=sdk-ts) · [agent guide](https://ibanforge.com/agents?src=sdk-ts) · [OpenAPI](https://ibanforge.com/openapi?src=sdk-ts)

## License

MIT
