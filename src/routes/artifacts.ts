import { Hono } from 'hono';
import { RATE_LIMIT } from '../middleware/rate-limit.js';

/**
 * Machine-readable operating artifacts: what an agent is allowed to do without
 * asking, what a call costs, what the limits are, how errors are shaped, and
 * what happens when something is retired.
 *
 * WHY THEY EXIST AS FILES
 *
 * All of this was already true and already written for humans, scattered across
 * the pricing page, the docs and the OpenAPI description. An agent choosing
 * between APIs cannot read a pricing page, and the directories that recommend
 * APIs to agents score exactly these artifacts. Publishing them costs nothing we
 * had not already decided; withholding them costs the recommendation.
 *
 * Everything here MUST stay true. An artifact that overstates the product is
 * worse than a missing one: it is a promise made to a machine that will not
 * read the caveat. Figures that drift (prices, quotas, limits) are interpolated
 * from the same constants the middleware enforces, never retyped.
 */
export const artifacts = new Hono();

const FREE_MONTHLY = 200;
// The guarded value the middleware actually enforces — never a second parse
// of the env var, which could publish "NaN" into a machine-readable contract.
const RATE_PER_MIN = RATE_LIMIT;
const MCP_FREE_DAILY = 10;

// ──────────────────────────────────────────────────────────────────────────────
// Agentic access contract — the one artifact with real operational meaning.
//
// Every paid endpoint here is a read: it screens an IBAN and returns a verdict,
// it moves no money and changes nothing at the bank. Two operations are not
// reads (buying credits, minting a key), and those are the ones an agent should
// not perform unattended. Saying so explicitly is what lets an operator hand an
// agent a key without also handing it a spending mandate.
// ──────────────────────────────────────────────────────────────────────────────
const AGENTIC_ACCESS = `# Agentic access contract — IBANforge
# Which operations an autonomous agent may perform unattended, and which
# require a human decision. Published so an operator can grant scoped
# autonomy instead of all-or-nothing access.
specification: agentic-access
version: '1.0'
provider: IBANforge
updated: '2026-08-14'
base_url: https://api.ibanforge.com

principles:
  - Every screening endpoint is read-only: it returns a verdict about an IBAN
    and never moves money, opens an account, or changes anything at a bank.
  - A verdict is advice, not authorisation. Nothing here clears a payment.
  - The only operations that create an obligation are buying credits and
    minting an API key. Both are marked human-in-the-loop below.
  - No endpoint has an irreversible effect on a third party.

operations:
  acting:
    description: >-
      Safe for an autonomous agent. Read-only, priced per call, no side effect
      beyond usage accounting.
    items:
      - operation: POST /v1/iban/validate
        cost_usd: 0.005
        effect: read
      - operation: POST /v1/iban/batch
        cost_usd: 0.002
        cost_unit: per IBAN, maximum 100 per call
        effect: read
      - operation: GET /v1/bic/{code}
        cost_usd: 0.003
        effect: read
      - operation: GET /v1/ch/clearing/{iid}
        cost_usd: 0.003
        effect: read
      - operation: POST /v1/iban/compliance
        cost_usd: 0.02
        effect: read
      - operation: GET /v1/iban/format
        cost_usd: 0
        effect: read
        note: Free structural pre-flight. Use it to simulate a validation call
          without spending, then pay only for the enrichment you need.
      - operation: GET /v1/iban/structure/{country}
        cost_usd: 0
        effect: read
      - operation: POST /v1/address/check
        cost_usd: 0
        effect: read
        note: Checks an ISO 20022 postal address you have already structured
          against one payment scheme (sps, hvps_plus, fedwire), rule by rule,
          each finding naming the document it comes from. No cbpr+ scheme -
          its rules are not publicly citable.
      - operation: GET /v1/demo
        cost_usd: 0
        effect: read
      - operation: GET /health
        cost_usd: 0
        effect: read
  human_in_the_loop:
    description: >-
      Requires a human decision. These spend money or create a credential.
    items:
      - operation: POST /v1/credits/buy
        reason: Spends real funds. An agent holding a funded wallet must not
          top up its own balance without an explicit mandate.
        effect: payment
      - operation: POST /v1/keys/generate
        reason: Mints a credential bound to an email address.
        effect: credential

payment:
  models:
    - name: x402
      description: Per-call USDC settlement on Base. No account, no signup.
      network: eip155:8453
      discovery: https://api.ibanforge.com/.well-known/x402
    - name: api_key
      description: Bearer key. Free tier ${FREE_MONTHLY} requests/month, or prepaid credits.
  refusal_behaviour: >-
    An unpaid call to a paid endpoint returns 402 with the full payment
    requirements. It never returns a partial or degraded answer, so an agent
    cannot mistake a payment failure for a screening result.

safety:
  data_sent: An IBAN, or a BIC, or a Swiss clearing number. Nothing else is required.
  retention: See https://ibanforge.com/en/legal/dpa
  reversibility: All acting operations are reversible by doing nothing; they change no state.
`;

