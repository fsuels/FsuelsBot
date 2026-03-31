import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { getTaskOutput } from "../task-output.js";
import {
  completeActiveVerificationTask,
  ensureActiveVerificationTask,
  resolveTaskTrackerContextFromSessionKey,
} from "../task-tracker.js";
import { jsonResult, readNumberParam, readStringArrayParam, readStringParam } from "./common.js";
import { createSessionsSpawnTool } from "./sessions-spawn-tool.js";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SPOT_CHECK_COUNT = 2;
const MAX_SPOT_CHECK_COUNT = 3;

const VerificationGateToolSchema = Type.Object(
  {
    changeSummary: Type.String({
      minLength: 1,
      description: "Short summary of what changed and what needs verification.",
    }),
    files: Type.Optional(
      Type.Array(
        Type.String({
          description: "Changed files or impacted modules.",
        }),
      ),
    ),
    editedFilesCount: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Number of edited files when known.",
      }),
    ),
    riskLabels: Type.Optional(
      Type.Array(
        Type.String({
          description:
            "Non-triviality markers such as backend, api, infra, config, schema, migration, auth, or security.",
        }),
      ),
    ),
    commands: Type.Optional(
      Type.Array(
        Type.String({
          description: "Verification commands the independent verifier should run when feasible.",
        }),
      ),
    ),
    checks: Type.Optional(
      Type.Array(
        Type.String({
          description: "Non-command checks the verifier should inspect manually.",
        }),
      ),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Maximum wait time for each verification pass.",
      }),
    ),
    spotCheckCount: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: MAX_SPOT_CHECK_COUNT,
        description: "How many successful commands to rerun in the spot-check pass (0-3).",
      }),
    ),
  },
  { additionalProperties: false },
);

const NON_TRIVIAL_RISK_LABELS = new Set([
  "backend",
  "api",
  "infra",
  "config",
  "schema",
  "migration",
  "auth",
  "security",
] as const);

export type VerificationVerdict = "PASS" | "FAIL" | "PARTIAL";

export type VerificationCommandReport = {
  command: string;
  status: "passed" | "failed" | "skipped";
  relevant_output?: string;
};

export type VerificationReport = {
  verdict: VerificationVerdict;
  summary: string;
  commands_executed: VerificationCommandReport[];
  verified: string[];
  unverified: string[];
  failure_reasons: string[];
};

type VerificationTaskHandle = {
  taskId: string;
  childSessionKey?: string;
  outputPath?: string;
  transcriptPath?: string;
};

type VerificationGateDeps = {
  spawnTask?: (params: {
    task: string;
    timeoutMs: number;
    phase: "primary" | "spotcheck";
  }) => Promise<VerificationTaskHandle>;
  waitForTask?: (
    taskId: string,
    timeoutMs: number,
  ) => Promise<{
    finalText?: string;
    outputPath?: string;
    transcriptPath?: string;
    error?: string;
  }>;
  ensureVerificationTask?: (params: {
    description: string;
    metadata?: Record<string, unknown>;
  }) => Promise<{ id: string } | null>;
  completeVerificationTask?: (params: { metadata?: Record<string, unknown> }) => Promise<void>;
};

function normalizeList(value?: string[]): string[] {
  return (value ?? []).map((entry) => entry.trim()).filter(Boolean);
}

export function requiresIndependentVerification(params: {
  editedFilesCount?: number;
  files?: string[];
  riskLabels?: string[];
}): boolean {
  const editedFilesCount =
    typeof params.editedFilesCount === "number" && Number.isFinite(params.editedFilesCount)
      ? Math.max(0, Math.floor(params.editedFilesCount))
      : undefined;
  const fileCount = normalizeList(params.files).length;
  const normalizedRisks = normalizeList(params.riskLabels).map((entry) => entry.toLowerCase());
  return (
    (editedFilesCount ?? fileCount) >= 3 ||
    normalizedRisks.some((entry) => NON_TRIVIAL_RISK_LABELS.has(entry as never))
  );
}

