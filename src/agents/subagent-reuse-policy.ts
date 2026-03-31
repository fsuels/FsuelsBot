import type { SubagentTaskType } from "./subagent-task-spec.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type WorkerReuseRelation = "same_slice" | "loosely_related" | "unrelated";

export type WorkerReuseDecisionAction = "continue_existing" | "spawn_fresh";

export type WorkerReuseDecisionReason =
  | "no_existing_worker"
  | "verification_requires_independence"
  | "correction_prefers_same_worker"
  | "approach_changed"
  | "same_slice"
  | "file_overlap"
  | "loosely_related"
  | "unrelated";

export type WorkerReuseDecision = {
  action: WorkerReuseDecisionAction;
  reasonCode: WorkerReuseDecisionReason;
  reason: string;
  overlappingFiles: string[];
};

const log = createSubsystemLogger("agents/subagent-reuse");

function normalizeTextList(value?: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((entry) => entry.trim()).filter(Boolean)));
}

function intersect(left?: string[], right?: string[]): string[] {
  const leftSet = new Set(normalizeTextList(left));
  return normalizeTextList(right).filter((entry) => leftSet.has(entry));
}

function finalizeDecision(
  input: Omit<WorkerReuseDecision, "overlappingFiles"> & { overlappingFiles?: string[] },
): WorkerReuseDecision {
  const decision = {
    ...input,
    overlappingFiles: normalizeTextList(input.overlappingFiles),
  };
  log.debug("subagent reuse decision", {
    action: decision.action,
    reasonCode: decision.reasonCode,
    overlappingFiles: decision.overlappingFiles,
  });
  return decision;
}

export function decideWorkerReuse(params: {
  currentWorkerRunId?: string;
  targetAuthorRunId?: string;
  nextTaskType?: SubagentTaskType;
  currentFilePaths?: string[];
  nextFilePaths?: string[];
  relation?: WorkerReuseRelation;
  changeApproach?: boolean;
}): WorkerReuseDecision {
  const overlappingFiles = intersect(params.currentFilePaths, params.nextFilePaths);

  if (!params.currentWorkerRunId) {
    return finalizeDecision({
      action: "spawn_fresh",
      reasonCode: "no_existing_worker",
      reason: "No current worker exists for continuation, so a fresh worker is required.",
      overlappingFiles,
    });
  }

  if (params.nextTaskType === "verification") {
    return finalizeDecision({
      action: "spawn_fresh",
      reasonCode: "verification_requires_independence",
      reason:
        "Verification should run in a fresh worker that did not author the implementation work.",
      overlappingFiles,
    });
  }

  if (params.changeApproach) {
    return finalizeDecision({
      action: "spawn_fresh",
      reasonCode: "approach_changed",
      reason: "The next task changes approach entirely, so a fresh worker is safer.",
      overlappingFiles,
    });
  }

  if (
    params.nextTaskType === "correction" &&
    params.targetAuthorRunId &&
    params.targetAuthorRunId === params.currentWorkerRunId
  ) {
    return finalizeDecision({
      action: "continue_existing",
      reasonCode: "correction_prefers_same_worker",
      reason: "Corrections should continue in the worker that produced the failing attempt.",
      overlappingFiles,
    });
  }

  if (params.relation === "same_slice") {
    return finalizeDecision({
      action: "continue_existing",
      reasonCode: "same_slice",
      reason:
        "The next task stays on the same code slice, so continuing the current worker is preferred.",
      overlappingFiles,
    });
  }

  if (overlappingFiles.length > 0) {
    return finalizeDecision({
      action: "continue_existing",
      reasonCode: "file_overlap",
      reason: "The next task extends recent work on overlapping files, so continuing is preferred.",
      overlappingFiles,
    });
  }

  if (params.relation === "loosely_related") {
    return finalizeDecision({
      action: "spawn_fresh",
      reasonCode: "loosely_related",
      reason:
        "The next task is only loosely related to the current worker's context, so a fresh worker is preferred.",
      overlappingFiles,
    });
  }

  if (params.relation === "unrelated") {
    return finalizeDecision({
      action: "spawn_fresh",
      reasonCode: "unrelated",
      reason: "The next task is unrelated to the current worker's context, so use a fresh worker.",
      overlappingFiles,
    });
  }

  return finalizeDecision({
    action: "continue_existing",
    reasonCode: "same_slice",
    reason:
      "The next task still appears to be part of the same worker thread, so continuation is acceptable.",
    overlappingFiles,
  });
}