// ──────────────────────────────────────────────────────────────────────────────
// Rate limits. The numbers are read from the same environment the middleware
// enforces, so this file cannot drift away from behaviour.
// ──────────────────────────────────────────────────────────────────────────────
const RATE_LIMITS = `# Rate limits — IBANforge
specification: rate-limits
version: '1.0'
updated: '2026-08-14'

default:
  requests: ${RATE_PER_MIN}
  window: 1 minute
  scope: per client IP
  applies_to: every endpoint except the exemptions below

exemptions:
  - /health
  - /ping
  - /stats
  - /openapi.json
  - /v1/demo

quotas:
  free_tier:
    requests: ${FREE_MONTHLY}
    window: 1 month
    scope: per API key
  mcp_anonymous:
    requests: ${MCP_FREE_DAILY}
    window: 1 day
    scope: per client IP
    note: Full paid responses over the HTTP MCP transport with no key and no wallet.
  prepaid_credits:
    note: One credit per validation or lookup; batch validation debits one credit
      per IBAN. No expiry.
  x402:
    note: Per-call settlement is not rate-limited by quota, only by the default
      per-minute limit.

signalling:
  headers:
    # IETF draft spelling, the one standard-aware clients read.
    - name: RateLimit-Limit
      description: Requests permitted in the current window.
    - name: RateLimit-Remaining
      description: Requests left in the current window.
    - name: RateLimit-Reset
      description: Seconds until the window resets (delta-seconds).
    # Legacy spelling, kept because existing clients read it.
    - name: X-RateLimit-Limit
    - name: X-RateLimit-Remaining
    - name: X-RateLimit-Reset
      description: Unix timestamp of the reset, not delta-seconds.
    - name: Retry-After
      description: Sent with 429 only. Seconds to wait before retrying.
  exhausted:
    status: 429
    body: '{ "error": "rate_limit_exceeded", "message": "..." }'
    guidance: Retry after the number of seconds in Retry-After. Retrying sooner
      does not shorten the window.
`;

