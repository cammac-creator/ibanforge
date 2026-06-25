# IBANforge — Custom GPT setup (OpenAI GPT Store)

The OpenAI equivalent of our MCP listing: a **Custom GPT** that calls IBANforge
through an **Action** pointed at the live OpenAPI spec. ChatGPT users can then
validate IBANs, look up BICs, check SEPA/VoP reachability, Swiss clearing and
sanctions/risk — directly in chat.

> Why this and not a ChatGPT plugin? OpenAI **deprecated** the old
> `ai-plugin.json` plugin format; GPTs + Actions replaced it. The OpenAPI spec
> we already serve at `https://api.ibanforge.com/openapi.json` is exactly what
> GPT Actions ingest.

## Prerequisites

- A ChatGPT account that can **create GPTs** (Plus/Team/Enterprise).
- An IBANforge API key (`ifk_...`) for the Action auth — generate one:
  `curl -X POST https://api.ibanforge.com/v1/keys/generate -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'`
  (free tier = 200 req/month; the GPT's traffic bills against this key).
- **To publish publicly** to the GPT Store you also need (not required for
  private/link use):
  - a **privacy policy URL** — ⚠️ currently missing (`ibanforge.com/privacy` →
    404). Add one before publishing publicly.
  - a **verified builder profile** (verify the `ibanforge.com` domain or your
    name in ChatGPT → Settings → Builder profile).

## Create it (≈ 5 min)

1. ChatGPT → left sidebar → **GPTs** → **+ Create** → open the **Configure** tab
   (skip the chat-based builder; paste the fields below directly).
2. Fill **Name**, **Description**, **Instructions**, **Conversation starters**
   from the next section.
3. **Actions** → **Create new action**:
   - **Authentication** → **API Key** → Auth Type **Bearer** → paste your
     `ifk_...` key. (The API also accepts a custom header `X-API-Key`; Bearer is
     simplest and matches the spec's security scheme — both verified working.)
   - **Schema** → **Import from URL** →
     `https://api.ibanforge.com/openapi.json`
     (11 operations, all with `operationId`, servers preset to production).
   - Leave **Privacy policy** blank for private use; required to publish.
4. Test in the preview pane (see "Smoke test" below), then **Create** →
   **Only me** (private) or **Anyone with a link** / **GPT Store** (needs the
   prerequisites above).

## Fields to paste

**Name**
```
IBANforge — IBAN & BIC Verifier
```

**Description**
```
Verify IBANs and BIC/SWIFT codes, check SEPA/VoP reachability, Swiss clearing,
and sanctions/risk before you send funds. Powered by IBANforge (121k+ BICs, 89
countries).
```

**Instructions**
```
You are IBANforge Assistant, a pre-payout verification helper for bank details.
You verify IBANs and BIC/SWIFT codes and surface SEPA/VoP reachability, Swiss
clearing data, and sanctions/risk indicators before money moves. You have
IBANforge Actions connected.

How to act:
- User gives an IBAN → call validateIBAN. Report, in this order: valid or not,
  country, the bank (BIC code + bank name), SEPA membership, and any risk
  indicators.
- User gives a BIC/SWIFT code → call lookupBIC. Report the bank, country, city,
  and the registered address when available (note: address is head-office /
  registered, not per-branch; non-Latin addresses include a Latin reading only
  when one officially exists).
- User asks to "screen", "check sanctions", "is this safe", "compliance" → call
  complianceCheck and report the risk score (0-100) and the contributing
  factors.
- Swiss IBAN/IID clearing, QR-IID, or SIC details → call lookupChClearing.

Rules:
- NEVER invent IBANs, BICs, bank names, or addresses. If the API returns no BIC
  or no address, say so plainly — do not guess or transliterate.
- Path parameters must be real values: never send the literal "{code}" or
  "{iid}".
- Lead with the verdict, then the details. Be concise.
- You are a verification aid, not legal or compliance advice. If asked for a
  definitive sanctions ruling, say a compliance officer must confirm.
```

**Conversation starters**
```
Validate IBAN DE89 3704 0044 0532 0130 00
Look up BIC COBADEFFXXX
Screen this IBAN for sanctions & risk: FR7630006000011234567890189
Is this Swiss IBAN SEPA-reachable? CH9300762011623852957
```

## Smoke test (in the GPT preview)

Ask each and confirm the Action is actually called (you'll see "Talked to
api.ibanforge.com"):

| Prompt | Expect |
|---|---|
| `Validate IBAN DE89370400440532013000` | valid=true, bank = Commerzbank (COBADEFF), SEPA member |
| `Look up BIC ABOCCNBJXXX` | Agricultural Bank of China, Beijing, address incl. romanized line |
| `Screen FR7630006000011234567890189` | a risk score 0-100 + factors |

If the Action returns 401/403, the API key is missing or wrong in the Action
auth. If it returns a `placeholder_literal` error, the GPT sent `{code}` —
reinforce the "real values" rule in Instructions.

## Notes

- The same key meters all GPT traffic; for a public GPT, use a paid key with a
  quota you're comfortable exposing, or expect it to throttle at the free tier.
- Keep this GPT's spec in sync automatically: it imports from the live URL, so a
  redeploy of the API updates the available operations on the GPT's next schema
  refresh.
