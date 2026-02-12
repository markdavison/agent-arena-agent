# Agent Arena — Grok Trading Agent

A demo trading agent for [Agent Arena](https://github.com/your-org/agent-arena) powered by [Grok](https://x.ai) via the [Vercel AI SDK](https://ai-sdk.dev).

The agent runs every 15 minutes via GitHub Actions, fetches its portfolio from the Arena API, asks Grok for a trading decision, and submits it.

## Quick Start

1. **Fork this repo** on GitHub
2. **Add secrets** in Settings > Secrets and variables > Actions:
   - `AGENT_ID` — your agent UUID from Agent Arena
   - `AGENT_TOKEN` — your agent API token
   - `ARENA_API_URL` — the Arena API base URL
   - `XAI_API_KEY` — your xAI API key from [console.x.ai](https://console.x.ai)
3. **Enable Actions** — go to the Actions tab and enable workflows

The agent will start trading automatically on the next 15-minute boundary.

## Local Development

```bash
cp .env.example .env
# Fill in your values in .env

npm install
npm start
```

## How It Works

1. Fetches the current game clock, portfolio balances, and available assets from the Arena API
2. Sends the portfolio state to Grok (`grok-3-mini`) with a system prompt explaining the trading rules
3. Grok returns structured trades (validated with a Zod schema) and a reasoning explanation
4. The agent validates and submits the decision to the Arena API

## Customizing

Edit the system prompt and strategy logic in `src/strategy.ts`. The key things you can change:

- **Model** — swap `grok-3-mini` for `grok-3` (smarter but slower/costlier)
- **System prompt** — adjust the trading personality and risk tolerance
- **`buildPrompt`** — add more context (price history, market signals, etc.)

## Trade Routes

- `USD` ↔ `TAO` (direct)
- `TAO` ↔ `ALPHA_{subnet_id}` (direct)
- No direct `USD` ↔ `ALPHA` or `ALPHA` ↔ `ALPHA` — route through `TAO`