// ──────────────────────────────────────────────────────────────────────────────
// Error semantics. Stable codes are the difference between an agent that can
// branch on a failure and one that has to parse prose.
// ──────────────────────────────────────────────────────────────────────────────
const ERROR_SEMANTICS = `# Error semantics — IBANforge
# Stable machine-readable failure codes. The 'error' field is the contract:
# it is a stable identifier, never localised and never reworded. 'message' is
# for humans and may change at any time.
specification: error-semantics
version: '1.0'
updated: '2026-08-14'

shape:
  content_type: application/json
  fields:
    error: Stable snake_case identifier. Branch on this.
    message: Human-readable explanation. Do not branch on this.
    error_detail: Present on validation failures, naming the specific rule.

principle: >-
  An invalid IBAN is a successful call, not an error. It answers 200 with
  valid:false and an error_detail naming the rule that failed, because a
  screening API that returns HTTP errors for the thing it was asked to detect
  cannot be distinguished from one that is broken.

codes:
  - code: invalid_json
    status: 400
    retryable: false
    meaning: The request body was not valid JSON.
  - code: invalid_request
    status: 400
    retryable: false
    meaning: The body parsed but a required field is missing or malformed.
  - code: placeholder_literal
    status: 400
    retryable: false
    meaning: A path parameter was sent as the literal '{code}' or '{iid}' copied
      from the OpenAPI spec instead of being substituted.
  - code: unauthorized
    status: 401
    retryable: false
    meaning: The API key is missing, malformed, or revoked.
  - code: quota_exceeded
    status: 402
    retryable: false
    meaning: The key's monthly allowance or credit balance is spent. Buy credits
      or wait for the reset.
  - code: payment_required
    status: 402
    retryable: true
    meaning: An x402-payable endpoint called without payment. The body carries the
      full payment requirements (x402 v2), and so does the PAYMENT-REQUIRED
      response header; retry with a PAYMENT-SIGNATURE header. A v1 X-PAYMENT
      signature is still accepted. When a payment WAS sent and refused, the
      reason is in payment_error.
  - code: not_found
    status: 404
    retryable: false
    meaning: The BIC or clearing number is not in the reference data. This is an
      answer about the identifier, not a fault.
  - code: rate_limit_exceeded
    status: 429
    retryable: true
    meaning: Too many requests in the window. Honour Retry-After.
  - code: internal_error
    status: 500
    retryable: true
    meaning: Our fault. Safe to retry: every paid endpoint is read-only, so a
      retry cannot double-charge a side effect.

idempotency:
  natural: >-
    Every screening endpoint is a pure read. Calling it twice with the same body
    returns the same verdict and creates nothing, so retries are always safe and
    need no deduplication key.
  header: Idempotency-Key
  behaviour: >-
    Accepted on every POST and echoed back on the response, so a client's own
    retry bookkeeping works unchanged. It is not needed for correctness here and
    is not required.
  exception: >-
    POST /v1/credits/buy settles a payment and is the one operation where a
    repeat is not free. It is guarded by the payment rail itself: an x402
    settlement or a Stripe payment intent can only be redeemed once.
`;

// ──────────────────────────────────────────────────────────────────────────────
// Commercial artifacts.
// ──────────────────────────────────────────────────────────────────────────────
const PLANS = `# Plans — IBANforge
specification: plans
version: '1.0'
updated: '2026-08-14'
currency: USD
human_url: https://ibanforge.com/pricing

plans:
  - name: Free
    price: 0
    included_requests: ${FREE_MONTHLY}
    period: month
    signup: Email address, no card.
    limits: Same per-minute rate limit as every other plan.
  - name: Pay per call (x402)
    price: metered
    signup: None. No account, no card, no email.
    settlement: USDC on Base (eip155:8453)
    unit_prices:
      iban_validate: 0.005
      iban_batch_per_iban: 0.002
      bic_lookup: 0.003
      ch_clearing_lookup: 0.003
      iban_compliance: 0.02
  - name: Prepaid credits
    price: bundle
    signup: One payment, card or USDC. Returns an API key.
    bundles:
      - credits: 1000
        price: 5
        per_credit: 0.005
      - credits: 5000
        price: 20
        per_credit: 0.004
      - credits: 25000
        price: 80
        per_credit: 0.0032
    expiry: none
    note: One credit per validation or lookup; batch validation debits one
      credit per IBAN.

free_forever:
  - GET /v1/iban/format
  - GET /v1/iban/structure/{country}
  - POST /v1/address/check
  - GET /v1/demo
  - GET /health
  - GET /stats
`;

