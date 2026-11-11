# Weekly market-watch (veille) → Dory

Automated weekly opportunity scan for IBANforge, delivered to Claude-Alain on
Telegram via the **Dory** bot.

## What it does

`scripts/weekly-veille.ts`, run weekly by `.github/workflows/weekly-veille.yml`:

1. **Stats** — pulls `/stats` + `/stats/history` (STATS_TOKEN) and computes the
   last 7 days vs the prior 7: requests (Δ), revenue (Δ), paid calls, 4xx/5xx
   rate, top endpoints, cumulative total.
2. **Discoverability canary** — probes the deployed API like a registry
   crawler (402 answers, x402 discovery) and reports what it sees.
3. **Deliver** — sends a concise French report to the Dory bot
   (`TELEGRAM_DORY_TOKEN` → `TELEGRAM_CHAT_ID`), splitting at Telegram's limit.

The market research and AI-recommendability sections, which called the paid
Anthropic API, were removed on 2026-11-11 (Claude-Alain's decision). The job no
longer needs an Anthropic key.

## Schedule

`cron: '23 6 * * 1'` — Mondays ~08:23 Europe/Zurich. Also `workflow_dispatch`
for manual runs.

## Secrets (GitHub Actions)

| Secret | Source |
|---|---|
| `STATS_TOKEN` | same token as the Railway prod env (protects `/stats`) |
| `TELEGRAM_DORY_TOKEN` | the Dory bot token (tabornio `.env`) |
| `TELEGRAM_CHAT_ID` | the recipient's Telegram id |

## Test it

Actions → "Weekly market-watch (veille) → Dory" → **Run workflow**. Or locally:

```bash
STATS_TOKEN=… TELEGRAM_DORY_TOKEN=… TELEGRAM_CHAT_ID=… npm run veille
```

## Tuning

- Cadence: edit the cron in `.github/workflows/weekly-veille.yml`.
