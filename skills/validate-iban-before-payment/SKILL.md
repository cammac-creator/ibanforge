---
name: validate-iban-before-payment
description: Validate an IBAN and identify its bank with the IBANforge REST API before money is sent to it, or before it is saved as the bank details of a supplier, customer or employee. Use when writing code that pays out to an IBAN, onboards a payee, imports bank details from a form or a CSV file, or needs the bank name, the BIC or the SEPA reachability behind an IBAN. Covers the keyless trial for development, the free API key for production, how to read the answer, what 402 and 429 mean, and the limit of the check, which never verifies the account holder's name.
license: MIT
---

# Validate an IBAN before a payment

IBANforge checks the structure and the check digits of an IBAN and names the bank behind it, with its BIC and the source of that answer.
Where it reads the national register, it also says whether the bank code is allocated at all.
For a SEPA bank it resolves, it gives the SEPA schemes that reach it and whether the EPC Verification of Payee (VoP) register lists the bank as ready.

## When to use it

- Before a payout, a refund or a supplier payment to an IBAN that has not been paid before.
- When a supplier, customer or employee record receives new bank details: a form, a CSV import, an ERP migration.
- When the code needs the bank name, the BIC or the SEPA reachability behind an IBAN.

Call the API from the server.
Its CORS policy answers only IBANforge's own origins, so a browser on another site cannot read the response, and a key placed in browser code is public anyway.

## 1. Try it without a key (development)

```bash
curl -s -X POST https://api.ibanforge.com/v1/iban/validate \
  -H 'Content-Type: application/json' \
  -d '{"iban":"DE89370400440532013000"}'
```

The keyless trial serves 25 validations a week per source address (IPv6 counted per /64), on this route only.
The week is the ISO week in UTC, reset on Monday 00:00 UTC.
The answer carries a `trial` block with `calls_left_this_week` and `resets_at`.

The trial is for trying the API, not for production: every call from one server draws on the same address, and once it is spent the route answers `402` until the reset.
Send a real IBAN: an empty `{}` body is the x402 discovery probe and always answers `402`.

## 2. Production: a free API key

```bash
curl -s -X POST https://api.ibanforge.com/v1/keys/generate \
  -H 'Content-Type: application/json' \
  -d '{"source":"skill"}'
```

No e-mail and no card are needed.
The `api_key` in the answer (`ifk_` and 64 hexadecimal characters) is shown once: store it as a server-side secret.
The `source` field only records where the key came from; the call works without a body.

After the key has served one call, it can be claimed with a 6-digit code mailed to an address the user chooses (`POST /v1/keys/claim`, the key in the `Authorization` header, never in the body).
Claimed, the same key reaches 200 requests a month, on every endpoint.
Never send an e-mail address the user has not given for this purpose.
Steps and answers: https://ibanforge.com/docs/api-keys?src=skill

Every call then carries the key:

```bash
curl -s -X POST https://api.ibanforge.com/v1/iban/validate \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $IBANFORGE_API_KEY" \
  -d '{"iban":"CH9300762011623852957"}'
```

`X-API-Key: ifk_...` works too.
To check up to 100 IBANs in one call, use `POST /v1/iban/batch` with `{"ibans": ["...", "..."]}`.
The keyless trial does not cover the batch route, and each IBAN in a batch uses one request or credit of the key.

## 3. Read the answer

Read the HTTP status first, then these fields in this order, and stop at the first one that blocks the payment.

1. **The HTTP status.** Only a `200` carries a verdict on the IBAN. A `402` or a `429` has no `valid` field: never read it as an invalid IBAN (see the errors below).
2. **`valid`.** `false` means the IBAN is malformed or its check digits fail. `error` (`checksum_failed`, `wrong_length`, `invalid_format`, ...) and `error_detail` say why. Do not pay: ask for the IBAN again.
3. **`next_steps`.** Machine-readable follow-ups, each with the reason it is suggested.
4. **`bank_code_check`.** `status: "not_in_register"` with `reason: "not_allocated"` and `authoritative: true` is the only answer that says no bank holds this code: stop the payment. Anywhere else, an absence means the code could not be confirmed, not that it is wrong.
5. **`bic`.** `bank_name`, `code` and `bic8`. Compare a BIC the payee gave you on `bic8`. `bic.authoritative: true` means the national register publishes this BIC for this bank code; otherwise treat the BIC as advisory.
6. **`sepa`.** `schemes` lists the SEPA schemes that reach the bank (`SCT`, `SCT_INST`, `SDD`). `vop_participant` says whether the EPC VoP register lists the bank as ready; `false` proves nothing, since a bank absent from that register reads `false` too.
7. **`issuer`.** A `type` of `emi`, `digital_bank` or `payment_institution` makes a virtual IBAN more likely. Count it only when `classification` is `curated` or `register` (the issuer was identified by a curated list or by the EBA PSD2 register).

A `null` or absent field means "no substantiated answer", never "no".

## 4. Errors

| Status | Meaning | What to do |
|---|---|---|
| `200` with `valid: false` | The IBAN itself is wrong | Show `error_detail` and do not pay |
| `400` | Malformed request: `invalid_json`, or `invalid_request` when the `iban` field is missing or empty | Fix the request body |
| `402` | No usable way to pay for this call: it needs a key, credits or an x402 payment. A keyless call outside `POST /v1/iban/validate` gets a `402` without `cause`. When `cause.reason` is present, it says which: `trial_exhausted` (the keyless trial is spent for this address until the reset), `trial_unavailable` (the trial counter could not be read: retry later), `monthly_quota_exhausted` or `credits_exhausted` (the key's allowance or credits are spent), `monthly_quota_insufficient` or `credits_insufficient` (a batch larger than what is left is refused whole: send a smaller batch), `invalid_api_key` (unknown or revoked key), `key_revoked_burst` (an anonymous key, created without an e-mail, cut by abuse protection: create a new key). The body is the x402 payment envelope and has no `valid` field | Treat the IBAN as "not checked", never as "invalid": queue the check, alert the operator, or send a key |
| `429` | Too many requests in one minute from the same IP address (100 by default). On `POST /v1/keys/generate`, `key_creation_limit` means too many keys created from this network today: waiting a few seconds will not help | Wait the number of seconds in `Retry-After`, then retry; for `key_creation_limit`, reuse the key you already have |

## 5. What it cannot tell you

- It never checks the account holder's name. That is Verification of Payee, Confirmation of Payee or a similar service, run by the payee's bank: a valid IBAN at a real bank can still belong to someone else.
- It does not prove that the account exists or is open.
- It is not a sanctions screening of the payee: the compliance endpoint screens the bank and the country only.

## Documentation

- Validate an IBAN: https://ibanforge.com/docs/iban-validate?src=skill
- Batch validation: https://ibanforge.com/docs/iban-batch?src=skill
- Errors: https://ibanforge.com/docs/errors?src=skill
- API keys: https://ibanforge.com/docs/api-keys?src=skill
- OpenAPI 3.1: https://api.ibanforge.com/openapi.json