function buildJsonSchemaReminder() {
  return JSON.stringify(
    {
      verdict: "PASS|FAIL|PARTIAL",
      summary: "short evidence-based summary",
      commands_executed: [
        {
          command: "string",
          status: "passed|failed|skipped",
          relevant_output: "short decisive output",
        },
      ],
      verified: ["what you verified"],
      unverified: ["what you could not verify"],
      failure_reasons: ["specific failure reasons when verdict is FAIL"],
    },
    null,
    2,
  );
}

export function buildPrimaryVerifierTask(params: {
  changeSummary: string;
  files: string[];
  riskLabels: string[];
  commands: string[];
  checks: string[];
}): string {
  const lines = [
    "You are an independent verification worker.",
    "Do not edit files. Re-check the finished change from scratch using the available read/test tools.",
    "Prefer direct evidence over trusting the implementation summary.",
    "",
    `Change summary: ${params.changeSummary}`,
  ];
  if (params.files.length > 0) {
    lines.push("", "Impacted files/modules:", ...params.files.map((file) => `- ${file}`));
  }
  if (params.riskLabels.length > 0) {
    lines.push("", `Risk labels: ${params.riskLabels.join(", ")}`);
  }
  if (params.commands.length > 0) {
    lines.push(
      "",
      "Run these verification commands when feasible and capture the decisive output:",
      ...params.commands.map((command) => `- ${command}`),
    );
  }
  if (params.checks.length > 0) {
    lines.push(
      "",
      "Also inspect these non-command checks:",
      ...params.checks.map((check) => `- ${check}`),
    );
  }
  lines.push(
    "",
    "Rules:",
    "- If a requested command or check cannot be completed, list it under unverified instead of guessing.",
    "- If anything fails, explain the specific failure reason.",
    "- Return ONLY valid JSON. No markdown fences, no prose before or after.",
    buildJsonSchemaReminder(),
  );
  return lines.join("\n");
}

export function buildSpotCheckVerifierTask(params: {
  changeSummary: string;
  commands: string[];
}): string {
  return [
    "You are an independent spot-check verifier.",
    "Do not edit files. Re-run the listed commands and compare their outcomes to the earlier verification claim.",
    "",
    `Change summary: ${params.changeSummary}`,
    "",
    "Commands to rerun:",
    ...params.commands.map((command) => `- ${command}`),
    "",
    "Rules:",
    "- Return PASS only if the rerun corroborates the prior verification claims.",
    "- Return FAIL if any rerun diverges materially or surfaces a failure.",
    "- Return PARTIAL if you cannot rerun one or more commands.",
    "- Return ONLY valid JSON. No markdown fences, no prose before or after.",
    buildJsonSchemaReminder(),
  ].join("\n");
}

function tryParseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // fall through
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function normalizeVerificationReport(raw: unknown): VerificationReport {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const verdictRaw =
    typeof record.verdict === "string" ? record.verdict.trim().toUpperCase() : "PARTIAL";
  const verdict: VerificationVerdict =
    verdictRaw === "PASS" || verdictRaw === "FAIL" ? verdictRaw : "PARTIAL";
  const summary =
    typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : verdict === "PASS"
        ? "Verification passed."
        : verdict === "FAIL"
          ? "Verification failed."
          : "Verification was only partial.";
  const commands_executed = Array.isArray(record.commands_executed)
    ? record.commands_executed
        .map((entry) => {
          const command =
            entry &&
            typeof entry === "object" &&
            typeof (entry as { command?: unknown }).command === "string"
              ? (entry as { command: string }).command.trim()
              : "";
          if (!command) {
            return null;
          }
          const statusRaw =
            entry &&
            typeof entry === "object" &&
            typeof (entry as { status?: unknown }).status === "string"
              ? (entry as { status: string }).status.trim().toLowerCase()
              : "skipped";
          const status = statusRaw === "passed" || statusRaw === "failed" ? statusRaw : "skipped";
          const relevant_output =
            entry &&
            typeof entry === "object" &&
            typeof (entry as { relevant_output?: unknown }).relevant_output === "string"
              ? (entry as { relevant_output: string }).relevant_output.trim()
              : undefined;
          return {
            command,
            status,
            ...(relevant_output ? { relevant_output } : {}),
          };
        })
        .filter((entry): entry is VerificationCommandReport => Boolean(entry))
    : [];
  const verified = normalizeList(
    Array.isArray(record.verified) ? (record.verified as string[]) : undefined,
  );
  const unverified = normalizeList(
    Array.isArray(record.unverified) ? (record.unverified as string[]) : undefined,
  );
  const failure_reasons = normalizeList(
    Array.isArray(record.failure_reasons) ? (record.failure_reasons as string[]) : undefined,
  );
  return {
    verdict,
    summary,
    commands_executed,
    verified,
    unverified,
    failure_reasons,
  };
}

