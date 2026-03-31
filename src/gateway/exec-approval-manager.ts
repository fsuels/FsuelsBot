import { randomUUID } from "node:crypto";
import type { ExecApprovalDecision } from "../infra/exec-approvals.js";

export type ExecApprovalRequestPayload = {
  command: string;
  cwd?: string | null;
  host?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
};

export type ExecApprovalRecord = {
  id: string;
  request: ExecApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  decision?: ExecApprovalDecision;
  resolvedBy?: string | null;
};

type PendingEntry = {
  record: ExecApprovalRecord;
  resolve: (decision: ExecApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RecentTerminalEntry = {
  id: string;
  decision: ExecApprovalDecision | null;
  terminalState: "resolved" | "expired";
  resolvedAtMs: number;
  resolvedBy?: string | null;
};

export type ExecApprovalResolveResult =
  | {
      status: "resolved";
      record: ExecApprovalRecord;
    }
  | {
      status: "ignored";
      record: RecentTerminalEntry;
    }
  | {
      status: "unknown";
    };

const RECENT_TERMINAL_MAX = 1_000;

export class ExecApprovalManager {
  private pending = new Map<string, PendingEntry>();
  private recentTerminal = new Map<string, RecentTerminalEntry>();

  create(
    request: ExecApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): ExecApprovalRecord {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    const record: ExecApprovalRecord = {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
    return record;
  }

  async waitForDecision(
    record: ExecApprovalRecord,
    timeoutMs: number,
  ): Promise<ExecApprovalDecision | null> {
    return await new Promise<ExecApprovalDecision | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(record.id);
        this.rememberTerminal({
          id: record.id,
          decision: null,
          terminalState: "expired",
          resolvedAtMs: Date.now(),
        });
        resolve(null);
      }, timeoutMs);
      this.pending.set(record.id, { record, resolve, reject, timer });
    });
  }

  resolve(
    recordId: string,
    decision: ExecApprovalDecision,
    resolvedBy?: string | null,
  ): ExecApprovalResolveResult {
    const pending = this.pending.get(recordId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.record.resolvedAtMs = Date.now();
      pending.record.decision = decision;
      pending.record.resolvedBy = resolvedBy ?? null;
      this.pending.delete(recordId);
      this.rememberTerminal({
        id: recordId,
        decision,
        terminalState: "resolved",
        resolvedAtMs: pending.record.resolvedAtMs,
        resolvedBy: pending.record.resolvedBy,
      });
      pending.resolve(decision);
      return {
        status: "resolved",
        record: pending.record,
      };
    }
    const recent = this.recentTerminal.get(recordId);
    if (recent) {
      return {
        status: "ignored",
        record: recent,
      };
    }
    return { status: "unknown" };
  }

  getSnapshot(recordId: string): ExecApprovalRecord | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }

  hasRecent(recordId: string): boolean {
    return this.recentTerminal.has(recordId);
  }

  private rememberTerminal(entry: RecentTerminalEntry): void {
    this.recentTerminal.delete(entry.id);
    this.recentTerminal.set(entry.id, entry);
    if (this.recentTerminal.size <= RECENT_TERMINAL_MAX) {
      return;
    }
    const oldestKey = this.recentTerminal.keys().next().value;
    if (typeof oldestKey === "string") {
      this.recentTerminal.delete(oldestKey);
    }
  }
}