const FINOPS = `# FinOps — IBANforge
# What a call costs a customer, and how to keep that predictable.
specification: finops
version: '1.0'
updated: '2026-08-14'
currency: USD

cost_model: per call, no subscription, no minimum, no seat licence.

controls:
  - control: Free structural pre-flight
    how: GET /v1/iban/format costs nothing and rejects malformed input before you
      pay for enrichment.
  - control: Batch pricing
    how: POST /v1/iban/batch is 0.002 per IBAN against 0.005 for single calls,
      capped at 0.20 for a batch of 100, and settles once instead of N times.
  - control: Prepaid bundles
    how: Down to 0.0032 per credit at the largest bundle. No expiry, so unused
      credit is not lost spend.
  - control: Enrichment included
    how: Swiss clearing data, UK modulus checking, issuer classification, SEPA and
      VoP reachability are returned inside the validation call. There is no
      second call to pay for.

cost_visibility:
  per_response_field: cost_usdc
  description: Every paid response states what that call cost, so spend can be
    reconciled from the responses alone without a billing export.
  usage_endpoint: GET /v1/keys/usage
`;

const DEPRECATION_POLICY = `# Deprecation and versioning policy — IBANforge

**Updated:** 2026-08-14

## Versioning

The API is versioned in the path (\`/v1/\`). Anything served under \`/v1/\` keeps
its contract for as long as \`/v1/\` exists.

## What counts as a breaking change

Removing a field, renaming a field, changing a field's type, removing an
endpoint, adding a required request field, or changing the meaning of an
existing value. Any of these means a new path version.

## What is not breaking, and may ship at any time

Adding a new optional response field, adding a new endpoint, adding a new
enum member to a field already documented as extensible, improving the
underlying reference data, or making an error message clearer while keeping
its \`error\` code identical.

Clients must therefore tolerate unknown fields. A response parser that
rejects fields it does not recognise will break on a non-breaking change.

## Notice period

A breaking change to a published endpoint gets **at least 90 days** of notice
before the old behaviour stops. During that period both versions are served.

Notice is given on the changelog, in the OpenAPI description of the affected
operation, and by email to every API key holder who has called the affected
endpoint in the previous 90 days.

## Deprecation signalling

A deprecated endpoint answers with the standard headers:

- \`Deprecation\` — the date the endpoint was declared deprecated (RFC 9745)
- \`Sunset\` — the date it stops answering (RFC 8594)
- \`Link\` with \`rel="deprecation"\` — the changelog entry explaining the move

## Reference data

Reference data is refreshed on a schedule, not versioned: a bank that closes
disappears from the next refresh. Every response that depends on it carries an
\`as_of\` date so a caller can see how fresh the answer is. This is a data
change, not an API change, and it is not subject to the notice period.

## Retirement of the API

Should IBANforge stop operating, \`/v1/\` would be served read-only for
**180 days** from the announcement, and the open-source validation core
([MIT](https://github.com/cammac-creator/ibanforge)) would remain published so
that no integration is left without a path forward.

## Contact

security@ibanforge.com for vulnerability disclosure, support@ibanforge.com for
everything else.
`;

const AUTH = `# Authentication — IBANforge

**Updated:** 2026-08-14

There are three ways to call a paid endpoint, and an agent can use any of them
without a human being present for the first two.

## 1. No authentication at all — x402

Call the endpoint. It answers \`402\` with the payment requirements: price,
\`payTo\` address, asset, network, and the output schema. Pay, retry with the
\`PAYMENT-SIGNATURE\` header, get the answer. The requirements are x402 v2 and
travel both in the body and, base64 encoded, in the \`PAYMENT-REQUIRED\`
response header. A v1 \`X-PAYMENT\` signature is still accepted.

- Discovery document: \`https://api.ibanforge.com/.well-known/x402\`
- Network: Base (\`eip155:8453\`), asset USDC
- No account, no email, no card, no key.

## 2. Bearer API key

\`\`\`
Authorization: Bearer ifk_xxxxxxxx
\`\`\`

- Free tier: ${FREE_MONTHLY} requests per month against an emailed key.
- Prepaid credits: one payment, one key, no expiry.
- Mint one: \`POST /v1/keys/generate\` with an email address.
- Check remaining allowance: \`GET /v1/keys/usage\`.

The key goes in the \`Authorization\` header only. It is never accepted in a
query string, so it cannot end up in a proxy log or a browser history.

## 3. MCP, anonymous

The HTTP MCP transport at \`https://api.ibanforge.com/mcp\` answers
${MCP_FREE_DAILY} full tool calls per IP per day with no key and no wallet, so
an agent can evaluate the API before anyone signs anything.

## Failure modes

| Situation | Status | \`error\` |
|---|---|---|
| No credential on a paid endpoint | 402 | \`payment_required\` |
| Key missing, malformed or revoked | 401 | \`unauthorized\` |
| Allowance or credits spent | 402 | \`quota_exceeded\` |

A failed payment never returns a partial answer, so a payment problem can
never be mistaken for a screening result.

## Transport

HTTPS only. HTTP is redirected, never served.
`;

