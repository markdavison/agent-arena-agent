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
        .describe("Asset to sell (e.g. 'USD', 'TAO', 'ALPHA_18')"),
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
    .describe("Brief explanation of your trading decision"),
});

function formatAssetList(assets: AssetInfo[]): string {
  const alphas = assets.filter((a) => a.subnet_id !== null);
  return alphas
    .map(
      (a) =>
        `  ${a.asset_id} — ${a.name} (subnet ${String(a.subnet_id)})`,
    )
    .join("\n");
}

function buildResearchPrompt(input: StrategyInput): string {
  const { portfolio, assets } = input;

  const balanceLines = portfolio.balances
    .map((b) => `  ${b.asset}: ${String(b.amount)}`)
    .join("\n");

  return [
    "You are a market researcher for a Bittensor trading agent.",
    "",
    "TRADEABLE SUBNET ALPHA TOKENS:",
    formatAssetList(assets),
    "",
    `CURRENT PORTFOLIO:\n${balanceLines}`,
    `Portfolio value: $${String(portfolio.nav_usd.toFixed(2))}`,
    "",
    "INSTRUCTIONS:",
    "1. Call GetStats to get the current TAO price and market data.",
    "2. Call GetLatestSubnetPool to see pool data for all subnets",
    "   (liquidity, TAO reserves, alpha reserves).",
    "",
    "After your tool calls, write a DETAILED summary covering:",
    "- Current TAO price in USD",
    "- Top 10 subnets ranked by TAO reserve (highest liquidity)",
    "- Any subnets with interesting reserve ratios",
    "- Which 3-5 subnets you recommend buying and why",
    "",
    "You MUST write a text summary. Do not stop after tool calls.",
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
    "You are an aggressive trading agent in Agent Arena,",
    "a paper-trading competition on Bittensor. This is a game",
    "with virtual money — there is ZERO downside to trading.",
    "Holding USD means LOSING to agents who deploy capital.",
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
    "- USD -> TAO: direct trade allowed",
    "- TAO -> ALPHA_{subnet_id}: direct trade allowed",
    "- TAO -> USD: direct trade allowed",
    "- ALPHA_{subnet_id} -> TAO: direct trade allowed",
    "- USD <-> ALPHA: NOT allowed (go through TAO)",
    "- ALPHA <-> ALPHA: NOT allowed (sell to TAO first)",
    "",
    "Strategy:",
    "- Deploy 60-80% of idle USD into TAO and subnet alphas",
    "- Buy TAO first, then swap TAO into 3-5 promising alphas",
    "- Pick subnets with the highest liquidity pools",
    "- Keep only ~20% USD as reserve",
    "- If already holding assets, rebalance toward better subnets",
    "- Empty trades array ONLY if already fully deployed",
    "",
    "Make your trades now. Be decisive and deploy capital.",
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

    console.log("[strategy] Phase 1: researching market...");
    const { text: research, steps } = await generateText({
      model: xai("grok-4-1-fast-non-reasoning"),
      tools: mcpTools,
      maxSteps: 5,
      prompt: buildResearchPrompt(input),
    });

    for (const step of steps) {
      for (const call of step.toolCalls ?? []) {
        console.log(`[strategy] Tool: ${call.toolName}`);
      }
    }

    // Fall back to raw tool results if model didn't summarize
    let researchData = research;
    if (!researchData.trim()) {
      console.log(
        "[strategy] Empty text response, using raw tool results",
      );
      const parts: string[] = [];
      for (const step of steps) {
        for (const r of step.toolResults ?? []) {
          const data =
            typeof r.result === "string"
              ? r.result
              : JSON.stringify(r.result, null, 2);
          parts.push(`[${r.toolName}]:\n${data}`);
        }
      }
      researchData = parts.join("\n\n");
    }

    if (researchData.length > 12000) {
      researchData =
        researchData.slice(0, 12000) + "\n[... truncated]";
    }

    console.log(
      `[strategy] Research (${String(researchData.length)} chars): ` +
        researchData.slice(0, 300),
    );

    console.log("[strategy] Phase 2: deciding trades...");
    const { object } = await generateObject({
      model: xai("grok-4-1-fast-non-reasoning"),
      schema: tradeSchema,
      prompt: buildDecisionPrompt(input, researchData),
    });

    return object;
  } finally {
    await client.close();
  }
}
