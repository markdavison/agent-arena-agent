import {
  checkVersion,
  getClock,
  getPortfolio,
  getAssets,
  validateDecision,
  submitDecision,
} from "./arena.js";
import { decide } from "./strategy.js";
import type { DecisionPayload } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

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
  const agentId = requireEnv("AGENT_ID");
  requireEnv("AGENT_TOKEN");
  requireEnv("ARENA_API_URL");
  requireEnv("XAI_API_KEY");
  console.log(`[agent] Starting agent ${agentId}`);

  console.log("[agent] Checking API version...");
  const version = await checkVersion();
  console.log(
    `[agent] API version OK (schema=${String(version.schema_version)})`,
  );

  console.log("[agent] Fetching game clock...");
  const clock = await getClock();
  console.log(
    `[agent] Interval ${clock.current_interval.id} ` +
      `(${String(clock.seconds_remaining)}s remaining)`,
  );

  console.log("[agent] Fetching portfolio...");
  const portfolio = await getPortfolio(agentId);
  console.log(
    `[agent] Portfolio NAV: $${String(portfolio.nav_usd.toFixed(2))}`,
  );

  console.log("[agent] Fetching assets...");
  const assets = await getAssets();
  console.log(`[agent] ${String(assets.length)} assets available`);

  console.log("[agent] Running Grok strategy...");
  const { trades, reasoning } = await decide({
    portfolio,
    clock,
    assets,
  });
  console.log(`[agent] Reasoning: ${reasoning}`);
  console.log(`[agent] Strategy produced ${String(trades.length)} trade(s)`);

  const repoUrl =
    process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_REPOSITORY"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${process.env["GITHUB_REPOSITORY"]}`
      : "";

  const payload: DecisionPayload = {
    schema_version: SCHEMA_VERSION,
    decision: { trades },
    reasoning,
    metadata: {
      repo_url: repoUrl,
      commit_sha: process.env["GITHUB_SHA"] ?? "local",
      workflow_run_url: buildWorkflowRunUrl(),
    },
  };

  console.log("[agent] Validating decision...");
  const validation = await validateDecision(agentId, payload);
  for (const warning of validation.warnings) {
    console.log(`[agent] Warning: ${warning}`);
  }
  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`[agent] Validation error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("[agent] Validation passed");

  console.log("[agent] Submitting decision...");
  const intervalStart = clock.current_interval.start_time;
  const result = await submitDecision(agentId, payload, intervalStart);
  console.log(
    `[agent] Submitted! id=${result.submission_id} ` +
      `interval=${result.interval_start}`,
  );
}

main().catch((err: unknown) => {
  console.error("[agent] Fatal error:", err);
  process.exitCode = 1;
});
