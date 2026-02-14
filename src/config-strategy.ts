import { generateText, stepCountIs } from "ai";
import { createXai } from "@ai-sdk/xai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ToolSet } from "ai";

interface AgentConfig {
  system_prompt: string;
  model: {
    provider: string;
    model_id: string;
    base_url?: string;
  };
}

function getModel(config: AgentConfig) {
  const apiKey = process.env["LLM_API_KEY"];
  if (!apiKey) throw new Error("Missing LLM_API_KEY env var");

  const { provider, model_id, base_url } = config.model;

  switch (provider) {
    case "xai":
      return createXai({ apiKey })(model_id);
    case "openai":
      return createOpenAI({ apiKey })(model_id);
    case "anthropic":
      return createAnthropic({ apiKey })(model_id);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model_id);
    default:
      // OpenAI-compatible providers (deepseek, openrouter, chutes, kimi, qwen)
      if (!base_url) {
        throw new Error(`Unknown provider "${provider}" with no base_url`);
      }
      return createOpenAI({ baseURL: base_url, apiKey })(model_id);
  }
}

export async function runConfigStrategy(
  tools: ToolSet,
  config: AgentConfig,
): Promise<void> {
  const model = getModel(config);

  await generateText({
    model,
    tools,
    stopWhen: stepCountIs(10),
    system: config.system_prompt,
    prompt:
      "Analyze the market and make your trading decision for this interval.",
  });
}