function parseVerificationReportText(text?: string, fallbackError?: string): VerificationReport {
  const parsed = text ? tryParseJsonObject(text) : undefined;
  if (parsed) {
    return normalizeVerificationReport(parsed);
  }
  const failureReason = fallbackError?.trim() || "Verifier did not return parseable JSON.";
  return {
    verdict: "PARTIAL",
    summary: failureReason,
    commands_executed: [],
    verified: [],
    unverified: ["Verifier output was unavailable or malformed."],
    failure_reasons: [],
  };
}

function selectSpotCheckCommands(
  report: VerificationReport,
  requestedCommands: string[],
  spotCheckCount: number,
): string[] {
  const preferred = report.commands_executed
    .filter((entry) => entry.status === "passed")
    .map((entry) => entry.command);
  const fallback = requestedCommands;
  const selected = [...preferred, ...fallback]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, Math.max(0, Math.min(MAX_SPOT_CHECK_COUNT, spotCheckCount)));
  return selected;
}

export function combineVerificationReports(params: {
  primary: VerificationReport;
  spotCheck?: VerificationReport;
  spotCheckCommands?: string[];
}): VerificationReport {
  if (params.primary.verdict === "FAIL") {
    return params.primary;
  }
  if (!params.spotCheck) {
    if ((params.spotCheckCommands ?? []).length === 0) {
      return params.primary;
    }
    return {
      verdict: "PARTIAL",
      summary: "Primary verification passed, but no independent spot-check could be completed.",
      commands_executed: params.primary.commands_executed,
      verified: params.primary.verified,
      unverified: [...params.primary.unverified, "Spot-check pass could not be completed."].filter(
        (entry, index, list) => list.indexOf(entry) === index,
      ),
      failure_reasons: params.primary.failure_reasons,
    };
  }
  if (params.spotCheck.verdict === "FAIL") {
    return {
      verdict: "FAIL",
      summary: params.spotCheck.summary || "Spot-check diverged from the primary verifier.",
      commands_executed: [
        ...params.primary.commands_executed,
        ...params.spotCheck.commands_executed,
      ],
      verified: params.primary.verified,
      unverified: [...params.primary.unverified, ...params.spotCheck.unverified].filter(
        (entry, index, list) => list.indexOf(entry) === index,
      ),
      failure_reasons: [
        ...params.primary.failure_reasons,
        ...params.spotCheck.failure_reasons,
      ].filter((entry, index, list) => list.indexOf(entry) === index),
    };
  }
  if (params.spotCheck.verdict === "PARTIAL") {
    return {
      verdict: "PARTIAL",
      summary: params.spotCheck.summary || params.primary.summary,
      commands_executed: [
        ...params.primary.commands_executed,
        ...params.spotCheck.commands_executed,
      ],
      verified: params.primary.verified,
      unverified: [...params.primary.unverified, ...params.spotCheck.unverified].filter(
        (entry, index, list) => list.indexOf(entry) === index,
      ),
      failure_reasons: params.primary.failure_reasons,
    };
  }
  return {
    verdict: params.primary.verdict,
    summary: params.primary.summary,
    commands_executed: [...params.primary.commands_executed, ...params.spotCheck.commands_executed],
    verified: params.primary.verified,
    unverified: params.primary.unverified,
    failure_reasons: params.primary.failure_reasons,
  };
}

