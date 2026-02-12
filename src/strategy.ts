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
- Consider the time remaining in the interval when deciding trade sizes`;

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
  ].join("\n");
}

export async function decide(
  input: StrategyInput,
): Promise<StrategyOutput> {
  const { object } = await generateObject({
    model: xai("grok-3-mini"),
    schema: tradeSchema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
  });

  return object;
}
