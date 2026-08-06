# Guide dev.to — prêt à publier (compte cammaccreator)

> **Statut** : rédigé le 11/07/2026, à publier tel quel sur dev.to.
> **Tags suggérés** : `fintech`, `api`, `node`, `payments`
> **Canonical** : aucun (contenu original dev.to). Après publication, croiser le lien depuis /compare si pertinent.

---

# Validating IBANs in production: what a checksum won't catch

*Disclosure up front: I build [IBANforge](https://ibanforge.com), one of the paid APIs mentioned below. The free-library advice is genuine — start there.*

Every few weeks someone ships an IBAN field validated with a regex, and every few weeks a payment bounces three days later. Here is the uncomfortable truth: **IBAN validation is four different problems**, and most integrations only solve the first one.

## Level 1 — Structure and checksum (free, do this locally)

An IBAN has a country-specific length, a country-specific BBAN pattern, and a mod-97 checksum (ISO 13616). You do **not** need an API for this. Use a maintained library:

```bash
npm install ibantools        # TypeScript/JavaScript
pip install schwifty         # Python
# iban4j (Java), IbanNet (.NET), TheIconic/php-iban (PHP)
```

```ts
import { validateIBAN } from "ibantools";

const r = validateIBAN("DE89370400440532013000");
console.log(r.valid); // true
```

This catches typos, transposed digits, wrong lengths. It runs in microseconds, offline, for free. **If this is all you need, stop here.**

But be aware of what it cannot see:

- `DE17ABCDEFGH1234567890` — letters inside Germany's all-numeric bank code field. The mod-97 checksum **passes**. Libraries with per-country BBAN patterns reject it; naive regex + mod-97 implementations don't.
- A structurally perfect IBAN pointing to a **bank that doesn't exist** (closed, merged, or invented).
- A valid IBAN at a bank that **cannot receive** the payment type you're about to send (no SEPA Instant, no SDD).

## Level 2 — Does the bank exist?

The bank code inside the BBAN maps to a real institution — or it doesn't. Checking that requires a directory (SWIFT/BIC data, national registries), which is where APIs come in:

```bash
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ifk_..." \
  -d '{"iban":"CH10 0023 0000 0000 1234 5"}'
```

```json
{
  "iban": "CH1000230000000012345",
  "valid": true,
  "country": { "code": "CH", "name": "Switzerland" },
  "check_digits": "10",
  "bban": { "bank_code": "00230", "account_number": "000000012345" },
  "bic": { "code": "UBSWCHZH80A", "bank_name": "UBS Switzerland AG", "city": "Zürich" },
  "sepa": { "member": true, "schemes": ["SCT", "SDD"], "vop_required": false },
  "clearing": { "iid": "00230", "sic": true, "eurosic": true }
}
```

A structural failure names the exact field instead of a generic "invalid":

```json
{
  "valid": false,
  "error": "invalid_bban_structure",
  "error_detail": "bank_code: expected 8 digits (SWIFT registry pattern 8!n) — got 'ABCDEFGH' at position 4"
}
```

(Free structural endpoints exist too: `GET /v1/demo` shows live examples without a key.)

## Level 3 — Can the bank receive THIS payment? (the VoP angle)

Since **October 2025**, euro-area banks must run Verification of Payee before credit transfers, and the EPC rulebook v1.1 lands on **20 September 2026**. Practical consequence: payments with broken or unknown IBANs now fail loudly at payment time, not silently.

Two things to know:

1. **Real VoP (matching the account holder's name) is a regulated-PSP network.** No API vendor can sell you actual VoP as a simple REST call — anyone claiming otherwise is reselling something else. What you *can* do is pre-check at input time so VoP has nothing to reject: structure, bank existence, rail reachability (`sepa.schemes`, instant participation).
2. **Rail data is country-specific.** For Swiss payments: whether the institution participates in SIC/euroSIC, handles instant payments, and how QR-IIDs (30000–31999) map back to the real clearing number. That data comes from the SIX BankMaster; IBANforge exposes 1,100+ entries of it (as far as I know, the only public API that does).

## Level 4 — Should you send money there at all?

Before a payout run, compliance teams ask different questions: is the **bank** under sanctions (OFAC/EU/UN)? Is the **country** on a FATF list? One call:

```bash
curl -X POST https://api.ibanforge.com/v1/iban/compliance \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ifk_..." \
  -d '{"iban":"RU0204452560040702810412345678901"}'
```

Returns a 0–100 risk score with named flags (`sanctioned_country`, `fatf_suspended`, `high_risk_country`…). Russia currently scores 90/critical — its FATF membership has been suspended since Feb 2023, which some datasets still get wrong.

## What this costs (prices checked July 11, 2026)

| Option | 2,000 validations w/ bank data | Model |
|---|---|---|
| Open-source lib | $0 (no bank data) | your time |
| [IBANforge](https://ibanforge.com/en/compare) | ~$10 one-time | prepaid credits, never expire; free 200/month |
| iban.com | €530/year | annual subscription, 1-year minimum |
| IBANAPI | ≥$40/month tier | monthly sub (bank credits are the limit) |

Full comparison with sources and the "when NOT to use us" list: [ibanforge.com/en/compare](https://ibanforge.com/en/compare).

## Bonus: batch and agents

- **Batch**: `POST /v1/iban/batch` takes up to 100 IBANs per call, billed 1 credit per IBAN (same price as singles — the batch buys you one round-trip, not a discount trick).
- **AI agents**: there's a native MCP server (`npx -y ibanforge-mcp`) and x402 pay-per-call in USDC, so an agent can validate and pay without an account. Machine-readable 402s tell it exactly what to do when a quota runs out.

## TL;DR

1. Structure + checksum → **free library, always**.
2. Bank existence, rails, Swiss clearing → you need directory data (API).
3. Real VoP is a PSP network — pre-check at input time instead, especially before the Sept 2026 rulebook.
4. Sanctions/FATF triage before payouts → one compliance call.

Questions welcome — and if you find a case where the validation disagrees with the SWIFT registry, I genuinely want to hear it: support@ibanforge.com.
