import { createMCPClient } from "@ai-sdk/mcp";
import { generateObject } from "ai";
import { xai } from "@ai-sdk/xai";
import { z } from "zod";
import type {
  Portfolio,
  ClockResponse,
  AssetInfo,
  Trade,
} from "./types.js";

export type StrategyInput = {
  portfolio: Portfolio;
  clock: ClockResponse;
  assets: AssetInfo[];
};

export type StrategyOutput = {
  trades: Trade[];
  reasoning: string;
};

const tradeSchema = z.object({
  trades: z.array(
    z.object({
      from: z
        .string()
        .describe("Asset to sell (e.g. 'USD', 'TAO', 'ALPHA_1')"),
      to: z.string().describe("Asset to buy"),
      amount: z
        .number()
        .positive()
        .describe("Amount of the 'from' asset to trade"),
    }),
  ),
  reasoning: z
    .string()
    .max(2000)
    .describe("1-2 sentence explanation of your trading decision"),
});

const SYSTEM_PROMPT = `You are a trading agent competing in Agent Arena.

Your goal is to maximize your portfolio's NAV (net asset value in USD).

Trading rules:
- Valid routes: USD <-> TAO, and TAO <-> ALPHA_{subnet_id}
- Direct USD <-> ALPHA and ALPHA <-> ALPHA trades are NOT allowed
- Route through TAO: to buy ALPHA, first buy TAO with USD, then buy ALPHA with TAO
- You can make 0 to 50 trades per interval (every 15 minutes)

Strategy guidelines:
- Be conservative — don't trade your entire balance at once
- Keep some USD as a safety buffer
- Return an empty trades array if you prefer to hold your current positions
- Consider the time remaining in the interval when deciding trade sizes

You have access to Taostats tools for live market data. Use them to look up current TAO price and subnet pool data before making trading decisions.`;

function buildPrompt(input: StrategyInput): string {
  const { portfolio, clock, assets } = input;

  const balanceLines = portfolio.balances
    .map((b) => `  ${b.asset}: ${String(b.amount)}`)
    .join("\n");

  const assetIds = assets.map((a) => a.asset_id).join(", ");

  return [
    "Current portfolio:",
    balanceLines,
    "",
    `NAV (USD): $${String(portfolio.nav_usd.toFixed(2))}`,
    "",
    `Available assets: ${assetIds}`,
    "",
    `Seconds remaining in interval: ${String(clock.seconds_remaining)}`,
    "",
    "Fetch current market data using the Taostats tools, then decide your trades.",
  ].join("\n");
}

export async function decide(
  input: StrategyInput,
): Promise<StrategyOutput> {
  const taostatsKey = process.env["TAOSTATS_API_KEY"] ?? "";
  const headers: Record<string, string> = {};
  if (taostatsKey) {
    headers["Authorization"] = taostatsKey;
  }

  const client = await createMCPClient({
    transport: {
      type: "sse",
      url: "https://mcp.taostats.io?tools=data",
      headers,
    },
  });

  try {
    const mcpTools = await client.tools();

    const { object } = await generateObject({
      model: xai("grok-3-mini"),
      schema: tradeSchema,
      tools: mcpTools,
      maxSteps: 5,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input),
    });

    return object;
  } finally {
    await client.close();
  }
}
