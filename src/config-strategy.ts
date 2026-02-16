import { generateText, stepCountIs } from "ai";
import type { ToolSet } from "ai";
import { createXai } from "@ai-sdk/xai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const MAX_ATTEMPTS = 3;
const SUBMIT_TOOL = "submit_decision";
const REPORT_TRACE_TOOL = "report_trace";
const TRUNCATE_LIMIT = 500;

interface AgentConfig {
  system_prompt: string;
  model: {
    provider: string;
    model_id: string;
    base_url?: string;
  };
}

interface StepTrace {
  tool_calls: Array<{ name: string; input: unknown }>;
  tool_results: Array<{ name: string; output: string }>;
  text: string;
  reasoning: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

type Steps = Awaited<ReturnType<typeof generateText>>["steps"];

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
      if (!base_url) {
        throw new Error(
          `Unknown provider "${provider}" with no base_url`,
        );
      }
      return createOpenAI({
        baseURL: base_url,
        apiKey,
      }).chat(model_id);
  }
}

function truncate(str: string, limit: number): string {
  if (str.length <= limit) return str;
  return str.slice(0, limit) + "...";
}

function hasSubmitDecision(steps: Steps): boolean {
  return steps.some((step) =>
    step.toolCalls.some((c) => c.toolName === SUBMIT_TOOL),
  );
}

function buildTrace(steps: Steps): StepTrace[] {
  return steps.map((step) => ({
    tool_calls: step.toolCalls.map((c) => ({
      name: c.toolName,
      input: c.input,
    })),
    tool_results: step.toolResults.map((r) => ({
      name: r.toolName,
      output: truncate(
        String((r as { output?: unknown }).output ?? ""),
        TRUNCATE_LIMIT,
      ),
    })),
    text: step.text,
    reasoning: (step as { reasoningText?: string }).reasoningText ?? "",
    usage: {
      input_tokens: step.usage.inputTokens ?? 0,
      output_tokens: step.usage.outputTokens ?? 0,
      total_tokens: step.usage.totalTokens ?? 0,
    },
  }));
}

function logSteps(steps: Steps): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const prefix = `[agent] Step ${String(i + 1)}`;

    for (const call of step.toolCalls) {
      const input = truncate(
        JSON.stringify(call.input),
        TRUNCATE_LIMIT,
      );
      console.log(`${prefix} tool call: ${call.toolName}(${input})`);
    }

    for (const r of step.toolResults) {
      const output = truncate(
        String((r as { output?: unknown }).output ?? ""),
        TRUNCATE_LIMIT,
      );
      console.log(`${prefix} tool result: ${r.toolName} -> ${output}`);
    }

    if (step.text) {
      console.log(
        `${prefix} text: ${truncate(step.text, TRUNCATE_LIMIT)}`,
      );
    }

    const reasoning =
      (step as { reasoningText?: string }).reasoningText;
    if (reasoning) {
      console.log(
        `${prefix} reasoning: ${truncate(reasoning, TRUNCATE_LIMIT)}`,
      );
    }

    console.log(
      `${prefix} tokens: ` +
        `in=${String(step.usage.inputTokens ?? 0)} ` +
        `out=${String(step.usage.outputTokens ?? 0)} ` +
        `total=${String(step.usage.totalTokens ?? 0)}`,
    );
  }
}

function extractSubmissionId(steps: Steps): string | null {
  for (const step of steps) {
    for (const r of step.toolResults) {
      if (r.toolName !== SUBMIT_TOOL) continue;
      try {
        const output = (r as { output?: unknown }).output;
        const parsed = JSON.parse(String(output ?? "")) as {
          submission_id?: string;
        };
        if (parsed.submission_id) return parsed.submission_id;
      } catch {
        // result wasn't JSON — skip
      }
    }
  }
  return null;
}

export async function runConfigStrategy(
  tools: ToolSet,
  config: AgentConfig,
): Promise<void> {
  const model = getModel(config);
  const messages: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [
    {
      role: "user",
      content:
        "Analyze the market and make your trading " +
        "decision for this interval.",
    },
  ];

  const allSteps: Steps = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(10),
      system: config.system_prompt,
      messages,
    });

    logSteps(result.steps);
    allSteps.push(...result.steps);

    if (hasSubmitDecision(result.steps)) break;

    if (attempt < MAX_ATTEMPTS) {
      console.log(
        `[agent] No ${SUBMIT_TOOL} in attempt ` +
          `${String(attempt)}, retrying...`,
      );
      messages.push({
        role: "assistant",
        content: result.text,
      });
      messages.push({
        role: "user",
        content:
          "You did not call submit_decision. You MUST call " +
          "submit_decision with your trades to complete " +
          "your turn. Analyze the market and submit now.",
      });
    } else {
      console.log(
        `[agent] Warning: no ${SUBMIT_TOOL} after ` +
          `${String(MAX_ATTEMPTS)} attempts`,
      );
    }
  }

  const totalToolCalls = allSteps.reduce(
    (n, s) => n + s.toolCalls.length,
    0,
  );
  console.log(
    `[agent] Completed ${String(allSteps.length)} step(s), ` +
      `${String(totalToolCalls)} tool call(s)`,
  );

  const submissionId = extractSubmissionId(allSteps);
  if (submissionId && tools[REPORT_TRACE_TOOL]) {
    try {
      const trace = buildTrace(allSteps);
      console.log(
        `[agent] Reporting trace for submission ${submissionId}`,
      );
      const tool = tools[REPORT_TRACE_TOOL] as unknown as {
        execute: (
          args: {
            submission_id: string;
            steps: StepTrace[];
          },
        ) => Promise<unknown>;
      };
      await tool.execute({
        submission_id: submissionId,
        steps: trace,
      });
      console.log("[agent] Trace reported successfully");
    } catch (err) {
      console.warn(
        "[agent] Failed to report trace:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