const SKILLS_INDEX = `# Agent skills — IBANforge
specification: skills
version: '1.0'
updated: '2026-08-14'

skills:
  - id: screen-iban-before-payout
    name: Screen an IBAN before releasing a payout
    url: https://api.ibanforge.com/skills/screen-iban-before-payout.md
    description: Decide whether a bank destination is safe to pay, and say why
      when it is not.
  - id: resolve-bank-from-identifier
    name: Resolve a bank from a BIC or a national clearing number
    url: https://api.ibanforge.com/skills/resolve-bank-from-identifier.md
    description: Turn an identifier into the institution that holds it, with the
      register that says so.
`;

const SKILL_SCREEN = `# Skill: screen an IBAN before releasing a payout

**When to use this.** A payout, a refund, a supplier payment or a new
beneficiary is about to be created and you hold an IBAN. You want to know
whether the destination can exist before money moves.

**When NOT to use this.** This does not confirm the account is open, name its
holder, or perform Verification of Payee. It tells you whether the destination
is possible and how risky it is. Account ownership needs SEPA VoP itself or an
open-banking provider.

## One call

\`\`\`bash
curl -s -X POST https://api.ibanforge.com/v1/iban/validate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ifk_YOUR_KEY" \\
  -d '{"iban":"GB29NWBK60161331926819"}'
\`\`\`

Cost: 0.005 USD. Free structural pre-check first: \`GET /v1/iban/format?iban=...\`

## How to read the answer

Read these fields in this order. Stop at the first one that blocks.

1. **\`next_steps\`** — already ordered, blocking first, each with the field that
   justifies it. If you only read one thing, read this.
2. **\`valid\`** — false means the IBAN is malformed. Nothing else applies.
3. **\`bank_code_check.status\`** — \`not_in_register\` **with
   \`authoritative: true\`** is the only case where absence proves the bank code
   is allocated to nobody. Anywhere else, absence means we could not confirm it,
   not that it is wrong.
4. **\`modulus_check.passed\`** (GB only) — false means the sort code and account
   number cannot be a real pair, even though the IBAN itself is well-formed.
   \`checked: false\` means no check was possible, which is not a failure.
5. **\`issuer.classification\`** — \`curated\` is an identification; \`default\`
   means we fell back to "bank" without support for it. Count only \`curated\`
   when sizing exposure to virtual IBANs.
6. **\`sepa.vop_participant\`** — whether the bank answers Verification of Payee.

## The mistake to avoid

Treating a null or absent field as a denial. Null means "no substantiated
answer", never "no". The fields that carry a denial say so explicitly through
\`bank_code_check.authoritative\` or \`modulus_check.passed: false\`.
`;

