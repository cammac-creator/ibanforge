# IBANforge TypeScript SDK

Official TypeScript SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation & BIC/SWIFT lookup with zero dependencies.

## Install

```bash
npm install ibanforge
```

## Usage

```typescript
import IBANforge from 'ibanforge';

const client = new IBANforge();

// Validate a single IBAN
const result = await client.validateIBAN('CH9300762011623852957');
console.log(result.valid);       // true
console.log(result.formatted);   // 'CH93 0076 2011 6238 5295 7'
console.log(result.bic?.code);   // 'UBSWCHZH80A'

// Validate a batch of IBANs
const batch = await client.validateBatch([
  'CH9300762011623852957',
  'DE89370400440532013000',
  'FR7630006000011234567890189',
]);
console.log(batch.count);        // 3
console.log(batch.valid_count);  // 3
console.log(batch.cost_usdc);    // total cost in USDC

// Lookup a BIC/SWIFT code
const bic = await client.lookupBIC('UBSWCHZH80A');
console.log(bic.found);          // true
console.log(bic.institution);    // 'UBS AG'
console.log(bic.city);           // 'ZURICH'
console.log(bic.lei);            // LEI identifier if available

// Health check
const health = await client.health();
console.log(health.status);      // 'ok'
console.log(health.version);     // API version
```

## Custom base URL

```typescript
const client = new IBANforge({ baseUrl: 'https://api.ibanforge.com' });
```

## Full documentation

[ibanforge.com/docs](https://ibanforge.com/docs)

## License

MIT
