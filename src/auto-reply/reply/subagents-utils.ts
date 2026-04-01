import {
  type SubagentRunRecord,
  resolveSubagentLifecycleStatus,
} from "../../agents/subagent-registry.js";
import { truncateUtf16Safe } from "../../utils.js";

export function resolveSubagentLabel(entry: SubagentRunRecord, fallback = "subagent") {
  const raw = entry.label?.trim() || entry.task?.trim() || "";
  return raw || fallback;
}

export function formatRunLabel(entry: SubagentRunRecord, options?: { maxLength?: number }) {
  const raw = resolveSubagentLabel(entry);
  const maxLength = options?.maxLength ?? 72;
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return raw;
  }
  return raw.length > maxLength ? `${truncateUtf16Safe(raw, maxLength).trimEnd()}…` : raw;
}

export function formatRunStatus(entry: SubagentRunRecord) {
  const status = resolveSubagentLifecycleStatus(entry);
  if (status === "queued") {
    return "queued";
  }
  if (status === "running") {
    return "running";
  }
  if (entry.cleanupState === "blocked") {
    return "cleanup-blocked";
  }
  if (entry.cleanupState === "failed") {
    return "cleanup-failed";
  }
  if (status === "completed") {
    return "done";
  }
  if (status === "failed") {
    return "error";
  }
  return status;
}

export function sortSubagentRuns(runs: SubagentRunRecord[]) {
  return [...runs].toSorted((a, b) => {
    const aTime = a.startedAt ?? a.createdAt ?? 0;
    const bTime = b.startedAt ?? b.createdAt ?? 0;
    return bTime - aTime;
  });
}
