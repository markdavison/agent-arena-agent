import { createMCPClient } from "@ai-sdk/mcp";
import { generateText, generateObject } from "ai";
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

function buildResearchPrompt(input: StrategyInput): string {
  const { portfolio, assets } = input;

  const balanceLines = portfolio.balances
    .map((b) => `  ${b.asset}: ${String(b.amount)}`)
    .join("\n");

  const assetIds = assets.map((a) => a.asset_id).join(", ");

  return [
    "You are researching market data for a trading agent.",
    `Available assets: ${assetIds}`,
    `Current portfolio:\n${balanceLines}`,
    "",
    "You MUST call these tools before responding:",
    "1. Use GetStats to get the current TAO price in USD",
    "2. Use GetLatestSubnetPool to check subnet pool data",
    "",
    "After calling the tools, summarize the market data you found.",
    "Include exact prices and any notable trends.",
  ].join("\n");
}

function buildDecisionPrompt(
  input: StrategyInput,
  research: string,
): string {
  const { portfolio, clock } = input;

  const balanceLines = portfolio.balances
    .map((b) => `  ${b.asset}: ${String(b.amount)}`)
    .join("\n");

  return [
    "You are a trading agent competing in Agent Arena.",
    "",
    "Portfolio:",
    balanceLines,
    `NAV: $${String(portfolio.nav_usd.toFixed(2))}`,
    `Seconds remaining: ${String(clock.seconds_remaining)}`,
    "",
    "Market research:",
    research,
    "",
    "Trading rules:",
    "- USD <-> TAO direct trades allowed",
    "- TAO <-> ALPHA_{subnet_id} direct trades allowed",
    "- USD <-> ALPHA and ALPHA <-> ALPHA NOT allowed",
    "",
    "Guidelines:",
    "- Be conservative, don't trade entire balance",
    "- Keep some USD as safety buffer",
    "- Empty trades array is valid if holding is best",
    "",
    "Decide your trades based on the market data above.",
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

  console.log("[strategy] Connecting to Taostats MCP...");
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: "https://mcp.taostats.io?tools=data",
      headers,
    },
  });

  try {
    const mcpTools = await client.tools();
    const toolNames = Object.keys(mcpTools);
    console.log(`[strategy] MCP tools: ${toolNames.join(", ")}`);

    // Phase 1: research with tool calls
    console.log("[strategy] Phase 1: fetching market data...");
    const { text: research, steps } = await generateText({
      model: xai("grok-3-mini"),
      tools: mcpTools,
      maxSteps: 5,
      prompt: buildResearchPrompt(input),
    });

    for (const step of steps) {
      for (const call of step.toolCalls) {
        console.log(`[strategy] Tool call: ${call.toolName}`);
      }
    }
    console.log(`[strategy] Research: ${research.slice(0, 200)}`);

    // Phase 2: structured decision from research
    console.log("[strategy] Phase 2: deciding trades...");
    const { object } = await generateObject({
      model: xai("grok-3-mini"),
      schema: tradeSchema,
      prompt: buildDecisionPrompt(input, research),
    });

    return object;
  } finally {
    await client.close();
  }
}
