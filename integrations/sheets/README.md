# IBANforge for Google Sheets

An Editor add-on: four custom functions that check a column of IBANs against the bank
registers behind `api.ibanforge.com`, on the user's own IBANforge key (free tier: 200
requests a month, no card; then prepaid packs or the Pro plan).

| Function | Returns |
|---|---|
| `=IBAN_VALID(A2:A200)` | TRUE / FALSE, one row per cell |
| `=IBAN_BANK(A2:A200)` | the institution the national register names for the bank code |
| `=IBAN_BIC(A2:A200)` | the BIC the register pairs with the bank code, empty when none |
| `=IBAN_CHECK(A2:A200)` | five columns: valid, bank, BIC, bank-code verdict, SEPA |

Aliases: `IBAN_VALIDE`, `IBAN_BANQUE`, `IBAN_CONTROLE` (French) and `IBAN_GUELTIG`,
`IBAN_BANKNAME`, `IBAN_PRUEFUNG` (German). One code path.

**Billing and privacy.** One request per IBAN, sent in batches of 100 to
`POST /v1/iban/batch` with `?source=sheets`. Results are cached six hours per user
(`CacheService.getUserCache`), so a recalculated sheet does not pay twice. The key is stored in
the user's own script properties, never in the spreadsheet. Nothing leaves the sheet but the IBAN
strings the functions receive. Scopes: `spreadsheets.currentonly`, `script.container.ui`,
`script.external_request`; `urlFetchWhitelist` pins the API host.

## Files

- `appsscript.json`: manifest (scopes, whitelist, V8).
- `Code.gs`: menu, sidebar server side, the four functions, cache and batching.
- `Sidebar.html`: the key screen (test, save, remove, usage line).

## Test without a Google account

The logic runs under Node with the Apps Script services stubbed:

```bash
cd integrations/sheets
CODE_GS=./Code.gs node test/harness.cjs canned   # projections, one batch per recalculation, 3 batches for 230 IBANs, missing key
CODE_GS=./Code.gs node test/harness.cjs live     # a fake key against the real API: request shape and the invalid-key path
```

Last run: 3 September 2026, both modes green.

## Install a development copy (any Google account, five minutes)

```bash
npm i -g @google/clasp
clasp login                                   # browser
cd integrations/sheets
clasp create --type sheets --title "IBANforge"  # creates a bound script + a test spreadsheet
clasp push                                    # uploads the three files
clasp open                                    # opens the script editor; run onOpen once to authorise
```

Then, in the test spreadsheet: **Extensions → IBANforge → Set up API key**, paste a key,
type `=IBAN_CHECK(A2:A20)` next to a column of IBANs.

## Publish on the Google Workspace Marketplace (Claude-Alain, about 1.5 h, one time)

The add-on must belong to a Google Cloud project owned by the publisher's Google account.
Eight steps, nothing to invent, every text is in `LISTING.md` next to this file:

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project** → name
   `ibanforge-sheets` → create. Note the project number (Dashboard).
2. Same project → **APIs & Services → OAuth consent screen** → External → app name
   `IBANforge`, support e-mail, logo `frontend/public/sheets/icon-128.png`, homepage
   `https://ibanforge.com/sheets`, privacy `https://ibanforge.com/legal/privacy`, terms
   `https://ibanforge.com/legal/terms`. Scopes: add the three from `appsscript.json`
   (none is "sensitive" in Google's list, so no security assessment). Publishing status: In production.
3. **APIs & Services → Library** → enable **Google Workspace Marketplace SDK**.
4. In the Apps Script editor of the add-on: **Project settings → Google Cloud Platform project**
   → paste the project number → Set project. Then **Deploy → New deployment → Add-on** →
   description `IBANforge 1.0` → Deploy. Copy the deployment ID.
5. Marketplace SDK → **App Configuration**: Public (or Private for a first test), Sheets add-on,
   script project = the add-on's script ID, deployment = the ID above, version = 1. Save.
6. Marketplace SDK → **Store listing**: paste the texts from `LISTING.md` (EN default, FR and DE
   as additional languages), category *Productivity* (or *Business tools*), icons 32/48/96/128/256
   from `frontend/public/sheets/`, at least one screenshot 1280 × 800 (take it on the test
   spreadsheet with `=IBAN_CHECK` filled), support link `mailto:support@ibanforge.com`.
7. **Publish**. Google reviews (they say "several days", in practice one to two weeks); the
   listing status shows the outcome, and I read it with you.
8. Once listed: I update `https://ibanforge.com/sheets` with the Marketplace link and the
   install path, and the docs recipe.

Until then the code is open source here; anyone can paste it into their own script project
(the page on ibanforge.com says exactly that).
