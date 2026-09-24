# Where a key comes from

Every IBANforge API key records the door it was minted through, in
`api_keys.source`. This page is the vocabulary: what the values mean, who
writes them, and the two rules that keep them comparable.

The list of record is [`src/lib/key-origins.ts`](../src/lib/key-origins.ts).
Nothing here is a number; this page describes a shape, not a measurement.

## Two kinds of value

**A tag** names one of our own outbound links. It travels as `?src=` in the
address, is captured the moment the visitor arrives
(`frontend/lib/arrival.ts`), is kept for the visit, and is sent with the key
request. A tag says a deliberate effort produced the visit.

| Tag | Where the link lives |
|---|---|
| `github-readme` | the README of the public repository |
| `npm-mcp` | the npm page and README of `ibanforge-mcp` |
| `sdk-ts`, `sdk-py`, `sdk-java`, `sdk-dotnet` | each SDK and its README |
| `n8n` | the n8n community node, its README and its credential help |
| `mcp-registry` | the official MCP registry listing (`server.json`) |
| `smithery` | the Smithery listing (`smithery.yaml`) |
| `glama` | the Glama listing (`glama.json`) |
| `api-trial` | the keyless REST trial, once its weekly allowance is spent |

**A door** is what the server writes when no tag says anything finer: the
surface the key was actually minted on. It is always true and never specific.

| Door | The key was taken |
|---|---|
| `site-signup` | in the key dialog, on a page with no door of its own |
| `site-pricing` | in the key dialog, from the pricing page |
| `site-docs` | in the key dialog, from the documentation |
| `site-dashboard` | in the key dialog, from the dashboard or the account area |
| `web-device` | on the device-grant page, approved by a human in a browser |
| `mcp-device` | through `request_api_key` on the remote MCP server |
| `mcp-stdio-device` | through `request_api_key` on `npx ibanforge-mcp` |
| `api-direct` | by `POST /v1/keys/generate` with no browser and no tag |
| `stripe-pack` | by buying a prepaid credit pack with a card |
| `stripe-subscription` | by subscribing with a card |
| `x402-pack` | by buying a prepaid credit pack with x402 |
| `admin` | by hand, through the admin route or the admin script |

## The two rules

**An origin is never empty.** Not because a full column is tidier, but because
an origin cannot be recovered afterwards: nothing else on the row says which
door a key came through, and guessing it from the tier or the address would
invent a fact. Every mint path writes one at the moment of the mint. A value
sent by a caller that does not match `^[a-z0-9_-]{1,40}$` is replaced by the
door — never refused. Attribution must never be the reason a key is not issued.

**A door ranks below the referring site.** A tag names an effort, a door names
a surface. Since every path writes something, a door placed above the referrer
would swallow every referrer reading the day it shipped. So the channel a
signup is counted under is, in order: the utm campaign, then the tag, then the
referring site, then the door.

## Sending your own

`POST /v1/keys/generate` accepts a `source` field:

```bash
curl -X POST https://api.ibanforge.com/v1/keys/generate \
  -H 'Content-Type: application/json' \
  -d '{"source":"my-integration"}'
```

Any value matching `^[a-z0-9_-]{1,40}$` is stored as sent, lowercased. Compound
names are hyphenated: a colon does not pass, and a value that does not pass is
silently replaced by the door — which looks exactly like the gap this
vocabulary exists to close.