function normalizeTimeoutMs(raw: number | undefined) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(0, Math.floor(raw));
}

function normalizeSpotCheckCount(raw: number | undefined) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_SPOT_CHECK_COUNT;
  }
  return Math.max(0, Math.min(MAX_SPOT_CHECK_COUNT, Math.floor(raw)));
}

function buildDefaultDeps(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  requesterAgentIdOverride?: string;
}): Required<VerificationGateDeps> {
  const spawnTool = createSessionsSpawnTool({
    agentSessionKey: opts?.agentSessionKey,
    agentChannel: opts?.agentChannel,
    agentAccountId: opts?.agentAccountId,
    agentTo: opts?.agentTo,
    agentThreadId: opts?.agentThreadId,
    agentGroupId: opts?.agentGroupId,
    agentGroupChannel: opts?.agentGroupChannel,
    agentGroupSpace: opts?.agentGroupSpace,
    sandboxed: opts?.sandboxed,
    requesterAgentIdOverride: opts?.requesterAgentIdOverride,
  });

  return {
    spawnTask: async ({ task, timeoutMs }) => {
      const result = await spawnTool.execute("verification-gate/spawn", {
        task,
        profile: "test-runner",
        cleanup: "keep",
        runTimeoutSeconds: Math.ceil(timeoutMs / 1000),
      });
      const details = result.details as Record<string, unknown>;
      const status = typeof details.status === "string" ? details.status : "error";
      const taskId =
        typeof details.task_id === "string"
          ? details.task_id
          : typeof details.runId === "string"
            ? details.runId
            : undefined;
      if (status !== "accepted" || !taskId) {
        throw new Error(
          typeof details.error === "string"
            ? details.error
            : "Failed to start verification sub-agent.",
        );
      }
      return {
        taskId,
        childSessionKey:
          typeof details.childSessionKey === "string" ? details.childSessionKey : undefined,
        outputPath: typeof details.output_path === "string" ? details.output_path : undefined,
        transcriptPath:
          typeof details.transcript_path === "string" ? details.transcript_path : undefined,
      };
    },
    waitForTask: async (taskId, timeoutMs) => {
      const retrieval = await getTaskOutput({
        task_id: taskId,
        block: true,
        timeout_ms: timeoutMs,
      });
      if (retrieval.retrieval_status !== "success" || !retrieval.task) {
        return {
          finalText: undefined,
          error:
            retrieval.retrieval_status === "timeout"
              ? "Verification timed out."
              : "Verification result was not available.",
        };
      }
      return {
        finalText: retrieval.task.final_text,
        outputPath: retrieval.task.output_path,
        transcriptPath: retrieval.task.transcript_path,
        error: retrieval.task.error,
      };
    },
    ensureVerificationTask: async ({ description, metadata }) => {
      if (!opts?.agentSessionKey?.trim()) {
        return null;
      }
      const context = await resolveTaskTrackerContextFromSessionKey(opts.agentSessionKey);
      const task = await ensureActiveVerificationTask({
        context,
        description,
        metadata,
      });
      return { id: task.id };
    },
    completeVerificationTask: async ({ metadata }) => {
      if (!opts?.agentSessionKey?.trim()) {
        return;
      }
      const context = await resolveTaskTrackerContextFromSessionKey(opts.agentSessionKey);
      await completeActiveVerificationTask({
        context,
        metadata,
      });
    },
  };
}

