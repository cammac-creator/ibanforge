# Security policy

IBANforge validates IBANs and looks up bank identifiers for people who move
money. If you have found a way to make it answer wrongly, leak data, or take
payment for something it did not do, we want to hear about it before anyone
else does.

## Reporting a vulnerability

**Email `security@ibanforge.com`.**

That is the same address published in
[`/.well-known/security.txt`](https://api.ibanforge.com/.well-known/security.txt)
(RFC 9116). `support@ibanforge.com` reaches the same people and is a fine
fallback, but it is a public-facing inbox: prefer the security address for
anything that should not be read by a support agent first.

Please do **not** open a public GitHub issue for a vulnerability. This
repository is public, and an issue is a disclosure.

GitHub's private vulnerability reporting is **not** enabled on this repository
at the time of writing, so email is the channel. If you try the Security tab and
find nothing there, that is why — use the address above.

### What helps

- What you did, in enough detail that we can do it again. A `curl` command is
  worth ten paragraphs.
- What you expected, and what happened instead.
- Which host: `api.ibanforge.com`, `ibanforge.com`, or a published package.
- Whether you needed an API key, a paid call, or nothing at all. "Anonymous and
  free" and "authenticated with my own key" are very different findings.

You do not need a proof-of-concept exploit, a CVSS score, or a formal writeup.
A clear paragraph beats a template.

## What to expect from us

| | Target |
|---|---|
| Acknowledgement that a human read it | **3 working days** |
| First assessment (confirmed / not reproducible / out of scope) | **10 working days** |
| Fix for a confirmed high-severity issue | as fast as we can, and we will tell you the date we are working to |

These are targets, not a contract. IBANforge is run by one person in
Switzerland: if a reply is late, it is late because of that, not because the
report was ignored. A second email is welcome.

We will tell you when the fix ships, and we are happy to credit you by the name
or handle you choose. If you would rather stay anonymous, say so.

## Scope

**In scope**

- `api.ibanforge.com` — the API, including `/v1/*`, the x402 payment path, the
  MCP endpoint, and the free endpoints.
- `ibanforge.com` and `www.ibanforge.com` — the public site and the dashboard.
- The published packages: `ibanforge-mcp` and `@ibanforge/sdk` on npm,
  `ibanforge` on PyPI, `n8n-nodes-ibanforge` on npm, and the MCP Registry entry
  `io.github.cammac-creator/ibanforge`.
- This repository: anything committed here, including workflows and the data in
  `data/`.

**Out of scope**

- Third-party infrastructure we rent rather than run: Railway, Vercel, the x402
  facilitator, the upstream registries (GLEIF, SIX, Bundesbank, EBA, ECB, Bank
  of England, BNB, Banco de España). Report those to their owners; tell us too
  if it affects what we serve.
- Findings that are only a missing hardening header, a TLS configuration
  preference, or the output of a scanner with no demonstrated impact.
- Denial of service by volume, and anything that requires flooding the API.
  Please do not load-test production; ask us instead.
- Social engineering, physical access, and anything aimed at a person rather
  than the service.
- Reports that the data is wrong. A bank missing from a register is a data
  issue, not a vulnerability — open a normal issue, or use the feedback route
  in the API.

## Testing, safely

Testing against production is allowed within the boundaries above, with three
conditions: use your own account and your own API key, stay under a rate that a
normal customer would generate, and never touch another customer's data. If a
finding needs you to cross one of those lines to prove it, stop and describe it
to us instead — we will reproduce it ourselves.

Please do not run automated scanners against `api.ibanforge.com`. They cost us
real money per request and have never yet found anything a careful human did
not.

## Safe harbour

If you follow this policy in good faith, we will not pursue or support any
action against you for your research, and we will treat your report as an
authorised contribution. If a third party takes action against you for work
that stayed inside this policy, tell us and we will make that clear to them.

There is no bug bounty. We cannot pay for reports; we can credit you, and we
will say thank you properly.
