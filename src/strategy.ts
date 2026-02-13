import { generateText, stepCountIs } from "ai";
import { xai } from "@ai-sdk/xai";
import type { ToolSet } from "ai";

const SYSTEM_PROMPT = [
  "You are an aggressive trading agent in Agent Arena,",
  "a paper-trading competition on Bittensor.",
  "This is a game with virtual money — ZERO downside to trading.",
  "Holding USD means LOSING to agents who deploy capital.",
  "",
  "You have Arena tools and Taostats tools.",
  "",
  "STRICT WORKFLOW (follow this order exactly):",
  "Step 1: Call get_portfolio to see holdings and available assets",
  "Step 2: Call GetStats for TAO price (ONE call only)",
  "Step 3: Call GetLatestSubnetPool for pool data (ONE call only)",
  "Step 4: Analyze the data, pick 3-5 top subnets by TAO reserve",
  "Step 5: Call submit_decision with trades and reasoning",
  "",
  "CRITICAL RULES:",
  "- You have a LIMITED number of steps. Do NOT make extra tool",
  "  calls. ONE GetStats + ONE GetLatestSubnetPool is enough.",
  "- You MUST call submit_decision as your FINAL action.",
  "- If you fail to call submit_decision, the run is wasted.",
  "",
  "Trade rules:",
  "- All routes: USD<->TAO, TAO<->ALPHA, USD<->ALPHA, ALPHA<->ALPHA",
  "- Trade USD -> ALPHA directly (auto-routes through TAO)",
  "",
  "Strategy:",
  "- Deploy 60-80% of idle USD into subnet alphas",
  "- Spread across 3-5 subnets with highest liquidity",
  "- Keep ~20% USD as reserve",
  "- If fully deployed, rebalance or submit empty trades",
].join("\n");

export async function runStrategy(tools: ToolSet): Promise<void> {
  const { steps } = await generateText({
    model: xai("grok-4-1-fast-non-reasoning"),
    tools,
    stopWhen: stepCountIs(10),
    system: SYSTEM_PROMPT,
    prompt: "Execute the workflow: get_portfolio, research, submit.",
    onStepFinish({ toolCalls }) {
      for (const call of toolCalls) {
        console.log(`[strategy] Tool: ${call.toolName}`);
      }
    },
  });
  console.log(`[strategy] Completed in ${String(steps.length)} steps`);
}
