# @ibanforge/sdk

Official TypeScript SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation, BIC/SWIFT lookup, SEPA compliance checks, and risk scoring.

- Zero dependencies (native `fetch`)
- TypeScript-first with full type definitions
- ESM + CJS dual build
- Works in Node.js 18+, Deno, Bun, and modern browsers

## Installation

```bash
npm install @ibanforge/sdk
```

## Quick Start

```typescript
import { IBANforge } from '@ibanforge/sdk';

// With a free API key (200 req/month)
const client = new IBANforge('ifk_your_api_key');

// Without a key (x402 micropayment per request)
const client = new IBANforge();
```

## Usage

### Validate a single IBAN

```typescript
const result = await client.validate('CH9300762011623852957');

console.log(result.valid);        // true
console.log(result.country);      // { code: 'CH', name: 'Switzerland' }
console.log(result.sepa?.member); // true
console.log(result.bic?.code);    // 'UBSWCHZH' (if BIC is found)
```

### Validate a batch (up to 100 IBANs)

```typescript
const batch = await client.validateBatch([
  'CH9300762011623852957',
  'DE89370400440532013000',
  'FR7630006000011234567890189',
]);

console.log(batch.summary); // { total: 3, valid: 3, invalid: 0 }
batch.results.forEach(r => console.log(r.iban, r.valid));
```

### Look up a BIC/SWIFT code

```typescript
const bic = await client.lookupBIC('UBSWCHZH');

console.log(bic.institution); // 'UBS AG'
console.log(bic.city);        // 'ZURICH'
console.log(bic.found);       // true
console.log(bic.lei);         // LEI code if available
```

### Compliance check (sanctions, reachability, VoP, risk score)

```typescript
const check = await client.compliance('DE89370400440532013000');

console.log(check.compliance.risk_level);              // 'low'
console.log(check.compliance.risk_score);              // 12
console.log(check.compliance.sanctions.country_sanctioned); // false
console.log(check.compliance.reachability.sepa_instant);    // true
console.log(check.compliance.vop.status);              // 'active'
```

### Check API key usage

```typescript
const usage = await client.usage();

console.log(usage.used);      // 42
console.log(usage.remaining); // 158
console.log(usage.limit);     // 200
console.log(usage.month);     // '2026-04'
```

## Error Handling

All API errors throw an `IBANforgeError` with `status`, `code`, and `message`:

```typescript
import { IBANforge, IBANforgeError } from '@ibanforge/sdk';

const client = new IBANforge('ifk_your_api_key');

try {
  const result = await client.validate('INVALID_IBAN');
} catch (err) {
  if (err instanceof IBANforgeError) {
    console.error(err.message); // Human-readable message
    console.error(err.status);  // HTTP status code (e.g. 400, 402, 429)
    console.error(err.code);    // Machine-readable code (e.g. 'quota_exceeded')
  }
}
```

Common error codes:
| Code | Status | Meaning |
|------|--------|---------|
| `quota_exceeded` | 429 | Monthly free tier limit reached (200 req/month) |
| `invalid_key` | 401 | API key not found or inactive |
| `payment_required` | 402 | No API key and no x402 payment provided |
| `invalid_input` | 400 | Missing or malformed request body |

## Custom Base URL

For testing against a local instance:

```typescript
const client = new IBANforge('ifk_your_key', {
  baseUrl: 'http://localhost:3000',
});
```

## Get a Free API Key

Get 200 free requests/month at **[ibanforge.com](https://ibanforge.com)**.

For higher volumes, pay per request using [x402](https://x402.org) USDC micropayments — no subscription required.

## Links

- API docs: [ibanforge.com/docs](https://ibanforge.com)
- GitHub: [github.com/cammac-creator/ibanforge](https://github.com/cammac-creator/ibanforge)
- npm: [@ibanforge/sdk](https://www.npmjs.com/package/@ibanforge/sdk)

## License

MIT