export function createVerificationGateTool(
  opts?: {
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    agentTo?: string;
    agentThreadId?: string | number;
    agentGroupId?: string | null;
    agentGroupChannel?: string | null;
    agentGroupSpace?: string | null;
    sandboxed?: boolean;
    requesterAgentIdOverride?: string;
  },
  deps?: VerificationGateDeps,
): AnyAgentTool {
  const resolvedDeps = {
    ...buildDefaultDeps(opts),
    ...deps,
  };

  return {
    label: "Verification Gate",
    name: "verification_gate",
    description:
      "Run an independent verification pass for non-trivial changes. Spawns a test-runner sub-agent, collects a PASS/FAIL/PARTIAL verdict, and performs a spot-check rerun when feasible.",
    parameters: VerificationGateToolSchema,
    execute: async (_toolCallId, rawArgs) => {
      const args = rawArgs as Record<string, unknown>;
      const changeSummary = readStringParam(args, "changeSummary", { required: true });
      const files = readStringArrayParam(args, "files") ?? [];
      const editedFilesCount = readNumberParam(args, "editedFilesCount", { integer: true });
      const riskLabels = normalizeList(readStringArrayParam(args, "riskLabels") ?? []).map(
        (entry) => entry.toLowerCase(),
      );
      const commands = readStringArrayParam(args, "commands") ?? [];
      const checks = readStringArrayParam(args, "checks") ?? [];
      const timeoutMs = normalizeTimeoutMs(readNumberParam(args, "timeoutMs", { integer: true }));
      const spotCheckCount = normalizeSpotCheckCount(
        readNumberParam(args, "spotCheckCount", { integer: true }),
      );

      const nonTrivial = requiresIndependentVerification({
        editedFilesCount,
        files,
        riskLabels,
      });
      if (!nonTrivial) {
        return jsonResult({
          status: "not_required",
          nonTrivial: false,
          reason:
            "Independent verification is reserved for non-trivial changes (3+ files or high-risk change labels).",
        });
      }

      const verificationTask = await resolvedDeps.ensureVerificationTask?.({
        description: `Independent verification: ${changeSummary}`,
        metadata: {
          changeSummary,
          files,
          riskLabels,
        },
      });

      const primaryHandle = await resolvedDeps.spawnTask({
        task: buildPrimaryVerifierTask({
          changeSummary,
          files,
          riskLabels,
          commands,
          checks,
        }),
        timeoutMs,
        phase: "primary",
      });
      const primaryResult = await resolvedDeps.waitForTask(primaryHandle.taskId, timeoutMs);
      const primaryReport = parseVerificationReportText(
        primaryResult.finalText,
        primaryResult.error,
      );

      const spotCheckCommands =
        primaryReport.verdict === "PASS"
          ? selectSpotCheckCommands(primaryReport, commands, spotCheckCount)
          : [];
      let spotCheckHandle: VerificationTaskHandle | undefined;
      let spotCheckReport: VerificationReport | undefined;
      if (primaryReport.verdict === "PASS" && spotCheckCommands.length > 0) {
        spotCheckHandle = await resolvedDeps.spawnTask({
          task: buildSpotCheckVerifierTask({
            changeSummary,
            commands: spotCheckCommands,
          }),
          timeoutMs,
          phase: "spotcheck",
        });
        const spotCheckResult = await resolvedDeps.waitForTask(spotCheckHandle.taskId, timeoutMs);
        spotCheckReport = parseVerificationReportText(
          spotCheckResult.finalText,
          spotCheckResult.error,
        );
      }

      const finalReport = combineVerificationReports({
        primary: primaryReport,
        spotCheck: spotCheckReport,
        spotCheckCommands,
      });

      if (finalReport.verdict === "PASS" || finalReport.verdict === "PARTIAL") {
        await resolvedDeps.completeVerificationTask?.({
          metadata: {
            verdict: finalReport.verdict,
            summary: finalReport.summary,
            verified: finalReport.verified,
            unverified: finalReport.unverified,
            failure_reasons: finalReport.failure_reasons,
          },
        });
      }

      return jsonResult({
        status: "verified",
        nonTrivial: true,
        verdict: finalReport.verdict,
        summary: finalReport.summary,
        verificationTaskId: verificationTask?.id,
        report: finalReport,
        primary: {
          taskId: primaryHandle.taskId,
          outputPath: primaryResult.outputPath ?? primaryHandle.outputPath,
          transcriptPath: primaryResult.transcriptPath ?? primaryHandle.transcriptPath,
          report: primaryReport,
        },
        ...(spotCheckHandle
          ? {
              spotCheck: {
                taskId: spotCheckHandle.taskId,
                commands: spotCheckCommands,
                report: spotCheckReport,
              },
            }
          : {}),
      });
    },
  };
}
