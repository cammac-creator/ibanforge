# IBANforge for Postman

`ibanforge.postman_collection.json` is generated from the live OpenAPI 3.1 contract
(`https://api.ibanforge.com/openapi.json`, version 1.5.0) with
[openapi-to-postmanv2](https://github.com/postmanlabs/openapi-to-postman): 28 requests in
8 folders (IBAN, BIC, Compliance, Swiss Clearing, API Keys, Credits, MCP, Free).

## Import

Postman → **Import** → drop the JSON file (or paste its raw GitHub URL).

Then set two collection variables:

| Variable | Value |
|---|---|
| `baseUrl` | `https://api.ibanforge.com` (already set) |
| `apiKey` | your `ifk_…` key. Free: 200 requests/month, no card, from [ibanforge.com](https://ibanforge.com?src=postman) or the **API Keys → Generate** request |

Every request inherits `Authorization: Bearer {{apiKey}}` from the collection. The **Free**
folder (payment references, ISO 20022 address check, Swiss QR-bill check, demo, health, OpenAPI)
needs no key at all.

## Regenerate

```bash
curl -s https://api.ibanforge.com/openapi.json -o /tmp/openapi.json
npx -y openapi-to-postmanv2 -s /tmp/openapi.json -o ibanforge.postman_collection.json -p \
  -O folderStrategy=Tags,requestParametersResolution=Example,exampleParametersResolution=Example,includeAuthInfoInExample=false
```

then re-apply the collection-level bearer auth and the `apiKey` variable (the generator does not
emit them). Regenerate after every release that adds or changes an endpoint.

## Publishing on the Postman API Network (maintainer)

The public listing is a manual step on a Postman account (workspace → **Publish** → *Public API
Network*). Fields: name **IBANforge API**, category *Financial services*, summary from the
collection description, links to <https://ibanforge.com/docs> and the OpenAPI URL. Listing only,
no billing goes through Postman.
