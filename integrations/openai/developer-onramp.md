# Use IBANforge from OpenAI agents

Two live, free ways to call IBANforge from the OpenAI ecosystem — **no Custom GPT
and no ChatGPT Plus required**. This is the OpenAI counterpart of our MCP listing,
aimed at the people who actually buy API access: developers building agents.

- **MCP** (`https://api.ibanforge.com/mcp`) — OpenAI's **Agents SDK** connects to
  it natively; the 5 tools below are auto-discovered.
- **OpenAPI / function-calling** (`https://api.ibanforge.com/openapi.json`) — for
  the Chat Completions / Responses APIs when you wire tools yourself.

**Auth:** pass an IBANforge key as `Authorization: Bearer ifk_...` (or header
`X-API-Key: ifk_...`). Free tier = 200 requests/month. Get one:

```bash
curl -X POST https://api.ibanforge.com/v1/keys/generate \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'
```

The MCP server exposes **5 tools** (verified live): `validate_iban`,
`batch_validate_iban`, `lookup_bic`, `check_compliance`, `lookup_ch_clearing`.

---

## 1. OpenAI Agents SDK (via MCP) — recommended

The Agents SDK speaks MCP, so you connect the server and the tools appear on the
agent automatically.

```bash
pip install openai-agents
```

```python
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

IBF_KEY = "ifk_..."  # your IBANforge key

async def main():
    async with MCPServerStreamableHttp(
        name="IBANforge",
        params={
            "url": "https://api.ibanforge.com/mcp",
            "headers": {"Authorization": f"Bearer {IBF_KEY}"},
        },
    ) as ibanforge:
        agent = Agent(
            name="Payments checker",
            instructions=(
                "Vet a counterparty's bank details before a payout. Use the "
                "IBANforge tools to validate IBANs, look up BICs, check SEPA "
                "reachability and sanctions/risk. Never invent bank data."
            ),
            mcp_servers=[ibanforge],
        )
        result = await Runner.run(
            agent, "Validate IBAN DE89370400440532013000 — is it valid and which bank?"
        )
        print(result.final_output)

asyncio.run(main())
```

## 2. Function-calling (Chat Completions) — when you wire tools yourself

Define the tool, let the model decide to call it, run it against IBANforge, feed
the JSON back. (Same pattern works with the Responses API and with the JS SDK.)

```bash
pip install openai requests
```

```python
import json, requests
from openai import OpenAI

client = OpenAI()                 # uses OPENAI_API_KEY
IBF_KEY = "ifk_..."               # your IBANforge key

tools = [{
    "type": "function",
    "function": {
        "name": "validate_iban",
        "description": "Validate an IBAN; returns validity, country, bank (BIC + name), "
                       "SEPA reachability and risk indicators.",
        "parameters": {
            "type": "object",
            "properties": {"iban": {"type": "string", "description": "IBAN to validate"}},
            "required": ["iban"],
        },
    },
}]

def validate_iban(iban: str) -> dict:
    r = requests.post(
        "https://api.ibanforge.com/v1/iban/validate",
        headers={"Authorization": f"Bearer {IBF_KEY}"},
        json={"iban": iban}, timeout=8,
    )
    return r.json()

messages = [{"role": "user", "content": "Is DE89370400440532013000 valid, and which bank?"}]

# 1) the model asks to call the tool
first = client.chat.completions.create(model="gpt-4.1", messages=messages, tools=tools)
call = first.choices[0].message.tool_calls[0]

# 2) you run it against IBANforge and return the result
result = validate_iban(json.loads(call.function.arguments)["iban"])
messages += [
    first.choices[0].message,
    {"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)},
]

# 3) the model answers using the real data
final = client.chat.completions.create(model="gpt-4.1", messages=messages)
print(final.choices[0].message.content)
```

Add more tools the same way — map each to an endpoint in
`https://api.ibanforge.com/openapi.json` (`lookupBIC` → `GET /v1/bic/{code}`,
`complianceCheck` → `POST /v1/iban/compliance`, `lookupChClearing` →
`GET /v1/ch/clearing/{iid}`). Swap `gpt-4.1` for whichever model you use.

---

> Both surfaces are live and version-tracked: the MCP tool set and the OpenAPI
> spec update on each API deploy, so a pinned snippet keeps working.
