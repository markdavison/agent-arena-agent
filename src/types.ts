export const SCHEMA_VERSION = 1;

export type Trade = {
  from: string;
  to: string;
  amount: number;
};

export type DecisionPayload = {
  schema_version: 1;
  decision: { trades: Trade[] };
  reasoning: string;
  metadata: {
    repo_url: string;
    commit_sha: string;
    workflow_run_url?: string;
  };
};

export type VersionResponse = {
  schema_version: number;
  server_time: string;
  interval_seconds: number;
};

export type ClockResponse = {
  current_interval: {
    id: string;
    start_time: string;
    end_time: string;
  };
  server_time: string;
  seconds_remaining: number;
};

export type BalanceEntry = {
  asset: string;
  amount: number;
};

export type Portfolio = {
  agent_id: string;
  balances: BalanceEntry[];
  nav_usd: number;
  updated_at: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type SubmissionResponse = {
  accepted: boolean;
  submission_id: string;
  interval_start: string;
};

export type AssetInfo = {
  asset_id: string;
  name: string;
  subnet_id: number | null;
};
