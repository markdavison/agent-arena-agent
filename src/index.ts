import { existsSync, readFileSync } from "node:fs";
import { createMCPClient } from "@ai-sdk/mcp";
import { runStrategy } from "./strategy.js";
import { runConfigStrategy } from "./config-strategy.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        `Set it in .env or GitHub Secrets.`,
    );
  }
  return value;
}

function buildWorkflowRunUrl(): string | undefined {
  const server = process.env["GITHUB_SERVER_URL"];
  const repo = process.env["GITHUB_REPOSITORY"];
  const runId = process.env["GITHUB_RUN_ID"];
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`;
  }
  return undefined;
}

async function main(): Promise<void> {
  const agentToken = requireEnv("AGENT_TOKEN");
  const apiUrl = requireEnv("ARENA_API_URL").replace(/\/+$/, "");
  const taostatsKey = process.env["TAOSTATS_API_KEY"] ?? "";
  console.log("[agent] Starting agent");

  const repoUrl =
    process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_REPOSITORY"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}`
      : "";
  const commitSha = process.env["GITHUB_SHA"] ?? "local";
  const workflowRunUrl = buildWorkflowRunUrl();

  const arenaParams = new URLSearchParams({
    token: agentToken,
    repo_url: repoUrl,
    commit_sha: commitSha,
    workflow_run_url: workflowRunUrl ?? "",
  });
  const arenaSseUrl = `${apiUrl}/mcp/sse?${arenaParams.toString()}`;

  console.log("[agent] Connecting to Arena MCP server...");
  const arenaClient = await createMCPClient({
    transport: { type: "sse", url: arenaSseUrl },
  });

  const taostatsHeaders: Record<string, string> = {};
  if (taostatsKey) {
    taostatsHeaders["Authorization"] = taostatsKey;
  }

  console.log("[agent] Connecting to Taostats MCP server...");
  const taostatsClient = await createMCPClient({
    transport: {
      type: "http",
      url: "https://mcp.taostats.io?tools=data",
      headers: taostatsHeaders,
    },
  });

  try {
    const arenaTools = await arenaClient.tools();
    const taostatsTools = await taostatsClient.tools();
    const allTools = { ...arenaTools, ...taostatsTools };
    console.log(
      `[agent] Loaded ${String(Object.keys(allTools).length)} tools`,
    );

    console.log("[agent] Running strategy...");
    if (existsSync("agent.config.json")) {
      const config = JSON.parse(readFileSync("agent.config.json", "utf-8"));
      await runConfigStrategy(allTools, config);
    } else {
      await runStrategy(allTools);
    }
    console.log("[agent] Strategy complete");
  } finally {
    await arenaClient.close();
    await taostatsClient.close();
  }
}

main().catch((err: unknown) => {
  console.error("[agent] Fatal error:", err);
  process.exitCode = 1;
});
