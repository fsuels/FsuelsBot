import path from "node:path";
import {
  requiresExecApproval,
  type ExecAllowlistEntry,
  type ExecAsk,
  type ExecCommandSegment,
  type ExecSecurity,
} from "../infra/exec-approvals.js";

type ManualApprovalDecision = "allow-once" | "allow-always" | null;

export type SystemRunPermissionContext = {
  argv: string[];
  rawCommand?: string | null;
  security: ExecSecurity;
  ask: ExecAsk;
  analysisOk: boolean;
  analysisReason?: string;
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
  segments: ExecCommandSegment[];
  approvalDecision?: string | null;
  approved?: boolean | null;
  needsScreenRecording?: boolean | null;
  platform?: string | null;
};

export type SystemRunPermissionTrace = {
  security: ExecSecurity;
  ask: ExecAsk;
  requiresAsk: boolean;
  approvedByAsk: boolean;
  approvalDecision: ManualApprovalDecision;
  analysisOk: boolean;
  analysisReason?: string;
  allowlistSatisfied: boolean;
  allowlistMatchedPatterns: string[];
};

type SystemRunPermissionBase = {
  reasonCode: string;
  reasonText: string;
  trace: SystemRunPermissionTrace;
};

export type SystemRunPermissionDecision =
  | (SystemRunPermissionBase & {
      state: "allow";
      execArgv: string[];
      allowAlwaysPatterns: string[];
    })
  | (SystemRunPermissionBase & {
      state: "ask";
      message: string;
    })
  | (SystemRunPermissionBase & {
      state: "deny";
      message: string;
    });

function normalizeApprovalDecision(value?: string | null): ManualApprovalDecision {
  return value === "allow-once" || value === "allow-always" ? value : null;
}

export function isCmdExeInvocation(argv: string[]): boolean {
  const token = argv[0]?.trim();
  if (!token) {
    return false;
  }
  const base = path.win32.basename(token).toLowerCase();
  return base === "cmd.exe" || base === "cmd";
}

function isWindowsPlatform(platform?: string | null): boolean {
  return platform === "win32";
}

function buildTrace(
  params: SystemRunPermissionContext,
  approvalDecision: ManualApprovalDecision,
  approvedByAsk: boolean,
  requiresAsk: boolean,
): SystemRunPermissionTrace {
  return {
    security: params.security,
    ask: params.ask,
    requiresAsk,
    approvedByAsk,
    approvalDecision,
    analysisOk: params.analysisOk,
    analysisReason: params.analysisReason,
    allowlistSatisfied: params.allowlistSatisfied,
    allowlistMatchedPatterns: params.allowlistMatches
      .map((entry) => entry.pattern?.trim() ?? "")
      .filter(Boolean),
  };
}

export function resolveSystemRunPermission(
  params: SystemRunPermissionContext,
): SystemRunPermissionDecision {
  const approvalDecision = normalizeApprovalDecision(params.approvalDecision);
  const approvedByAsk = approvalDecision !== null || params.approved === true;
  const requiresAsk = requiresExecApproval({
    ask: params.ask,
    security: params.security,
    analysisOk: params.analysisOk,
    allowlistSatisfied: params.allowlistSatisfied,
  });
  const trace = buildTrace(params, approvalDecision, approvedByAsk, requiresAsk);

  if (params.security === "deny") {
    return {
      state: "deny",
      reasonCode: "security=deny",
      reasonText: "Exec is disabled by security=deny.",
      message: "SYSTEM_RUN_DISABLED: security=deny",
      trace,
    };
  }

  if (requiresAsk && !approvedByAsk) {
    return {
      state: "ask",
      reasonCode: "approval-required",
      reasonText: "Manual approval is required before this command can run.",
      message: "SYSTEM_RUN_DENIED: approval required",
      trace,
    };
  }

  if (
    params.security === "allowlist" &&
    (!params.analysisOk || !params.allowlistSatisfied) &&
    !approvedByAsk
  ) {
    const detail =
      !params.analysisOk && params.analysisReason ? params.analysisReason : "allowlist miss";
    return {
      state: "deny",
      reasonCode: "allowlist-miss",
      reasonText: detail,
      message: `SYSTEM_RUN_DENIED: ${detail}`,
      trace,
    };
  }

  if (params.needsScreenRecording === true) {
    return {
      state: "deny",
      reasonCode: "permission:screenRecording",
      reasonText: "Screen recording permission is required.",
      message: "PERMISSION_MISSING: screenRecording",
      trace,
    };
  }

  const execArgv =
    params.security === "allowlist" &&
    isWindowsPlatform(params.platform) &&
    !approvedByAsk &&
    Boolean(params.rawCommand?.trim()) &&
    params.analysisOk &&
    params.allowlistSatisfied &&
    params.segments.length === 1 &&
    (params.segments[0]?.argv.length ?? 0) > 0
      ? params.segments[0].argv
      : params.argv;

  const allowAlwaysPatterns =
    approvalDecision === "allow-always" && params.security === "allowlist" && params.analysisOk
      ? params.segments
          .map((segment) => segment.resolution?.resolvedPath ?? "")
          .filter((entry) => entry.length > 0)
      : [];

  const reasonCode = approvedByAsk
    ? approvalDecision === "allow-always"
      ? "approved:allow-always"
      : approvalDecision === "allow-once"
        ? "approved:allow-once"
        : "approved"
    : params.security === "allowlist"
      ? "allowlist-match"
      : "security=full";

  const reasonText = approvedByAsk
    ? approvalDecision === "allow-always"
      ? "Allowed after manual allow-always approval."
      : approvalDecision === "allow-once"
        ? "Allowed after manual allow-once approval."
        : "Allowed after explicit approval."
    : params.security === "allowlist"
      ? "Command matched the configured exec allowlist."
      : "Exec is permitted by security=full.";

  return {
    state: "allow",
    reasonCode,
    reasonText,
    execArgv,
    allowAlwaysPatterns,
    trace,
  };
}
