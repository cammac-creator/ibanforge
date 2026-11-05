# IBANforge for Google Sheets

Four custom functions for reviewing IBAN format and available bank references beside your original data. This is an open-source Apps Script installed manually, not a published Google Workspace Marketplace add-on.

| Function | Returns |
|---|---|
| `=IBAN_VALID(A2:A7)` | The API's `valid` value, not proof of account existence |
| `=IBAN_BANK(A2:A7)` | Name associated with the BIC, otherwise the institution from the bank-code check; blank if absent |
| `=IBAN_BIC(A2:A7)` | Resolved BIC, blank if absent |
| `=IBAN_CHECK(A2:A7)` | Five columns: valid, bank, BIC, bank-code status, SEPA |

Aliases: `IBAN_VALIDE`, `IBAN_BANQUE`, `IBAN_CONTROLE` (French), `IBAN_GUELTIG`, `IBAN_BANKNAME`, `IBAN_PRUEFUNG` (German). `IBAN_CHECK` accepts one input column and preserves empty rows. Its compact result omits source dates, `authoritative`, detailed provenance and successor codes. Keep the full API response when those details are needed for a review. No function confirms account ownership or approves a payment.

## Install a test copy

Use a spreadsheet you own and documentation examples first. Follow the [installation and result guide](https://ibanforge.com/blog/2026-09-29-check-iban-list-google-sheets?src=sheets): create `Code.gs`, the HTML file `Sidebar`, and the supplied `appsscript.json` in **Extensions → Apps Script**. Run `ibfShowSidebar`, review the requested permissions and authorize if appropriate. Enter the key in the sidebar, never a cell. Put `=IBAN_CHECK(A2:A7)` in B2 with B2:F7 empty.

The batch route requires an API key. [Key access](https://ibanforge.com/docs/api-keys?src=sheets), [pricing](https://ibanforge.com/pricing?src=sheets), and the usage report describe the effective allowance and paid options. There is no automatic purchase. Installed copies do not update automatically.

## Calls and data

The script removes spaces, uppercases strings, skips empty cells and deduplicates within one execution. It sends cache misses in batches of at most 100 to `POST /v1/iban/batch?source=sheets`, consuming one unit per transmitted IBAN, including invalid ones. The requested cache duration is six hours, but [Google may evict entries sooner](https://developers.google.com/apps-script/reference/cache/cache). Concurrent formulas or later recalculation may consume again. A failed later batch can leave earlier calls consumed; the cache is written only after all batches succeed.

Input strings and the authentication key leave Apps Script for `api.ibanforge.com`; the sidebar also requests key usage. Do not pass names or comments as formula arguments. Calls run on [Google's infrastructure](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app). The manifest scopes are `spreadsheets.currentonly`, `script.container.ui` and `script.external_request`; the declared `urlFetchWhitelist` names the API host.

The key is saved in user properties. [Custom functions read the spreadsheet owner's properties](https://developers.google.com/apps-script/guides/sheets/functions), and editors can modify the bound script. Do not treat this as isolated credentials for collaborators. A custom function must finish within Google's 30-second limit; start with a small range.

## Local logic check

From the repository root, with Node 22 or later:

```bash
CODE_GS=./integrations/sheets/Code.gs node integrations/sheets/test/harness.cjs canned
```

This executes the functions with simulated Apps Script services and fictional responses. It does not prove installation, permissions, recalculation or sharing inside a real Google account. The separate `live` harness mode contacts the public API with a fake key; it is not needed for the local check.

## Download and publication

From the repository root:

```bash
python3 integrations/sheets/export-download.py
```

The exporter builds a deterministic ZIP containing `Code.gs`, `Sidebar.html` and `appsscript.json`. Its filename carries the content hash; recipe and article links in all three languages are updated. Previous archives remain available for cached pages. Inspect the diff, run the repository checks and hand the change to the integrator. The exporter does not deploy or publish anything.

`LISTING.md` contains draft descriptions only. A Marketplace release is a separate task: verify the current Google publication requirements, permissions, account ownership and review outcome. This repository does not establish that an OAuth review is unnecessary or that publication will take a particular time. No Marketplace listing or approval is claimed.
