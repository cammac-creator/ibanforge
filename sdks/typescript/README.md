# @ibanforge/sdk

Official TypeScript/JavaScript SDK for the [IBANforge API](https://ibanforge.com?src=sdk-ts) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA + VoP reachability and compliance risk scoring. Zero runtime dependencies (uses native `fetch`).

> Every code block on this page is executed by the test suite, against recorded responses from the real API, and each `// comment` on a `console.log` is checked against what actually printed. A block that stops being true fails CI.

## Install

```bash
npm install @ibanforge/sdk
```

## Quick start

```typescript
import { IBANforge } from '@ibanforge/sdk';

// Free format check — no API key needed
const fmt = await new IBANforge().formatIban('CH1000230000000012345');
console.log(fmt.valid);                    // true
console.log(fmt.bban?.bank_code);          // '00230'

// Authenticated calls (or pay per call via x402 — see below)
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

## The answer nobody else gives: is this bank code real?

An IBAN can pass its mod-97 checksum and still name a bank that does not exist. `bank_code_check` says which:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({ apiKey: 'ifk_...' });

// The IBAN the SWIFT registry uses as an illustration. Structurally perfect,
// bank code 00762 allocated to nobody:
const ghost = await client.validateIban('CH9300762011623852957');
console.log(ghost.valid);                     // true
console.log(ghost.bank_code_check?.status);   // 'not_in_register'
console.log(ghost.bank_code_check?.authoritative); // true
console.log(ghost.bic);                       // null
console.log(ghost.clearing);                  // null
console.log(ghost.next_steps?.[0].code);      // 'bank_code_not_allocated'
```

`valid: true` **and** `not_in_register` is the correct pair: the number is well-formed, the bank is not there. Do not send.

Need an IBAN that *does* resolve — for a fixture, a demo, a test suite? Ask for one, with its proof:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const t = await new IBANforge().testIban({ country: 'CH' });   // free, no key
console.log(t.test_ibans[0].proof.bank_code_check.status);     // 'verified'
console.log(t.test_ibans[0].proof.bank_code_check.authoritative); // true
```

## Get a free key in one line

```typescript
import { IBANforge } from '@ibanforge/sdk';

const key = await IBANforge.generateApiKey('you@company.com');
console.log(key.monthly_limit);            // 200
// key.api_key is shown ONCE — store it now.
```

Use a mailbox you can read: fictional domains (`example.com`, `mailinator`, …) are refused with `disposable_email`. A **second** key from the same network within seven days answers `403 verification_required` and mails a six-digit code — replay the call with it:

```typescript
import { IBANforge } from '@ibanforge/sdk';

const key = await IBANforge.generateApiKey('you@company.com', { code: '123456' });
console.log(key.monthly_limit);            // 200
```

## All methods

| Method | Cost | What it does |
|---|---|---|
| `formatIban(iban)` | **free** | mod-97 + structure only. Pre-filter before paying. |
| `validateIban(iban)` | $0.005 | Full enrichment — BIC, issuer/EMI class, SEPA + VoP, bank-code register check, Swiss BC-Nummer |
| `validateBatch([...])` | $0.002 / IBAN | Up to 100 in one call |
| `lookupBic(code)` | $0.003 | BIC → bank, country, city, LEI, registered address |
| `lookupChClearing(iid)` | $0.003 | Swiss BC-Nummer / IID → SIX rail participation + QR-IID |
| `checkCompliance(iban)` | $0.02 | Sanctions (bank BIC) + FATF + SEPA + VoP + risk score 0–100 |
| `ibanStructures()` | **free** | Every supported country and its IBAN length |
| `ibanStructure(country)` | **free** | One country's BBAN template |
| `testIban({country})` | **free** | Test IBANs with a REAL bank code, plus the register row proving it |
| `creditBundles()` | **free** | Prepaid packs and their per-call price |
| `demo()` | **free** | Worked examples of every endpoint |
| `usage()` | **free** | This key's quota for the current month |
| `health()` | **free** | API version, database size |
| `IBANforge.generateApiKey(email)` | **free** | 200 requests/month |

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

The score is nested under `compliance`. There is no top-level `risk_score`, and no `recommended_action`.

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge({ apiKey: 'ifk_...' });

const c = await client.checkCompliance('GB29NWBK60161331926819');
console.log(c.compliance.risk_score);              // 10
console.log(c.compliance.risk_level);              // 'low'
console.log(c.compliance.sanctions.matched_lists); // []
console.log(c.compliance.sanctions.fatf_status);   // 'member'
console.log(c.compliance.reachability.sct);        // true
console.log(c.meta?.scope);                        // 'bank_bic_only'
```

> Sanctions screening is at the **bank (BIC8)** level — it does not screen the beneficiary name and is not a regulated AML/CFT product. `risk_level: 'unassessable'` means nothing could be screened; it is the absence of a verdict, never a favourable one.

## A malformed IBAN is not an error

This one surprises people, so it is worth one block: a syntactically wrong IBAN comes back **200 with `valid: false`**, not an exception. Exceptions are for transport and authorization failures.

```typescript
import { IBANforge } from '@ibanforge/sdk';

const bad = await new IBANforge().formatIban('CH93007620116238529XX');
console.log(bad.valid);                    // false
console.log(bad.error);                    // 'checksum_failed'
```

## Typed errors

Every failure throws a typed subclass of `IBANforgeError`, carrying `status`, `code` (the API's error slug) and the parsed `body`:

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
| `AuthError` | 401 / 403 | Missing, revoked or mistyped key; mailbox verification required |
| `PaymentRequiredError` | 402 | No key and no credit. `err.accepts` carries the x402 challenge — pay and retry, no dead end |
| `QuotaExhaustedError` | 429 | Monthly free quota spent (the API usually answers 402 instead, so you can pay through) |
| `RateLimitError` | 429 | Too fast — back off |
| `InvalidInputError` | other 4xx | Malformed request (a malformed *IBAN* is a 200, see above) |
| `APIError` | 5xx | Server-side failure — retry with backoff |

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
