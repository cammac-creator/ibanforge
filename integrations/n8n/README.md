# n8n-nodes-ibanforge

IBAN validation, BIC/SWIFT lookup, Swiss clearing and compliance pre-checks inside your [n8n](https://n8n.io) workflows — backed by the [IBANforge](https://ibanforge.com?src=n8n) API and its 6 national bank registers (121k+ BIC entries, 89 IBAN countries).

Typical uses: verify supplier IBANs at onboarding, triage a payout list before the batch leaves, enrich a CRM record with the issuing bank, stop payments whose bank code the national register does not know.

## Operations

| Operation | What it does |
|---|---|
| **Validate IBAN** | Structure + checksum + issuing bank (BIC), bank-code check against the national register (`not_in_register` means the register allocates the code to nobody), EMI/vIBAN classification, SEPA + VoP reachability |
| **Look up BIC** | BIC/SWIFT → bank name, city, country, LEI |
| **Look up Swiss clearing** | BC-Nummer / IID → institution, seat address, SIC/euroSIC/instant rails, QR-IID semantics |
| **Compliance check** | Bank-level sanctions (OFAC + EU), FATF lists, SEPA/VoP, 0-100 risk score. Bank-level, not name screening |

## Installation

Community nodes panel: **Settings → Community nodes → Install** → `n8n-nodes-ibanforge`.

Self-hosted CLI:

```bash
npm install n8n-nodes-ibanforge
```

## Credentials

One free API key: 200 requests/month, no card. Get it at [ibanforge.com](https://ibanforge.com?src=n8n) (key dialog) or straight from the API:

```bash
curl -X POST https://api.ibanforge.com/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"email": "you@company.com", "source": "n8n"}'
```

Paste the `ifk_…` key into the node's IBANforge API credentials.

## Honest limits

- The bank-code check tells you what the **national register** says about the code inside the IBAN — it never claims the *account* exists or matches a name (that is Verification of Payee, a regulated-PSP scheme).
- Sanctions screening is **bank-level (BIC8)**, not name-level, and is not a regulated AML/CFT product.
- Full API reference: [ibanforge.com/docs](https://ibanforge.com/docs?src=n8n) · data provenance: [ibanforge.com/docs/data-sources](https://ibanforge.com/docs/data-sources?src=n8n)

## License

[MIT](../../LICENSE)