const SKILL_RESOLVE = `# Skill: resolve a bank from a BIC or a national clearing number

**When to use this.** You hold an identifier rather than an IBAN and need the
institution behind it: reconciling a statement, routing a payment, or checking
that a counterparty is who they claim.

## BIC or SWIFT code

\`\`\`bash
curl -s https://api.ibanforge.com/v1/bic/UBSWCHZH80A \\
  -H "Authorization: Bearer ifk_YOUR_KEY"
\`\`\`

Cost: 0.003 USD. Substitute the code into the path — sending the literal
\`{code}\` returns 400 with \`error: "placeholder_literal"\`.

## Swiss BC-Nummer / IID

\`\`\`bash
curl -s https://api.ibanforge.com/v1/ch/clearing/230 \\
  -H "Authorization: Bearer ifk_YOUR_KEY"
\`\`\`

Cost: 0.003 USD. Accepts the short form or the five-digit padded form, and
follows concatenation redirects when institutions merge. Returns rail-level
participation (SIC, euroSIC, instant payments, LSV) and the QR-IID allocation,
not just a name.

## Do not pay twice

Validating a CH or LI IBAN **already returns** the full clearing block inside
the 0.005 validation. Only call the clearing endpoint when you hold a clearing
number and no IBAN.

## What an absence means

A 404 is an answer about the identifier, not a fault. Read
\`bank_code_check.authoritative\` on the validation path to tell "not allocated"
from "absent from our reference data".
`;

// ──────────────────────────────────────────────────────────────────────────────
// Governance. Published because a ruleset nobody can read is a claim; this one
// runs in CI on every push, against the document regenerated from source rather
// than a checked-in copy that could drift.
// ──────────────────────────────────────────────────────────────────────────────
const RULES = `# Contract governance — IBANforge
specification: rules
version: '1.0'
updated: '2026-08-14'

linter: spectral
ruleset: https://github.com/cammac-creator/ibanforge/blob/main/.spectral.yaml
extends: spectral:oas
enforcement:
  where: CI, on every push and pull request to main
  workflow: https://github.com/cammac-creator/ibanforge/blob/main/.github/workflows/ci.yml
  target: >-
    The OpenAPI document regenerated from source at lint time, not a committed
    copy. The document is built from code so it cannot drift from the deployed
    server; the cost is that only a regenerated copy is worth linting.
  on_failure: The build fails. A contract that breaks the ruleset does not ship.
  current_status: passing, zero findings

house_rules:
  - id: ibanforge-operation-security
    severity: error
    rule: Every operation declares 'security', and a free endpoint declares the
      empty array rather than omitting the field.
    why: Omitting it and meaning "free" are indistinguishable to a machine. This
      API accepts two very different credentials, and an agent that cannot see
      which applies discovers it by being rejected.
  - id: ibanforge-success-schema
    severity: error
    rule: Every 2xx JSON response describes its body.
    why: A 200 with no schema tells a code generator nothing.
  - id: ibanforge-documents-failure
    severity: error
    rule: Every operation documents at least one non-2xx response, and only ones
      it can actually return.
    why: Failure modes are part of the contract. Endpoints exempt from the rate
      limiter do not claim a 429 they cannot produce.
  - id: operation-description / operation-operationId / operation-tags
    severity: error
    rule: Standard OpenAPI hygiene, raised from warning to error.
    why: An agent picks an operation from its description; a generator names the
      method from its operationId.

versioning: https://api.ibanforge.com/deprecation-policy.md
`;

const CONFORMANCE = `# Conformance — IBANforge
# The specifications this API implements, and how to verify each claim
# yourself. Every entry below is checkable from outside.
specification: conformance
version: '1.0'
updated: '2026-08-14'

standards:
  - name: OpenAPI
    version: '3.1.0'
    verify: https://api.ibanforge.com/openapi.json
  - name: ISO 13616 (IBAN)
    role: The validation the API performs.
    verify: https://api.ibanforge.com/v1/iban/structure
  - name: ISO 9362 (BIC)
    role: BIC format validation and lookup.
  - name: Model Context Protocol
    transport: Streamable HTTP
    verify: https://api.ibanforge.com/mcp
    note: A sessionless GET answers 405 with an Allow header, per the transport spec.
  - name: A2A agent card
    verify: https://api.ibanforge.com/.well-known/agent-card.json
  - name: x402
    network: eip155:8453
    verify: https://api.ibanforge.com/.well-known/x402
  - name: apis.json
    version: '0.21'
    verify: https://api.ibanforge.com/apis.json
  - name: RFC 9727 (api-catalog)
    verify: https://api.ibanforge.com/.well-known/api-catalog
  - name: RFC 9116 (security.txt)
    verify: https://api.ibanforge.com/.well-known/security.txt
  - name: RFC 8594 (Sunset header) and RFC 9745 (Deprecation header)
    role: How a retiring endpoint announces itself.
    note: Committed to in the deprecation policy. No endpoint is deprecated today,
      so no live example exists to point at.
  - name: IETF RateLimit header fields
    verify: Any response carries RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset.

data_provenance:
  principle: >-
    Every claim about an institution names the register it came from and the day
    that register was read, in the response itself. Where no register backs an
    answer, the field says so rather than guessing.
  fields:
    - bank_code_check.register and bank_code_check.as_of
    - bank_code_check.authoritative, which alone licenses reading an absence as
      "allocated to nobody"
    - modulus_check.source and modulus_check.as_of
    - issuer.classification, which separates an identification from a fallback

not_claimed:
  - PCI DSS, SOC 2 or ISO 27001 certification. None held.
  - Account ownership verification, Verification of Payee execution, or KYC.
    We report whether a bank participates in VoP; we do not run the name check.
  - Regulated AML/CFT screening. Sanctions screening here is at bank level.
`;

