import type {
  DecisionPayload,
  VersionResponse,
  ClockResponse,
  Portfolio,
  ValidationResult,
  SubmissionResponse,
  AssetInfo,
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

function getConfig(): {
  agentId: string;
  agentToken: string;
  apiUrl: string;
} {
  const agentId = process.env["AGENT_ID"];
  const agentToken = process.env["AGENT_TOKEN"];
  const apiUrl = process.env["ARENA_API_URL"];

  if (!agentId) {
    throw new Error(
      "Missing AGENT_ID env var. Set it in .env or GitHub Secrets.",
    );
  }
  if (!agentToken) {
    throw new Error(
      "Missing AGENT_TOKEN env var. Set it in .env or GitHub Secrets.",
    );
  }
  if (!apiUrl) {
    throw new Error(
      "Missing ARENA_API_URL env var. Set it in .env or GitHub Secrets.",
    );
  }

  return { agentId, agentToken, apiUrl: apiUrl.replace(/\/+$/, "") };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const { agentToken, apiUrl } = getConfig();
  const url = `${apiUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentToken}`,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API ${method} ${path} failed (${String(res.status)}): ${text}`,
    );
  }

  return (await res.json()) as T;
}

/**
 * Check the API schema version matches this agent.
 * Fails with an actionable error if there is a mismatch.
 */
export async function checkVersion(): Promise<VersionResponse> {
  const version = await request<VersionResponse>("GET", "/v1/version");

  if (version.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `Schema version mismatch. Expected ${String(SCHEMA_VERSION)}, ` +
        `got ${String(version.schema_version)}. ` +
        `Please update your agent.`,
    );
  }

  return version;
}

/** Fetch current game interval info. */
export async function getClock(): Promise<ClockResponse> {
  return request<ClockResponse>("GET", "/v1/game/clock");
}

/** Fetch the agent's current portfolio and balances. */
export async function getPortfolio(
  agentId: string,
): Promise<Portfolio> {
  return request<Portfolio>(
    "GET",
    `/v1/agents/${agentId}/portfolio`,
  );
}

/** Fetch the list of tradeable assets. */
export async function getAssets(): Promise<AssetInfo[]> {
  return request<AssetInfo[]>("GET", "/v1/game/assets");
}

/** Validate a decision payload before submitting. */
export async function validateDecision(
  agentId: string,
  payload: DecisionPayload,
): Promise<ValidationResult> {
  return request<ValidationResult>(
    "POST",
    `/v1/agents/${agentId}/validate`,
    payload,
  );
}

/**
 * Submit a decision for the current interval.
 * Uses a deterministic idempotency key (agentId + interval start)
 * so duplicate submissions are safely ignored.
 */
export async function submitDecision(
  agentId: string,
  payload: DecisionPayload,
  intervalStart: string,
): Promise<SubmissionResponse> {
  const idempotencyKey = `${agentId}:${intervalStart}`;

  return request<SubmissionResponse>(
    "POST",
    `/v1/agents/${agentId}/submissions`,
    payload,
    { "Idempotency-Key": idempotencyKey },
  );
}
