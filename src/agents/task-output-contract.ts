export const GET_TASK_OUTPUT_TOOL_NAME = "get_task_output";
export const GET_TASK_OUTPUT_TOOL_ALIASES = ["task_output"] as const;
export const GET_TASK_OUTPUT_TOOL_NAMES = [
  GET_TASK_OUTPUT_TOOL_NAME,
  ...GET_TASK_OUTPUT_TOOL_ALIASES,
] as const;

export const TASK_OUTPUT_WAIT_BACKOFF_MS = [100, 250, 500, 1000] as const;

export type TaskOutputStatus =
  | "pending"
  | "running"
  | "awaiting_input"
  | "success"
  | "error"
  | "cancelled"
  | "timeout";

export type TaskAwaitingInput = {
  detected_at: number;
  reason: string;
  guidance: string;
  prompt?: string;
};

export type TaskOutput = {
  task_id: string;
  task_type: "shell" | "agent" | "remote_agent" | string;
  status: TaskOutputStatus;
  description: string;
  output_path?: string;
  transcript_path?: string;
  final_text?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number | null;
  error?: string;
  prompt?: string;
  notified?: boolean;
  awaiting_input?: TaskAwaitingInput;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    duration_ms?: number | null;
  };
  metadata?: Record<string, unknown>;
};

export type TaskOutputRetrievalStatus = "success" | "not_ready" | "timeout" | "not_found";

export type TaskOutputRetrieval = {
  retrieval_status: TaskOutputRetrievalStatus;
  task: TaskOutput | null;
};

export function isTerminalTaskStatus(status: TaskOutputStatus): boolean {
  return (
    status === "success" || status === "error" || status === "cancelled" || status === "timeout"
  );
}
