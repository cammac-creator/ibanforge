# @ibanforge/sdk

Official TypeScript/JavaScript SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer clearing, SEPA + VoP reachability and compliance risk scoring. Zero runtime dependencies (uses native `fetch`).

## Install

```bash
npm install @ibanforge/sdk
```

## Quick start

```typescript
import { IBANforge } from '@ibanforge/sdk';

// Free format check — no API key needed
const fmt = await new IBANforge().formatIban('CH9300762011623852957');
console.log(fmt.valid); // true

// Authenticated calls (required for paid endpoints, unless you pay per-call via x402)
const client = new IBANforge({ apiKey: 'ifk_...' });

const r = await client.validateIban('CH1000230000000012345');
console.log(r.valid);            // true
console.log(r.bic?.code);        // 'UBSWCHZH'
console.log(r.bic?.bank_name);   // 'UBS Switzerland AG'
console.log(r.sepa?.member);     // true
console.log(r.clearing?.iid);    // '00230' (Swiss BC-Nummer, CH/LI only)
```

## Get a free key in one line

```typescript
const key = await IBANforge.generateApiKey('you@company.com'); // 200 req/month
const client = new IBANforge({ apiKey: key.api_key });
```

## All methods

```typescript
await client.formatIban(iban);          // FREE — mod-97 + structure only
await client.validateIban(iban);        // full enrichment
await client.validateBatch([...ibans]); // up to 100, $0.002/IBAN
await client.lookupBic('UBSWCHZH80A');  // BIC → bank, country, LEI
await client.lookupChClearing('230');   // Swiss BC-Nummer / IID — full SIX rail participation + QR-IID
await client.checkCompliance(iban);     // sanctions + FATF + SEPA + VoP + risk score
await client.usage();                   // current month quota for your key
await client.health();
```

### Compliance result shape

```typescript
const c = await client.checkCompliance('GB29NWBK60161331926819');
console.log(c.compliance.risk_score);  // 0–100
console.log(c.compliance.risk_level);  // 'low' | 'medium' | 'elevated' | 'high' | 'critical'
console.log(c.compliance.sanctions.matched_lists); // e.g. ['OFAC']
```

> Sanctions screening is at the **bank (BIC8)** level — it does not screen the beneficiary name and is not a regulated AML/CFT product.

## Typed errors

Every failure throws a typed subclass of `IBANforgeError`, so an agent can branch on it:

```typescript
import { IBANforge, PaymentRequiredError, AuthError, RateLimitError } from '@ibanforge/sdk';

try {
  await new IBANforge().validateIban('CH9300762011623852957'); // no key → 402
} catch (err) {
  if (err instanceof PaymentRequiredError) {
    // err.accepts carries the x402 challenge — pay and retry, no dead-end
    console.log(err.accepts);
  } else if (err instanceof AuthError) {
    // bad/expired key
  } else if (err instanceof RateLimitError) {
    // back off
  }
}
```

## Config

```typescript
new IBANforge({
  apiKey: 'ifk_...',                  // optional
  baseUrl: 'https://api.ibanforge.com', // optional override
  timeoutMs: 30_000,                   // optional, default 30s
});
```

## Full documentation

[ibanforge.com/docs](https://ibanforge.com/docs)

## License

MIT
