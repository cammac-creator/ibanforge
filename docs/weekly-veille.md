# Weekly market-watch (veille) → Dory

Automated weekly opportunity scan for IBANforge, delivered to Claude-Alain on
Telegram via the **Dory** bot.

## What it does

`scripts/weekly-veille.ts`, run weekly by `.github/workflows/weekly-veille.yml`:

1. **Stats** — pulls `/stats` + `/stats/history` (STATS_TOKEN) and computes the
   last 7 days vs the prior 7: requests (Δ), revenue (Δ), paid calls, 4xx/5xx
   rate, top endpoints, cumulative total.
2. **Research** — asks Claude (`claude-sonnet-4-6` + the `web_search` tool) to
   find recent developments across **8 opportunity types**, returning
   `🚪 Portes qui s'ouvrent` (3-5 actionable, with source URLs) and
   `🔭 Pistes à creuser`:
   1. Regulatory (VoP, Instant Payments Reg, AMLR/AMLA, vIBAN, FATF, SEPA)
   2. Competitors (iban.com, IBANAPI… pricing, outages, gaps)
   3. Distribution (MCP registries, marketplaces, awesome-lists, x402 bazaar)
   4. Demand / leads (Reddit/HN/SO threads, RFPs)
   5. Agent economy / x402 (frameworks adopting MCP, AP2, USDC/Base)
   6. Content / SEO
   7. Partnerships / integrations (ERP like Odoo, accounting, PSP, compliance)
   8. Pricing / monetization
3. **Deliver** — sends a concise French report to the Dory bot
   (`TELEGRAM_DORY_TOKEN` → `TELEGRAM_CHAT_ID`), splitting at Telegram's limit.

If the research call fails, the stats report is still delivered.

## Schedule

`cron: '23 6 * * 1'` — Mondays ~08:23 Europe/Zurich. Also `workflow_dispatch`
for manual runs.

## Secrets (GitHub Actions)

| Secret | Source |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console (rotate if ever exposed) |
| `STATS_TOKEN` | same token as the Railway prod env (protects `/stats`) |
| `TELEGRAM_DORY_TOKEN` | the Dory bot token (tabornio `.env`) |
| `TELEGRAM_CHAT_ID` | the recipient's Telegram id |

## Test it

Actions → "Weekly market-watch (veille) → Dory" → **Run workflow**. Or locally:

```bash
ANTHROPIC_API_KEY=… STATS_TOKEN=… TELEGRAM_DORY_TOKEN=… TELEGRAM_CHAT_ID=… npm run veille
```

## Tuning

- Model: set `VEILLE_MODEL` (default `claude-sonnet-4-6`).
- Cadence / opportunity axes: edit the cron and the prompt in
  `scripts/weekly-veille.ts`.