const ROADMAP = `# Roadmap — IBANforge

**Updated:** 2026-08-14

Published so an integrator can see where the coverage is going before committing.
Dates are intentions, not commitments; anything that would break \`/v1/\` follows
the [deprecation policy](https://api.ibanforge.com/deprecation-policy.md).

## Shipped recently

- **UK modulus checking** — validating a GB IBAN now also runs the Vocalink
  checksum over the sort code and account number it carries, in the same call.
- **National bank-code registers** — CH, LI, DE, AT, BE, BG, SK and FI answered
  from the register that allocates the codes, which is what lets an absence mean
  the code is allocated to nobody.
- **Verification of Payee readiness** at bank level, alongside the country-level
  obligation.
- **MCP over HTTP**, anonymous tier included.

## In progress

- Broader national register coverage, prioritised by where an absence can be
  turned into a real denial rather than an "unavailable".
- Beneficiary address data where a register publishes it.

## Not planned

- Account ownership verification or KYC. That is a regulated activity and a
  different product; use SEPA VoP or an open-banking aggregator.
- Non-IBAN rails: US ABA, BSB, PIX.
- A UK sort-code directory. We run the modulus checksum on IBANs we already
  validate; we do not resell the UK directory.
`;

// ──────────────────────────────────────────────────────────────────────────────
// Routes. Several spellings of each path, because directory crawlers disagree
// about which one they request and a 404 is scored as "absent" rather than
// "asked for the wrong URL".
// ──────────────────────────────────────────────────────────────────────────────
const YAML_FILES: Record<string, string> = {
  'agentic-access': AGENTIC_ACCESS,
  'rate-limits': RATE_LIMITS,
  'error-semantics': ERROR_SEMANTICS,
  plans: PLANS,
  finops: FINOPS,
  rules: RULES,
  conformance: CONFORMANCE,
  'skills/index': SKILLS_INDEX,
};

const MD_FILES: Record<string, string> = {
  'deprecation-policy': DEPRECATION_POLICY,
  auth: AUTH,
  roadmap: ROADMAP,
  'skills/screen-iban-before-payout': SKILL_SCREEN,
  'skills/resolve-bank-from-identifier': SKILL_RESOLVE,
};

function serve(path: string, body: string, contentType: string): void {
  artifacts.get(path, (c) => {
    c.header('Content-Type', `${contentType}; charset=utf-8`);
    // These change only when we change them, and a crawler that re-reads them
    // hourly is paying for nothing.
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(body);
  });
}

for (const [name, body] of Object.entries(YAML_FILES)) {
  for (const path of [`/${name}.yml`, `/${name}.yaml`, `/.well-known/${name}.yml`]) {
    serve(path, body, 'application/yaml');
  }
}

for (const [name, body] of Object.entries(MD_FILES)) {
  for (const path of [`/${name}.md`, `/.well-known/${name}.md`]) {
    serve(path, body, 'text/markdown');
  }
}
