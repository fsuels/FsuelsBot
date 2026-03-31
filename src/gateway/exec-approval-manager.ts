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
  promise: Promise<ExecApprovalDecision | null>;
  resolve: (decision: ExecApprovalDecision | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RecentTerminalEntry = {
  id: string;
  record: ExecApprovalRecord;
  decision: ExecApprovalDecision | null;
  terminalState: "resolved" | "expired";
  resolvedAtMs: number;
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
    return this.register(record, timeoutMs);
  }

  register(record: ExecApprovalRecord, timeoutMs: number): Promise<ExecApprovalDecision | null> {
    if (this.pending.has(record.id)) {
      throw new Error(`approval id already pending: ${record.id}`);
    }
    if (this.recentTerminal.has(record.id)) {
      throw new Error(`approval id already used recently: ${record.id}`);
    }

    let resolvePromise!: (decision: ExecApprovalDecision | null) => void;
    const promise = new Promise<ExecApprovalDecision | null>((resolve) => {
      resolvePromise = resolve;
    });
    const timer = setTimeout(() => {
      const pending = this.pending.get(record.id);
      if (!pending) {
        return;
      }
      this.pending.delete(record.id);
      pending.record.resolvedAtMs = Date.now();
      pending.record.resolvedBy = null;
      this.rememberTerminal({
        id: record.id,
        record: pending.record,
        decision: null,
        terminalState: "expired",
        resolvedAtMs: pending.record.resolvedAtMs,
      });
      pending.resolve(null);
    }, timeoutMs);
    this.pending.set(record.id, { record, promise, resolve: resolvePromise, timer });
    return promise;
  }

  awaitDecision(
    recordId: string,
  ): { record: ExecApprovalRecord; promise: Promise<ExecApprovalDecision | null> } | null {
    const pending = this.pending.get(recordId);
    if (pending) {
      return { record: pending.record, promise: pending.promise };
    }
    const recent = this.recentTerminal.get(recordId);
    if (!recent) {
      return null;
    }
    return {
      record: recent.record,
      promise: Promise.resolve(recent.decision),
    };
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
        record: pending.record,
        decision,
        terminalState: "resolved",
        resolvedAtMs: pending.record.resolvedAtMs,
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

  clearAll(): number {
    const clearedPending = this.pending.size;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pending.clear();
    this.recentTerminal.clear();
    return clearedPending;
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
