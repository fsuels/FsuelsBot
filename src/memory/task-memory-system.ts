import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { emitDiagnosticEvent } from "../infra/diagnostic-events.js";
import { ensureDir } from "./internal.js";
import { normalizeMemoryTaskId } from "./namespaces.js";

export type TaskRegistryStatus = "active" | "suspended" | "archived" | "closed";

export type TaskRegistryRecord = {
  taskId: string;
  title: string;
  status: TaskRegistryStatus;
  createdAt: number;
  lastTouchedAt: number;
  links: string[];
  pinSetId: string;
  schemaVersion: number;
  deadline?: number;
};

type TaskRegistryStore = {
  version: 1;
  updatedAt: number;
  tasks: TaskRegistryRecord[];
};

export type MemoryScope = "global" | "task";

export type MemoryEventType =
  | "TASK_CREATED"
  | "TITLE_SET"
  | "GOAL_SET"
  | "DECISION_MADE"
  | "DECISION_REVERTED"
  | "CONSTRAINT_ADDED"
  | "CONSTRAINT_REMOVED"
  | "OPEN_QUESTION_ADDED"
  | "OPEN_QUESTION_RESOLVED"
  | "NEXT_ACTION_SET"
  | "NEXT_ACTION_COMPLETED"
  | "ARTIFACT_LINKED"
  | "PIN_ADDED"
  | "PIN_REMOVE_REQUESTED"
  | "PIN_REMOVED"
  | "STATE_PATCH_APPLIED"
  | "USER_CONFIRMED"
  | "GOAL_PUSHED"
  | "GOAL_POPPED"
  | "BLOCKER_ADDED"
  | "BLOCKER_RESOLVED"
  | "GOAL_PROGRESS_MARKED";

export type MemoryEventActor = "user" | "agent" | "system";

export type MemoryEventRecord = {
  eventId: string;
  scope: MemoryScope;
  taskId?: string;
  type: MemoryEventType;
  payload: Record<string, unknown>;
  timestamp: number;
  actor: MemoryEventActor;
  envelopeVersion?: number;
  signatureVersion?: number;
  keyId?: string;
  prevSignature?: string;
  signature?: string;
  integrityHash?: string;
};

export type CanonicalMemoryState = {
  title?: string;
  status?: TaskRegistryStatus;
  goal?: string;
  decisions: string[];
  constraints: string[];
  openQuestions: string[];
  nextAction?: string;
  artifacts: string[];
  pins: string[];
  links: string[];
  lastConfirmedAt?: number;
  goalStack?: string[];
  blockers?: string[];
  goalLastProgressAt?: number;
};

export type MemorySnapshotRecord = {
  snapshotId: string;
  scope: MemoryScope;
  taskId?: string;
  eventOffset: number;
  state: CanonicalMemoryState;
  updatedAt: number;
};

export type TransientBufferItem = {
  itemId: string;
  content: string;
  ttlExpiresAt: number;
  relatedTaskId?: string;
};

type TransientBufferStore = {
  version: 1;
  updatedAt: number;
  items: TransientBufferItem[];
};

export type MemoryWriteScope = "none" | "global" | "task";

const TASK_REGISTRY_REL_PATH = "memory/system/task-registry.json";
const WAL_REL_PATH = "memory/system/events.wal.jsonl";
const WAL_LOCK_REL_PATH = "memory/system/events.wal.lock";
const WAL_SEGMENTS_REL_DIR = "memory/system/wal/segments";
const WAL_MANIFEST_REL_PATH = "memory/system/wal/manifest.json";
const WAL_BASELINE_REL_PATH = "memory/system/wal/baseline.json";
const GLOBAL_SNAPSHOT_REL_PATH = "memory/system/snapshots/global.json";
const TASK_SNAPSHOTS_REL_DIR = "memory/system/snapshots/tasks";
const TRANSIENT_BUFFER_REL_PATH = "memory/system/transient-buffer.json";
const MEMORY_ENVELOPE_VERSION = 1;
const MEMORY_SIGNATURE_VERSION = 1;
const WAL_BASELINE_ENVELOPE_VERSION = 1;
const WAL_BASELINE_SIGNATURE_VERSION = 1;

type WalTailStopReason = "invalid-json" | "invalid-record" | "integrity-mismatch";
type WalSecurityStopReason =
  | "unsupported-envelope-version"
  | "unsupported-signature-version"
  | "missing-signature"
  | "missing-key"
  | "prev-signature-mismatch"
  | "signature-mismatch"
  | "schema-validation-failure";
type WalStopReason = WalTailStopReason | WalSecurityStopReason;

type WalSegmentManifestEntry = {
  seq: number;
  file: string;
  archivedAt: number;
  eventCount: number;
  startSignature?: string;
  endSignature?: string;
  startPrevSignature?: string | null;
  endEventId?: string;
};

type WalManifestStore = {
  version: 1;
  updatedAt: number;
  activeCreatedAt: number;
  nextSequence: number;
  segments: WalSegmentManifestEntry[];
};

type WalBaselineStore = {
  version: 1;
  updatedAt: number;
  endSequence: number;
  endSignature?: string;
  envelopeVersion?: number;
  signatureVersion?: number;
  keyId?: string;
  signature?: string;
  globalState: CanonicalMemoryState;
  taskStates: Record<string, CanonicalMemoryState>;
};

export type WalReadDiagnostics = {
  truncatedTail: boolean;
  stopReason?: WalStopReason;
  stoppedAtLine?: number;
  droppedLineCount: number;
  securityBypassApplied?: boolean;
  securityBypassReason?: WalSecurityStopReason;
};

const EVENT_TYPE_SET = new Set<MemoryEventType>([
  "TASK_CREATED",
  "TITLE_SET",
  "GOAL_SET",
  "DECISION_MADE",
  "DECISION_REVERTED",
  "CONSTRAINT_ADDED",
  "CONSTRAINT_REMOVED",
  "OPEN_QUESTION_ADDED",
  "OPEN_QUESTION_RESOLVED",
  "NEXT_ACTION_SET",
  "NEXT_ACTION_COMPLETED",
  "ARTIFACT_LINKED",
  "PIN_ADDED",
  "PIN_REMOVE_REQUESTED",
  "PIN_REMOVED",
  "STATE_PATCH_APPLIED",
  "USER_CONFIRMED",
  "GOAL_PUSHED",
  "GOAL_POPPED",
  "BLOCKER_ADDED",
  "BLOCKER_RESOLVED",
  "GOAL_PROGRESS_MARKED",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validateEventPayloadSchema(type: MemoryEventType, payload: unknown): string | null {
  if (!isPlainObject(payload)) {
    return "payload must be an object";
  }
  const p = payload;
  switch (type) {
    case "TASK_CREATED":
      if (!readRequiredString(p, "taskId")) {
        return "TASK_CREATED.taskId required";
      }
      if (!readRequiredString(p, "title")) {
        return "TASK_CREATED.title required";
      }
      return null;
    case "TITLE_SET":
      return readRequiredString(p, "title") ? null : "TITLE_SET.title required";
    case "GOAL_SET":
      return readRequiredString(p, "goal") ? null : "GOAL_SET.goal required";
    case "DECISION_MADE":
    case "DECISION_REVERTED":
      return readRequiredString(p, "decision") ? null : `${type}.decision required`;
    case "CONSTRAINT_ADDED":
    case "CONSTRAINT_REMOVED":
      return readRequiredString(p, "constraint") ? null : `${type}.constraint required`;
    case "OPEN_QUESTION_ADDED":
    case "OPEN_QUESTION_RESOLVED":
      return readRequiredString(p, "question") ? null : `${type}.question required`;
    case "NEXT_ACTION_SET":
      return readRequiredString(p, "action") ? null : "NEXT_ACTION_SET.action required";
    case "NEXT_ACTION_COMPLETED":
      // action is optional to clear current nextAction.
      if (p.action != null && !readOptionalString(p, "action")) {
        return "NEXT_ACTION_COMPLETED.action must be string when provided";
      }
      return null;
    case "ARTIFACT_LINKED":
      return readRequiredString(p, "artifact") ? null : "ARTIFACT_LINKED.artifact required";
    case "PIN_ADDED":
      return readRequiredString(p, "pinId") ? null : "PIN_ADDED.pinId required";
    case "PIN_REMOVE_REQUESTED":
    case "PIN_REMOVED":
      return readRequiredString(p, "pinId") ? null : `${type}.pinId required`;
    case "STATE_PATCH_APPLIED": {
      const patch = p.patch;
      if (!isPlainObject(patch)) {
        return "STATE_PATCH_APPLIED.patch object required";
      }
      return null;
    }
    case "USER_CONFIRMED":
      if (p.source != null && !readOptionalString(p, "source")) {
        return "USER_CONFIRMED.source must be string when provided";
      }
      return null;
    case "GOAL_PUSHED":
      return readRequiredString(p, "goal") ? null : "GOAL_PUSHED.goal required";
    case "GOAL_POPPED":
      // No required payload — pops the top of the goal stack
      return null;
    case "BLOCKER_ADDED":
      return readRequiredString(p, "blocker") ? null : "BLOCKER_ADDED.blocker required";
    case "BLOCKER_RESOLVED":
      return readRequiredString(p, "blocker") ? null : "BLOCKER_RESOLVED.blocker required";
    case "GOAL_PROGRESS_MARKED":
      // No required payload — marks timestamp of progress
      return null;
  }
  const unreachable: never = type;
  void unreachable;
  return "unsupported payload schema";
}

function defaultTaskRegistryStore(): TaskRegistryStore {
  return {
    version: 1,
    updatedAt: Date.now(),
    tasks: [],
  };
}

function defaultCanonicalState(): CanonicalMemoryState {
  return {
    decisions: [],
    constraints: [],
    openQuestions: [],
    artifacts: [],
    pins: [],
    links: [],
    goalStack: [],
    blockers: [],
  };
}

function defaultTransientBufferStore(): TransientBufferStore {
  return {
    version: 1,
    updatedAt: Date.now(),
    items: [],
  };
}

function defaultWalManifestStore(now = Date.now()): WalManifestStore {
  return {
    version: 1,
    updatedAt: now,
    activeCreatedAt: now,
    nextSequence: 1,
    segments: [],
  };
}

function defaultWalBaselineStore(now = Date.now()): WalBaselineStore {
  return {
    version: 1,
    updatedAt: now,
    endSequence: 0,
    globalState: defaultCanonicalState(),
    taskStates: {},
  };
}

type WalLifecycleConfig = {
  segmentMaxBytes: number;
  segmentMaxAgeMs: number;
  retentionDays: number;
};

function resolveWalLifecycleConfig(): WalLifecycleConfig {
  const segmentMaxBytesRaw = Number(process.env.MEMORY_WAL_SEGMENT_MAX_BYTES ?? 5 * 1024 * 1024);
  const segmentMaxAgeDaysRaw = Number(process.env.MEMORY_WAL_SEGMENT_MAX_AGE_DAYS ?? 1);
  const retentionDaysRaw = Number(process.env.MEMORY_WAL_RETENTION_DAYS ?? 36500);
  const segmentMaxBytes = Number.isFinite(segmentMaxBytesRaw)
    ? Math.max(64 * 1024, Math.floor(segmentMaxBytesRaw))
    : 5 * 1024 * 1024;
  const segmentMaxAgeMs = Number.isFinite(segmentMaxAgeDaysRaw)
    ? Math.max(60_000, Math.floor(segmentMaxAgeDaysRaw * 24 * 60 * 60 * 1000))
    : 24 * 60 * 60 * 1000;
  const retentionDays = Number.isFinite(retentionDaysRaw)
    ? Math.max(1, Math.floor(retentionDaysRaw))
    : 36500;
  return {
    segmentMaxBytes,
    segmentMaxAgeMs,
    retentionDays,
  };
}

type MemorySecurityMode = "prod" | "dev";

type MemorySecurityConfig = {
  mode: MemorySecurityMode;
  allowUnsignedReplay: boolean;
  keyProvider: "env" | "json" | "command" | "aws-sm" | "gcp-sm" | "azure-kv" | "vault";
  activeSigningKeyId?: string;
  activeSigningKey?: string;
  verificationKeys: Map<string, string>;
  keyRotationDeprecationDays: number;
  keyRotationStartedAt?: number;
  allowedLegacyKeyIds: Set<string>;
};

type MemoryKeyProvider = {
  id: "env" | "json" | "command" | "aws-sm" | "gcp-sm" | "azure-kv" | "vault";
  resolve: () => {
    activeSigningKeyId?: string;
    activeSigningKey?: string;
    verificationKeys: Map<string, string>;
  };
};

type SignedWalEnvelope = {
  envelopeVersion: typeof MEMORY_ENVELOPE_VERSION;
  eventId: string;
  scope: MemoryScope;
  taskId: string | null;
  type: MemoryEventType;
  payload: Record<string, unknown>;
  timestamp: string;
  actor: MemoryEventActor;
  prevSignature: string | null;
};

type SignedWalBaselineEnvelope = {
  envelopeVersion: typeof WAL_BASELINE_ENVELOPE_VERSION;
  endSequence: number;
  endSignature: string | null;
  globalState: CanonicalMemoryState;
  taskStates: Record<string, CanonicalMemoryState>;
};

let invalidSecurityModeReported = false;
let invalidKeyProviderReported = false;

function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "null";
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeJson(entry)}`)
      .join(",")}}`;
  }
  return "null";
}

function canonicalTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    throw new Error(`invalid event timestamp: ${String(timestamp)}`);
  }
  return new Date(Math.floor(timestamp)).toISOString();
}

function isValidKeyId(keyId: string): boolean {
  return /^[a-z0-9._-]+(?::[a-z0-9._-]+){2,}$/i.test(keyId);
}

function parseResolvedKeyRingPayload(payload: unknown): {
  activeSigningKeyId?: string;
  activeSigningKey?: string;
  verificationKeys: Map<string, string>;
} {
  const verificationKeys = new Map<string, string>();
  const parsed = payload as {
    activeSigningKeyId?: string;
    activeSigningKey?: string;
    verificationKeys?: Record<string, unknown>;
  };
  const activeSigningKeyId = String(parsed.activeSigningKeyId ?? "").trim();
  const activeSigningKey = String(parsed.activeSigningKey ?? "").trim();
  if (parsed.verificationKeys && typeof parsed.verificationKeys === "object") {
    for (const [keyId, value] of Object.entries(parsed.verificationKeys)) {
      const normalizedKeyId = keyId.trim();
      const secret = typeof value === "string" ? value.trim() : "";
      if (normalizedKeyId && secret && isValidKeyId(normalizedKeyId)) {
        verificationKeys.set(normalizedKeyId, secret);
      }
    }
  }
  if (activeSigningKeyId && activeSigningKey && isValidKeyId(activeSigningKeyId)) {
    verificationKeys.set(activeSigningKeyId, activeSigningKey);
  }
  return {
    ...(activeSigningKeyId ? { activeSigningKeyId } : {}),
    ...(activeSigningKey ? { activeSigningKey } : {}),
    verificationKeys,
  };
}

function resolveProviderCommandTimeoutMs(): number {
  const timeoutMsRaw = Number(
    process.env.MEMORY_WAL_KEY_PROVIDER_COMMAND_TIMEOUT_MS ??
      process.env.MEMORY_WAL_KEY_PROVIDER_TIMEOUT_MS ??
      5_000,
  );
  return Number.isFinite(timeoutMsRaw) ? Math.max(500, Math.floor(timeoutMsRaw)) : 5_000;
}

function runShellCommand(command: string, timeoutMs: number): string {
  const child = spawnSync(command, [], {
    shell: true,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  if (child.error) {
    throw child.error;
  }
  if (typeof child.status === "number" && child.status !== 0) {
    throw new Error(`command exited with status ${child.status}: ${(child.stderr ?? "").trim()}`);
  }
  return String(child.stdout ?? "").trim();
}

function runCommandWithArgs(executable: string, args: string[], timeoutMs: number): string {
  const child = spawnSync(executable, args, {
    shell: false,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  if (child.error) {
    throw child.error;
  }
  if (typeof child.status === "number" && child.status !== 0) {
    throw new Error(
      `command failed (${executable}) status=${child.status}: ${(child.stderr ?? "").trim()}`,
    );
  }
  return String(child.stdout ?? "").trim();
}

function resolveKeyRingPayloadFromString(raw: string): {
  activeSigningKeyId?: string;
  activeSigningKey?: string;
  verificationKeys: Map<string, string>;
} {
  if (!raw.trim()) {
    return { verificationKeys: new Map<string, string>() };
  }
  const parsed = JSON.parse(raw) as unknown;
  return parseResolvedKeyRingPayload(parsed);
}

function createEnvMemoryKeyProvider(): MemoryKeyProvider {
  return {
    id: "env",
    resolve: () => {
      const activeSigningKey = String(
        process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY ?? process.env.MEMORY_WAL_ACTIVE_KEY ?? "",
      ).trim();
      const activeSigningKeyId = String(
        process.env.MEMORY_WAL_ACTIVE_SIGNING_KEY_ID ?? process.env.MEMORY_WAL_ACTIVE_KEY_ID ?? "",
      ).trim();
      const verificationKeys = new Map<string, string>();
      const verificationKeysJson = String(
        process.env.MEMORY_WAL_VERIFICATION_KEYS_JSON ?? "",
      ).trim();
      if (verificationKeysJson) {
        try {
          const parsed = JSON.parse(verificationKeysJson) as Record<string, unknown>;
          for (const [keyId, value] of Object.entries(parsed)) {
            const secret = typeof value === "string" ? value.trim() : "";
            const normalizedKeyId = keyId.trim();
            if (normalizedKeyId && secret && isValidKeyId(normalizedKeyId)) {
              verificationKeys.set(normalizedKeyId, secret);
            }
          }
        } catch {
          // ignore malformed map; explicit key checks fail closed.
        }
      }

      const resolvedActiveKeyId =
        activeSigningKeyId || (activeSigningKey ? "env:memory-wal:1" : "");
      if (resolvedActiveKeyId && activeSigningKey && isValidKeyId(resolvedActiveKeyId)) {
        verificationKeys.set(resolvedActiveKeyId, activeSigningKey);
      }
      return {
        ...(resolvedActiveKeyId ? { activeSigningKeyId: resolvedActiveKeyId } : {}),
        ...(activeSigningKey ? { activeSigningKey: activeSigningKey } : {}),
        verificationKeys,
      };
    },
  };
}

function createJsonMemoryKeyProvider(): MemoryKeyProvider {
  return {
    id: "json",
    resolve: () => {
      const raw = String(process.env.MEMORY_WAL_KEYRING_JSON ?? "").trim();
      if (!raw) {
        return { verificationKeys: new Map<string, string>() };
      }
      try {
        return resolveKeyRingPayloadFromString(raw);
      } catch {
        return { verificationKeys: new Map<string, string>() };
      }
    },
  };
}

function createCommandMemoryKeyProvider(): MemoryKeyProvider {
  return {
    id: "command",
    resolve: () => {
      const command = String(process.env.MEMORY_WAL_KEY_PROVIDER_COMMAND ?? "").trim();
      const timeoutMs = resolveProviderCommandTimeoutMs();
      if (!command) {
        return { verificationKeys: new Map<string, string>() };
      }
      try {
        const raw = runShellCommand(command, timeoutMs);
        return resolveKeyRingPayloadFromString(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emitMemorySecurityDiagnostic({
          severity: "ERROR",
          code: "key-provider-failure",
          detail: `command key provider failed: ${detail}`,
        });
        return { verificationKeys: new Map<string, string>() };
      }
    },
  };
}

function createAwsSecretsManagerKeyProvider(): MemoryKeyProvider {
  return {
    id: "aws-sm",
    resolve: () => {
      const timeoutMs = resolveProviderCommandTimeoutMs();
      const commandOverride = String(process.env.MEMORY_WAL_AWS_SECRET_COMMAND ?? "").trim();
      try {
        const raw = (() => {
          if (commandOverride) {
            return runShellCommand(commandOverride, timeoutMs);
          }
          const secretId = String(process.env.MEMORY_WAL_AWS_SECRET_ID ?? "").trim();
          if (!secretId) {
            return "";
          }
          const cli = String(process.env.MEMORY_WAL_AWS_CLI ?? "aws").trim() || "aws";
          return runCommandWithArgs(
            cli,
            [
              "secretsmanager",
              "get-secret-value",
              "--secret-id",
              secretId,
              "--query",
              "SecretString",
              "--output",
              "text",
            ],
            timeoutMs,
          );
        })();
        return resolveKeyRingPayloadFromString(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emitMemorySecurityDiagnostic({
          severity: "ERROR",
          code: "key-provider-failure",
          detail: `aws-sm key provider failed: ${detail}`,
        });
        return { verificationKeys: new Map<string, string>() };
      }
    },
  };
}

function createGcpSecretManagerKeyProvider(): MemoryKeyProvider {
  return {
    id: "gcp-sm",
    resolve: () => {
      const timeoutMs = resolveProviderCommandTimeoutMs();
      const commandOverride = String(process.env.MEMORY_WAL_GCP_SECRET_COMMAND ?? "").trim();
      try {
        const raw = (() => {
          if (commandOverride) {
            return runShellCommand(commandOverride, timeoutMs);
          }
          const secretName = String(process.env.MEMORY_WAL_GCP_SECRET_NAME ?? "").trim();
          if (!secretName) {
            return "";
          }
          const version =
            String(process.env.MEMORY_WAL_GCP_SECRET_VERSION ?? "latest").trim() || "latest";
          const cli = String(process.env.MEMORY_WAL_GCP_CLI ?? "gcloud").trim() || "gcloud";
          return runCommandWithArgs(
            cli,
            ["secrets", "versions", "access", version, "--secret", secretName],
            timeoutMs,
          );
        })();
        return resolveKeyRingPayloadFromString(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emitMemorySecurityDiagnostic({
          severity: "ERROR",
          code: "key-provider-failure",
          detail: `gcp-sm key provider failed: ${detail}`,
        });
        return { verificationKeys: new Map<string, string>() };
      }
    },
  };
}

function createAzureKeyVaultKeyProvider(): MemoryKeyProvider {
  return {
    id: "azure-kv",
    resolve: () => {
      const timeoutMs = resolveProviderCommandTimeoutMs();
      const commandOverride = String(process.env.MEMORY_WAL_AZURE_SECRET_COMMAND ?? "").trim();
      try {
        const raw = (() => {
          if (commandOverride) {
            return runShellCommand(commandOverride, timeoutMs);
          }
          const vaultName = String(process.env.MEMORY_WAL_AZURE_VAULT_NAME ?? "").trim();
          const secretName = String(process.env.MEMORY_WAL_AZURE_SECRET_NAME ?? "").trim();
          if (!vaultName || !secretName) {
            return "";
          }
          const cli = String(process.env.MEMORY_WAL_AZURE_CLI ?? "az").trim() || "az";
          return runCommandWithArgs(
            cli,
            [
              "keyvault",
              "secret",
              "show",
              "--vault-name",
              vaultName,
              "--name",
              secretName,
              "--query",
              "value",
              "-o",
              "tsv",
            ],
            timeoutMs,
          );
        })();
        return resolveKeyRingPayloadFromString(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emitMemorySecurityDiagnostic({
          severity: "ERROR",
          code: "key-provider-failure",
          detail: `azure-kv key provider failed: ${detail}`,
        });
        return { verificationKeys: new Map<string, string>() };
      }
    },
  };
}

function createVaultKeyProvider(): MemoryKeyProvider {
  return {
    id: "vault",
    resolve: () => {
      const timeoutMs = resolveProviderCommandTimeoutMs();
      const commandOverride = String(process.env.MEMORY_WAL_VAULT_SECRET_COMMAND ?? "").trim();
      try {
        const raw = (() => {
          if (commandOverride) {
            return runShellCommand(commandOverride, timeoutMs);
          }
          const secretPath = String(process.env.MEMORY_WAL_VAULT_SECRET_PATH ?? "").trim();
          if (!secretPath) {
            return "";
          }
          const cli = String(process.env.MEMORY_WAL_VAULT_CLI ?? "vault").trim() || "vault";
          const kvVersion = String(process.env.MEMORY_WAL_VAULT_KV_VERSION ?? "2").trim();
          const args =
            kvVersion === "1"
              ? ["kv", "get", "-format=json", secretPath]
              : ["kv", "get", "-mount", "secret", "-format=json", secretPath];
          const json = runCommandWithArgs(cli, args, timeoutMs);
          const parsed = JSON.parse(json) as { data?: Record<string, unknown> };
          const data = parsed.data ?? {};
          const nested = (data.data as Record<string, unknown> | undefined) ?? data;
          return JSON.stringify(nested);
        })();
        return resolveKeyRingPayloadFromString(raw);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        emitMemorySecurityDiagnostic({
          severity: "ERROR",
          code: "key-provider-failure",
          detail: `vault key provider failed: ${detail}`,
        });
        return { verificationKeys: new Map<string, string>() };
      }
    },
  };
}

function resolveMemoryKeyProvider(): MemoryKeyProvider {
  const raw = String(process.env.MEMORY_WAL_KEY_PROVIDER ?? "env")
    .trim()
    .toLowerCase();
  if (raw === "json") {
    return createJsonMemoryKeyProvider();
  }
  if (raw === "command") {
    return createCommandMemoryKeyProvider();
  }
  if (raw === "aws-sm") {
    return createAwsSecretsManagerKeyProvider();
  }
  if (raw === "gcp-sm") {
    return createGcpSecretManagerKeyProvider();
  }
  if (raw === "azure-kv") {
    return createAzureKeyVaultKeyProvider();
  }
  if (raw === "vault") {
    return createVaultKeyProvider();
  }
  if (raw !== "env" && !invalidKeyProviderReported) {
    invalidKeyProviderReported = true;
    // eslint-disable-next-line no-console
    console.error(`[memory-security] invalid MEMORY_WAL_KEY_PROVIDER=${raw}; coercing to env`);
  }
  return createEnvMemoryKeyProvider();
}

function resolveMemorySecurityConfig(): MemorySecurityConfig {
  const rawMode = String(process.env.MEMORY_SECURITY_MODE ?? "prod")
    .trim()
    .toLowerCase();
  let mode: MemorySecurityMode;
  if (rawMode === "dev") {
    mode = "dev";
  } else {
    mode = "prod";
    if (rawMode !== "prod" && rawMode !== "" && !invalidSecurityModeReported) {
      invalidSecurityModeReported = true;
      emitMemorySecurityDiagnostic({
        severity: "ERROR",
        code: "invalid-security-mode",
        detail: `invalid MEMORY_SECURITY_MODE=${rawMode}; coercing to prod`,
        mode: "prod",
      });
      // eslint-disable-next-line no-console
      console.error(`[memory-security] invalid MEMORY_SECURITY_MODE=${rawMode}; coercing to prod`);
    }
  }
  const allowUnsignedReplay =
    String(process.env.MEMORY_ALLOW_UNSIGNED_REPLAY ?? "")
      .trim()
      .toLowerCase() === "true";
  const keyRotationDeprecationDaysRaw = Number(
    process.env.MEMORY_WAL_KEY_ROTATION_DEPRECATION_DAYS ?? 30,
  );
  const keyRotationDeprecationDays = Number.isFinite(keyRotationDeprecationDaysRaw)
    ? Math.max(1, Math.floor(keyRotationDeprecationDaysRaw))
    : 30;
  const keyRotationStartedAtRaw = Number(process.env.MEMORY_WAL_KEY_ROTATION_STARTED_AT ?? "");
  const keyRotationStartedAt =
    Number.isFinite(keyRotationStartedAtRaw) && keyRotationStartedAtRaw > 0
      ? Math.floor(keyRotationStartedAtRaw)
      : undefined;
  const allowedLegacyKeyIds = new Set(
    String(process.env.MEMORY_WAL_ALLOWED_LEGACY_KEY_IDS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry && isValidKeyId(entry)),
  );
  const keyProvider = resolveMemoryKeyProvider();
  const resolved = keyProvider.resolve();

  return {
    mode,
    allowUnsignedReplay,
    keyProvider: keyProvider.id,
    keyRotationDeprecationDays,
    ...(keyRotationStartedAt ? { keyRotationStartedAt } : {}),
    allowedLegacyKeyIds,
    ...(resolved.activeSigningKeyId ? { activeSigningKeyId: resolved.activeSigningKeyId } : {}),
    ...(resolved.activeSigningKey ? { activeSigningKey: resolved.activeSigningKey } : {}),
    verificationKeys: resolved.verificationKeys,
  };
}

function resolveSigningCredentialsForWrite(config: MemorySecurityConfig): {
  keyId: string;
  secret: string;
} {
  const keyId = config.activeSigningKeyId?.trim() ?? "";
  const secret = config.activeSigningKey?.trim() ?? "";
  if (keyId && secret) {
    return { keyId, secret };
  }
  if (config.mode === "prod") {
    emitMemorySecurityDiagnostic({
      severity: "CRITICAL",
      code: "missing-signing-key",
      detail: "active signing key unavailable in prod mode",
      mode: config.mode,
    });
    throw new Error("memory wal signing key unavailable in prod mode");
  }
  emitMemorySecurityDiagnostic({
    severity: "ERROR",
    code: "missing-signing-key",
    detail: "active signing key unavailable in dev mode (read-only degraded)",
    mode: config.mode,
  });
  throw new Error("memory wal signing key unavailable in dev mode (read-only degraded)");
}

function emitMemorySecurityDiagnostic(params: {
  severity: "ERROR" | "CRITICAL";
  code:
    | "invalid-security-mode"
    | "key-provider-failure"
    | "missing-signing-key"
    | "missing-verification-key"
    | "key-rotation-expired"
    | "unsupported-envelope-version"
    | "schema-validation-failure"
    | "verification-failure";
  detail: string;
  mode?: MemorySecurityMode;
}): void {
  try {
    emitDiagnosticEvent({
      type: "memory.security",
      severity: params.severity,
      code: params.code,
      detail: params.detail,
      mode: params.mode,
    });
  } catch {
    // eslint-disable-next-line no-console
    console.error(`[memory-security][${params.severity}] ${params.code}: ${params.detail}`);
  }
}

function collectReferencedVerificationKeyIds(raw: string): Set<string> {
  const keyIds = new Set<string>();
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const keyId = typeof parsed.keyId === "string" ? parsed.keyId.trim() : "";
      if (keyId) {
        keyIds.add(keyId);
      }
    } catch {
      // ignore malformed rows; replay validation will fail independently.
    }
  }
  return keyIds;
}

function assertMemorySecurityBootContract(params: {
  security: MemorySecurityConfig;
  rawWal?: string;
}): void {
  const { security } = params;
  if (security.mode !== "prod") {
    return;
  }
  if (!security.activeSigningKeyId || !security.activeSigningKey) {
    emitMemorySecurityDiagnostic({
      severity: "CRITICAL",
      code: "missing-signing-key",
      detail: "active signing key unavailable in prod mode",
      mode: security.mode,
    });
    throw new Error("memory wal signing key unavailable in prod mode");
  }
  const referencedKeyIds = collectReferencedVerificationKeyIds(params.rawWal ?? "");
  for (const keyId of referencedKeyIds) {
    if (security.verificationKeys.has(keyId)) {
      continue;
    }
    emitMemorySecurityDiagnostic({
      severity: "CRITICAL",
      code: "missing-verification-key",
      detail: `verification key unavailable for keyId=${keyId}`,
      mode: security.mode,
    });
    throw new Error(`memory wal verification key unavailable in prod mode (${keyId})`);
  }
  const rotationStartedAt = security.keyRotationStartedAt;
  if (!rotationStartedAt) {
    return;
  }
  const rotationDeadlineMs =
    rotationStartedAt + security.keyRotationDeprecationDays * 24 * 60 * 60 * 1000;
  if (Date.now() <= rotationDeadlineMs) {
    return;
  }
  const activeKeyId = security.activeSigningKeyId?.trim() ?? "";
  if (!activeKeyId) {
    return;
  }
  const staleKeys = [...referencedKeyIds].filter(
    (keyId) => keyId !== activeKeyId && !security.allowedLegacyKeyIds.has(keyId),
  );
  if (staleKeys.length === 0) {
    return;
  }
  emitMemorySecurityDiagnostic({
    severity: "CRITICAL",
    code: "key-rotation-expired",
    detail: `legacy verification keys still required after deprecation window: ${staleKeys.join(", ")}`,
    mode: security.mode,
  });
  throw new Error(
    `memory wal key rotation deprecation expired; legacy keys still required (${staleKeys.join(", ")})`,
  );
}

function assertWalWritableFromDiagnostics(params: {
  diagnostics: WalReadDiagnostics;
  security: MemorySecurityConfig;
}): void {
  const { diagnostics, security } = params;
  if (diagnostics.securityBypassApplied) {
    throw new Error("memory wal is in unsigned-replay bypass mode; writes are disabled");
  }
  const stopReason = diagnostics.stopReason;
  if (!stopReason) {
    return;
  }
  if (
    stopReason === "unsupported-envelope-version" ||
    stopReason === "unsupported-signature-version" ||
    stopReason === "missing-signature" ||
    stopReason === "missing-key" ||
    stopReason === "prev-signature-mismatch" ||
    stopReason === "signature-mismatch" ||
    stopReason === "schema-validation-failure"
  ) {
    if (security.mode === "prod") {
      throw new Error(`memory wal verification failed (${stopReason}); writes are blocked`);
    }
    throw new Error(`memory wal verification failed (${stopReason}); writes are blocked in dev`);
  }
}

function buildSignedEnvelope(event: MemoryEventRecord, prevSignature?: string): SignedWalEnvelope {
  return {
    envelopeVersion: MEMORY_ENVELOPE_VERSION,
    eventId: event.eventId,
    scope: event.scope,
    taskId: event.taskId ?? null,
    type: event.type,
    payload: event.payload,
    timestamp: canonicalTimestamp(event.timestamp),
    actor: event.actor,
    prevSignature: prevSignature ?? null,
  };
}

function buildSignedBaselineEnvelope(baseline: WalBaselineStore): SignedWalBaselineEnvelope {
  return {
    envelopeVersion: WAL_BASELINE_ENVELOPE_VERSION,
    endSequence: baseline.endSequence,
    endSignature: baseline.endSignature ?? null,
    globalState: normalizeSnapshot(baseline.globalState),
    taskStates: Object.fromEntries(
      Object.entries(baseline.taskStates).map(([taskId, state]) => [
        taskId,
        normalizeSnapshot(state),
      ]),
    ),
  };
}

function signWalEnvelope(secret: string, envelope: SignedWalEnvelope): string {
  return crypto.createHmac("sha256", secret).update(canonicalizeJson(envelope)).digest("hex");
}

function signWalBaselineEnvelope(secret: string, envelope: SignedWalBaselineEnvelope): string {
  return crypto.createHmac("sha256", secret).update(canonicalizeJson(envelope)).digest("hex");
}

function computeWalIntegrityHash(envelope: SignedWalEnvelope): string {
  return crypto.createHash("sha256").update(canonicalizeJson(envelope)).digest("hex");
}

function dedupeNormalized(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const item = raw.trim();
    if (!item) {
      continue;
    }
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeTaskRecord(value: TaskRegistryRecord): TaskRegistryRecord | null {
  const taskId = normalizeMemoryTaskId(value.taskId);
  if (!taskId) {
    return null;
  }
  const title = (typeof value.title === "string" ? value.title : "").trim() || taskId;
  const status = (() => {
    const raw = String(value.status ?? "")
      .trim()
      .toLowerCase();
    if (raw === "active" || raw === "suspended" || raw === "archived" || raw === "closed") {
      return raw;
    }
    return "active";
  })();
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? Math.floor(value.createdAt)
      : Date.now();
  const lastTouchedAt =
    typeof value.lastTouchedAt === "number" && Number.isFinite(value.lastTouchedAt)
      ? Math.floor(value.lastTouchedAt)
      : createdAt;
  const links = dedupeNormalized(
    (Array.isArray(value.links) ? value.links : []).map(String),
  ).filter((entry) => entry !== taskId);
  const pinSetId =
    (typeof value.pinSetId === "string" && value.pinSetId.trim()) || `pins:${taskId}`;
  const schemaVersion =
    typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
      ? Math.max(1, Math.floor(value.schemaVersion))
      : 1;
  return {
    taskId,
    title,
    status,
    createdAt,
    lastTouchedAt,
    links,
    pinSetId,
    schemaVersion,
  };
}

async function readTaskRegistryStore(workspaceDir: string): Promise<TaskRegistryStore> {
  const absPath = path.join(workspaceDir, TASK_REGISTRY_REL_PATH);
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TaskRegistryStore>;
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .map((entry) => normalizeTaskRecord(entry as TaskRegistryRecord))
      .filter((entry): entry is TaskRegistryRecord => Boolean(entry));
    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
          ? Math.floor(parsed.updatedAt)
          : Date.now(),
      tasks,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return defaultTaskRegistryStore();
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`memory task registry read failed: ${detail}`, { cause: error });
  }
}

async function writeTaskRegistryStore(
  workspaceDir: string,
  store: TaskRegistryStore,
): Promise<void> {
  const absPath = path.join(workspaceDir, TASK_REGISTRY_REL_PATH);
  await writeTextFileAtomic(absPath, `${JSON.stringify(store, null, 2)}\n`);
}

async function writeTextFileAtomic(absPath: string, content: string): Promise<void> {
  ensureDir(path.dirname(absPath));
  const tmpPath = `${absPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, content, "utf-8");
  try {
    await fs.rename(tmpPath, absPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeSnapshot(input: unknown): CanonicalMemoryState {
  if (!input || typeof input !== "object") {
    return defaultCanonicalState();
  }
  const value = input as Record<string, unknown>;
  const asList = (key: string): string[] =>
    dedupeNormalized(
      (Array.isArray(value[key]) ? value[key] : []).flatMap((item) =>
        typeof item === "string" ? [item] : [],
      ),
    );
  const status = typeof value.status === "string" ? value.status.trim().toLowerCase() : "";
  return {
    title: typeof value.title === "string" ? value.title.trim() || undefined : undefined,
    status:
      status === "active" || status === "suspended" || status === "archived" || status === "closed"
        ? status
        : undefined,
    goal: typeof value.goal === "string" ? value.goal.trim() || undefined : undefined,
    decisions: asList("decisions"),
    constraints: asList("constraints"),
    openQuestions: asList("openQuestions"),
    nextAction:
      typeof value.nextAction === "string" ? value.nextAction.trim() || undefined : undefined,
    artifacts: asList("artifacts"),
    pins: asList("pins"),
    links: asList("links"),
    lastConfirmedAt:
      typeof value.lastConfirmedAt === "number" && Number.isFinite(value.lastConfirmedAt)
        ? Math.floor(value.lastConfirmedAt)
        : undefined,
    goalStack: asList("goalStack"),
    blockers: asList("blockers"),
    goalLastProgressAt:
      typeof value.goalLastProgressAt === "number" && Number.isFinite(value.goalLastProgressAt)
        ? Math.floor(value.goalLastProgressAt)
        : undefined,
  };
}

function resolveSnapshotPath(workspaceDir: string, scope: MemoryScope, taskId?: string): string {
  if (scope === "global") {
    return path.join(workspaceDir, GLOBAL_SNAPSHOT_REL_PATH);
  }
  const normalizedTaskId = normalizeMemoryTaskId(taskId);
  if (!normalizedTaskId) {
    throw new Error("task scope snapshot requires taskId");
  }
  return path.join(workspaceDir, TASK_SNAPSHOTS_REL_DIR, `${normalizedTaskId}.json`);
}

export async function readSnapshot(params: {
  workspaceDir: string;
  scope: MemoryScope;
  taskId?: string;
}): Promise<MemorySnapshotRecord> {
  const absPath = resolveSnapshotPath(params.workspaceDir, params.scope, params.taskId);
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MemorySnapshotRecord>;
    const state = normalizeSnapshot(parsed.state);
    return {
      snapshotId:
        (typeof parsed.snapshotId === "string" && parsed.snapshotId.trim()) ||
        `snapshot:${params.scope}:${params.taskId ?? "global"}`,
      scope: params.scope,
      taskId: params.scope === "task" ? normalizeMemoryTaskId(params.taskId) : undefined,
      eventOffset:
        typeof parsed.eventOffset === "number" && Number.isFinite(parsed.eventOffset)
          ? Math.max(0, Math.floor(parsed.eventOffset))
          : 0,
      state,
      updatedAt:
        typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
          ? Math.floor(parsed.updatedAt)
          : Date.now(),
    };
  } catch {
    return {
      snapshotId: `snapshot:${params.scope}:${params.taskId ?? "global"}`,
      scope: params.scope,
      taskId: params.scope === "task" ? normalizeMemoryTaskId(params.taskId) : undefined,
      eventOffset: 0,
      state: defaultCanonicalState(),
      updatedAt: Date.now(),
    };
  }
}

async function writeSnapshot(params: {
  workspaceDir: string;
  snapshot: MemorySnapshotRecord;
}): Promise<void> {
  const absPath = resolveSnapshotPath(
    params.workspaceDir,
    params.snapshot.scope,
    params.snapshot.taskId,
  );
  await writeTextFileAtomic(absPath, `${JSON.stringify(params.snapshot, null, 2)}\n`);
}

export async function listWalEvents(workspaceDir: string): Promise<MemoryEventRecord[]> {
  const result = await readWalEvents(workspaceDir);
  return result.events;
}

export async function readWalDiagnostics(workspaceDir: string): Promise<WalReadDiagnostics> {
  const result = await readWalEvents(workspaceDir, { allowSecurityFailure: true });
  return result.diagnostics;
}

type WalReadResult = {
  events: MemoryEventRecord[];
  validLines: string[];
  lastIntegrityHash?: string;
  lastSignature?: string;
  diagnostics: WalReadDiagnostics;
};

type WalLockOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  staleMs?: number;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withWalWriteLock<T>(
  workspaceDir: string,
  fn: () => Promise<T>,
  opts: WalLockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 25;
  const staleMs = opts.staleMs ?? 30_000;
  const lockPath = path.join(workspaceDir, WAL_LOCK_REL_PATH);
  const startedAt = Date.now();

  ensureDir(path.dirname(lockPath));

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
          "utf-8",
        );
      } catch {
        // best effort
      }
      await handle.close();
      break;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code === "ENOENT") {
        ensureDir(path.dirname(lockPath));
        await sleep(pollIntervalMs);
        continue;
      }
      if (code !== "EEXIST") {
        throw error;
      }

      const now = Date.now();
      if (now - startedAt > timeoutMs) {
        throw new Error(`timeout acquiring memory wal lock: ${lockPath}`, { cause: error });
      }

      try {
        const stat = await fs.stat(lockPath);
        if (now - stat.mtimeMs > staleMs) {
          await fs.unlink(lockPath);
          continue;
        }
      } catch {
        // ignore and retry
      }

      await sleep(pollIntervalMs);
    }
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

function normalizeWalEventRecord(value: unknown): MemoryEventRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const event = value as Partial<MemoryEventRecord>;
  const eventId = typeof event.eventId === "string" ? event.eventId.trim() : "";
  if (!eventId) {
    return null;
  }
  const scope = event.scope === "task" || event.scope === "global" ? event.scope : null;
  if (!scope) {
    return null;
  }
  const taskId = scope === "task" ? normalizeMemoryTaskId(event.taskId) : undefined;
  if (scope === "task" && !taskId) {
    return null;
  }
  const type = String(event.type ?? "").trim() as MemoryEventType;
  if (!EVENT_TYPE_SET.has(type)) {
    return null;
  }
  const actor =
    event.actor === "user" || event.actor === "agent" || event.actor === "system"
      ? event.actor
      : null;
  if (!actor) {
    return null;
  }
  const timestamp =
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
      ? Math.floor(event.timestamp)
      : null;
  if (timestamp == null) {
    return null;
  }
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  return {
    eventId,
    scope,
    ...(scope === "task" ? { taskId } : {}),
    type,
    payload: payload as Record<string, unknown>,
    timestamp,
    actor,
    ...(typeof event.envelopeVersion === "number" && Number.isFinite(event.envelopeVersion)
      ? { envelopeVersion: Math.floor(event.envelopeVersion) }
      : {}),
    ...(typeof event.signatureVersion === "number" && Number.isFinite(event.signatureVersion)
      ? { signatureVersion: Math.floor(event.signatureVersion) }
      : {}),
    ...(typeof event.keyId === "string" && event.keyId.trim() ? { keyId: event.keyId.trim() } : {}),
    ...(typeof event.prevSignature === "string" && event.prevSignature.trim()
      ? { prevSignature: event.prevSignature.trim() }
      : {}),
    ...(typeof event.signature === "string" && event.signature.trim()
      ? { signature: event.signature.trim() }
      : {}),
    ...(typeof event.integrityHash === "string" && event.integrityHash.trim()
      ? { integrityHash: event.integrityHash.trim() }
      : {}),
  };
}

function isBypassableSecurityReason(reason: WalSecurityStopReason): boolean {
  return (
    reason === "missing-signature" || reason === "missing-key" || reason === "signature-mismatch"
  );
}

function readWalEventsFromRaw(
  raw: string,
  security: MemorySecurityConfig,
  opts: { initialSignature?: string } = {},
): WalReadResult {
  const lines = raw.split(/\r?\n/);
  const events: MemoryEventRecord[] = [];
  const validLines: string[] = [];
  let chainHash: string | undefined;
  let chainSignature: string | undefined = opts.initialSignature;
  let stopReason: WalStopReason | undefined;
  let stoppedAtLine: number | undefined;
  let securityBypassApplied = false;
  let securityBypassReason: WalSecurityStopReason | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const sourceLine = lines[i] ?? "";
    const line = sourceLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      stopReason = "invalid-json";
      stoppedAtLine = i + 1;
      break;
    }

    const event = normalizeWalEventRecord(parsed);
    if (!event) {
      stopReason = "invalid-record";
      stoppedAtLine = i + 1;
      break;
    }

    const securityFailure = (() => {
      if (event.envelopeVersion !== MEMORY_ENVELOPE_VERSION) {
        return "unsupported-envelope-version" as const;
      }
      if (event.signatureVersion !== MEMORY_SIGNATURE_VERSION) {
        return "unsupported-signature-version" as const;
      }
      if (!event.keyId || !event.signature) {
        return "missing-signature" as const;
      }
      const expectedPrev = chainSignature ?? null;
      const actualPrev = event.prevSignature ?? null;
      if (actualPrev !== expectedPrev) {
        return "prev-signature-mismatch" as const;
      }
      const verificationSecret = security.verificationKeys.get(event.keyId);
      if (!verificationSecret) {
        return "missing-key" as const;
      }
      const envelope = buildSignedEnvelope(event, chainSignature);
      const expectedSignature = signWalEnvelope(verificationSecret, envelope);
      if (expectedSignature !== event.signature) {
        return "signature-mismatch" as const;
      }
      const payloadSchemaError = validateEventPayloadSchema(event.type, event.payload);
      if (payloadSchemaError) {
        return "schema-validation-failure" as const;
      }
      return null;
    })();

    if (securityFailure) {
      const canBypass =
        security.mode === "dev" &&
        security.allowUnsignedReplay &&
        isBypassableSecurityReason(securityFailure);
      if (!canBypass) {
        stopReason = securityFailure;
        stoppedAtLine = i + 1;
        break;
      }
      securityBypassApplied = true;
      securityBypassReason = securityBypassReason ?? securityFailure;
    }

    const envelope = buildSignedEnvelope(event, chainSignature);
    const computedHash = computeWalIntegrityHash(envelope);
    const existingHash = event.integrityHash?.trim();
    if (
      existingHash &&
      existingHash !== computedHash &&
      !(security.mode === "dev" && security.allowUnsignedReplay)
    ) {
      stopReason = "integrity-mismatch";
      stoppedAtLine = i + 1;
      break;
    }
    chainHash = existingHash || computedHash;
    chainSignature = event.signature ?? chainSignature;
    events.push(existingHash ? event : { ...event, integrityHash: computedHash });
    validLines.push(line);
  }

  const droppedLineCount = stopReason
    ? lines.slice((stoppedAtLine ?? lines.length) - 1).filter((entry) => entry.trim()).length
    : 0;
  return {
    events,
    validLines,
    lastIntegrityHash: chainHash,
    lastSignature: chainSignature,
    diagnostics: {
      truncatedTail: Boolean(stopReason),
      stopReason,
      stoppedAtLine,
      droppedLineCount,
      securityBypassApplied,
      securityBypassReason,
    },
  };
}

async function readWalEvents(
  workspaceDir: string,
  opts: { allowSecurityFailure?: boolean } = {},
): Promise<WalReadResult> {
  const security = resolveMemorySecurityConfig();
  const lifecycle = resolveWalLifecycleConfig();
  assertMemorySecurityBootContract({ security, rawWal: "" });
  try {
    const replay = await readWalReplayRaw({ workspaceDir, lifecycle, security });
    const raw = replay.raw;
    assertMemorySecurityBootContract({ security, rawWal: raw });
    const result = readWalEventsFromRaw(raw, security, {
      initialSignature: replay.initialSignature,
    });
    const securityStop = result.diagnostics.stopReason;
    const securityFailure = Boolean(
      securityStop &&
      [
        "unsupported-envelope-version",
        "unsupported-signature-version",
        "missing-signature",
        "missing-key",
        "prev-signature-mismatch",
        "signature-mismatch",
        "schema-validation-failure",
      ].includes(securityStop),
    );
    if (securityFailure && !opts.allowSecurityFailure) {
      emitMemorySecurityDiagnostic({
        severity: security.mode === "prod" ? "CRITICAL" : "ERROR",
        code:
          securityStop === "unsupported-envelope-version"
            ? "unsupported-envelope-version"
            : securityStop === "schema-validation-failure"
              ? "schema-validation-failure"
              : "verification-failure",
        detail: `memory wal verification failed (${securityStop})`,
        mode: security.mode,
      });
      throw new Error(`memory wal verification failed (${securityStop})`);
    }
    return result;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code !== "ENOENT") {
      throw error;
    }
    return {
      events: [],
      validLines: [],
      diagnostics: {
        truncatedTail: false,
        droppedLineCount: 0,
      },
    };
  }
}

async function writeWalLines(workspaceDir: string, lines: string[]): Promise<void> {
  const absPath = path.join(workspaceDir, WAL_REL_PATH);
  const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  await writeTextFileAtomic(absPath, content);
}

async function readWalManifestStore(workspaceDir: string): Promise<WalManifestStore> {
  const absPath = path.join(workspaceDir, WAL_MANIFEST_REL_PATH);
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WalManifestStore>;
    const segments = (Array.isArray(parsed.segments) ? parsed.segments : [])
      .filter((entry) => entry && typeof entry === "object")
      .map((entry): WalSegmentManifestEntry | null => {
        const seq =
          typeof entry.seq === "number" && Number.isFinite(entry.seq)
            ? Math.max(1, Math.floor(entry.seq))
            : 0;
        const file = typeof entry.file === "string" ? entry.file.trim() : "";
        const archivedAt =
          typeof entry.archivedAt === "number" && Number.isFinite(entry.archivedAt)
            ? Math.floor(entry.archivedAt)
            : Date.now();
        const eventCount =
          typeof entry.eventCount === "number" && Number.isFinite(entry.eventCount)
            ? Math.max(0, Math.floor(entry.eventCount))
            : 0;
        if (!seq || !file) {
          return null;
        }
        const startSignature =
          typeof entry.startSignature === "string"
            ? entry.startSignature.trim() || undefined
            : undefined;
        const endSignature =
          typeof entry.endSignature === "string"
            ? entry.endSignature.trim() || undefined
            : undefined;
        const startPrevSignature =
          typeof entry.startPrevSignature === "string" ? entry.startPrevSignature : null;
        const endEventId =
          typeof entry.endEventId === "string" ? entry.endEventId.trim() || undefined : undefined;
        return {
          seq,
          file,
          archivedAt,
          eventCount,
          ...(startSignature ? { startSignature } : {}),
          ...(endSignature ? { endSignature } : {}),
          ...(startPrevSignature !== null ? { startPrevSignature } : {}),
          ...(endEventId ? { endEventId } : {}),
        };
      })
      .filter((entry): entry is WalSegmentManifestEntry => entry !== null)
      .toSorted((a, b) => a.seq - b.seq);
    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
          ? Math.floor(parsed.updatedAt)
          : Date.now(),
      activeCreatedAt:
        typeof parsed.activeCreatedAt === "number" && Number.isFinite(parsed.activeCreatedAt)
          ? Math.floor(parsed.activeCreatedAt)
          : Date.now(),
      nextSequence:
        typeof parsed.nextSequence === "number" && Number.isFinite(parsed.nextSequence)
          ? Math.max(1, Math.floor(parsed.nextSequence))
          : segments.length + 1,
      segments,
    };
  } catch {
    return defaultWalManifestStore();
  }
}

async function writeWalManifestStore(workspaceDir: string, store: WalManifestStore): Promise<void> {
  const absPath = path.join(workspaceDir, WAL_MANIFEST_REL_PATH);
  await writeTextFileAtomic(absPath, `${JSON.stringify(store, null, 2)}\n`);
}

async function readWalBaselineStore(workspaceDir: string): Promise<WalBaselineStore> {
  const absPath = path.join(workspaceDir, WAL_BASELINE_REL_PATH);
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WalBaselineStore>;
    const taskStatesEntries = Object.entries(parsed.taskStates ?? {})
      .map(([taskId, state]) => {
        const normalizedTaskId = normalizeMemoryTaskId(taskId);
        if (!normalizedTaskId) {
          return null;
        }
        return [normalizedTaskId, normalizeSnapshot(state)] as const;
      })
      .filter((entry): entry is readonly [string, CanonicalMemoryState] => entry !== null);
    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
          ? Math.floor(parsed.updatedAt)
          : Date.now(),
      endSequence:
        typeof parsed.endSequence === "number" && Number.isFinite(parsed.endSequence)
          ? Math.max(0, Math.floor(parsed.endSequence))
          : 0,
      ...(typeof parsed.endSignature === "string" && parsed.endSignature.trim()
        ? { endSignature: parsed.endSignature.trim() }
        : {}),
      ...(typeof parsed.envelopeVersion === "number" && Number.isFinite(parsed.envelopeVersion)
        ? { envelopeVersion: Math.floor(parsed.envelopeVersion) }
        : {}),
      ...(typeof parsed.signatureVersion === "number" && Number.isFinite(parsed.signatureVersion)
        ? { signatureVersion: Math.floor(parsed.signatureVersion) }
        : {}),
      ...(typeof parsed.keyId === "string" && parsed.keyId.trim()
        ? { keyId: parsed.keyId.trim() }
        : {}),
      ...(typeof parsed.signature === "string" && parsed.signature.trim()
        ? { signature: parsed.signature.trim() }
        : {}),
      globalState: normalizeSnapshot(parsed.globalState),
      taskStates: Object.fromEntries(taskStatesEntries),
    };
  } catch {
    return defaultWalBaselineStore();
  }
}

async function writeWalBaselineStore(workspaceDir: string, store: WalBaselineStore): Promise<void> {
  const absPath = path.join(workspaceDir, WAL_BASELINE_REL_PATH);
  await writeTextFileAtomic(absPath, `${JSON.stringify(store, null, 2)}\n`);
}

async function maybeRotateWalActiveSegment(params: {
  workspaceDir: string;
  security: MemorySecurityConfig;
  lifecycle: WalLifecycleConfig;
  now?: number;
}): Promise<void> {
  const now = params.now ?? Date.now();
  const absWalPath = path.join(params.workspaceDir, WAL_REL_PATH);
  let raw = "";
  try {
    raw = await fs.readFile(absWalPath, "utf-8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    const manifest = await readWalManifestStore(params.workspaceDir);
    if (!manifest.activeCreatedAt) {
      manifest.activeCreatedAt = now;
      manifest.updatedAt = now;
      await writeWalManifestStore(params.workspaceDir, manifest);
    }
    return;
  }

  const manifest = await readWalManifestStore(params.workspaceDir);
  const byteLength = Buffer.byteLength(raw, "utf-8");
  const ageMs = Math.max(0, now - manifest.activeCreatedAt);
  const shouldRotate =
    byteLength >= params.lifecycle.segmentMaxBytes || ageMs >= params.lifecycle.segmentMaxAgeMs;
  if (!shouldRotate) {
    return;
  }

  const baseline = await readWalBaselineStore(params.workspaceDir);
  const priorSegmentSignature =
    manifest.segments[manifest.segments.length - 1]?.endSignature ?? baseline.endSignature;
  const parsed = readWalEventsFromRaw(raw, params.security, {
    initialSignature: priorSegmentSignature,
  });
  assertWalWritableFromDiagnostics({ diagnostics: parsed.diagnostics, security: params.security });
  if (parsed.diagnostics.truncatedTail) {
    // Keep repair explicit in authenticity mode; do not rotate corrupted active segments.
    return;
  }
  if (parsed.events.length === 0) {
    return;
  }

  const seq = manifest.nextSequence;
  const file = `${String(seq).padStart(6, "0")}.jsonl`;
  const absSegmentPath = path.join(params.workspaceDir, WAL_SEGMENTS_REL_DIR, file);
  ensureDir(path.dirname(absSegmentPath));
  const lines = parsed.validLines.length ? `${parsed.validLines.join("\n")}\n` : "";
  await fs.writeFile(absSegmentPath, lines, "utf-8");

  const first = parsed.events[0];
  const last = parsed.events[parsed.events.length - 1];
  manifest.segments.push({
    seq,
    file,
    archivedAt: now,
    eventCount: parsed.events.length,
    startSignature: first?.signature,
    endSignature: last?.signature,
    startPrevSignature: first?.prevSignature ?? null,
    endEventId: last?.eventId,
  });
  manifest.nextSequence = seq + 1;
  manifest.activeCreatedAt = now;
  manifest.updatedAt = now;
  await writeWalManifestStore(params.workspaceDir, manifest);
  await writeWalLines(params.workspaceDir, []);
}

async function readWalReplayRaw(params: {
  workspaceDir: string;
  lifecycle: WalLifecycleConfig;
  security: MemorySecurityConfig;
}): Promise<{
  raw: string;
  manifest: WalManifestStore;
  baseline: WalBaselineStore;
  selectedSegments: WalSegmentManifestEntry[];
  initialSignature?: string;
}> {
  const manifest = await readWalManifestStore(params.workspaceDir);
  const baseline = await readWalBaselineStore(params.workspaceDir);
  if (baseline.endSequence > 0) {
    const envelopeVersion = baseline.envelopeVersion ?? WAL_BASELINE_ENVELOPE_VERSION;
    const signatureVersion = baseline.signatureVersion ?? WAL_BASELINE_SIGNATURE_VERSION;
    if (envelopeVersion !== WAL_BASELINE_ENVELOPE_VERSION) {
      throw new Error(`memory wal baseline unsupported envelope version (${envelopeVersion})`);
    }
    if (signatureVersion !== WAL_BASELINE_SIGNATURE_VERSION) {
      throw new Error(`memory wal baseline unsupported signature version (${signatureVersion})`);
    }
    const keyId = baseline.keyId?.trim() ?? "";
    const signature = baseline.signature?.trim() ?? "";
    if (!keyId || !signature) {
      throw new Error("memory wal baseline missing signature metadata");
    }
    const secret = params.security.verificationKeys.get(keyId);
    if (!secret) {
      throw new Error(`memory wal baseline verification key unavailable (${keyId})`);
    }
    const expectedSignature = signWalBaselineEnvelope(
      secret,
      buildSignedBaselineEnvelope(baseline),
    );
    if (expectedSignature !== signature) {
      throw new Error("memory wal baseline signature mismatch");
    }
  }
  const cutoff = Date.now() - params.lifecycle.retentionDays * 24 * 60 * 60 * 1000;
  const selectedSegments = manifest.segments
    .filter((entry) => entry.archivedAt >= cutoff)
    .toSorted((a, b) => a.seq - b.seq);
  const baselineSignature = baseline.endSignature;

  if (selectedSegments.length > 0) {
    const firstSelectedSeq = selectedSegments[0]!.seq;
    const hasOlder = manifest.segments.some((entry) => entry.seq < firstSelectedSeq);
    const first = selectedSegments[0]!;
    const expectedPrev = first.startPrevSignature ?? null;
    const baselinePrev = baselineSignature ?? null;
    if (hasOlder && !baselinePrev && expectedPrev) {
      throw new Error(
        "memory wal replay scope invalid: retained segments depend on expired chain history",
      );
    }
    if (expectedPrev !== baselinePrev) {
      throw new Error(
        `memory wal baseline chain mismatch at segment ${first.file} (seq=${first.seq})`,
      );
    }
  }

  let previousEndSignature: string | undefined = baselineSignature;
  const parts: string[] = [];
  for (const segment of selectedSegments) {
    const expectedPrev = previousEndSignature ?? null;
    const actualPrev = segment.startPrevSignature ?? null;
    if (actualPrev !== expectedPrev) {
      throw new Error(
        `memory wal manifest chain mismatch at segment ${segment.file} (seq=${segment.seq})`,
      );
    }
    const absSegmentPath = path.join(params.workspaceDir, WAL_SEGMENTS_REL_DIR, segment.file);
    try {
      const raw = await fs.readFile(absSegmentPath, "utf-8");
      if (raw.trim()) {
        parts.push(raw.trimEnd());
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code !== "ENOENT") {
        throw error;
      }
      throw new Error(`memory wal segment missing: ${segment.file}`, { cause: error });
    }
    previousEndSignature = segment.endSignature;
  }

  const absWalPath = path.join(params.workspaceDir, WAL_REL_PATH);
  try {
    const activeRaw = await fs.readFile(absWalPath, "utf-8");
    if (activeRaw.trim()) {
      parts.push(activeRaw.trimEnd());
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  return {
    raw: parts.length > 0 ? `${parts.join("\n")}\n` : "",
    manifest,
    baseline,
    selectedSegments,
    ...(baselineSignature ? { initialSignature: baselineSignature } : {}),
  };
}

async function adjustSnapshotsForCompaction(params: {
  workspaceDir: string;
  globalPrunedEventCount: number;
  taskPrunedEventCount: Map<string, number>;
  baseline: WalBaselineStore;
  now: number;
}): Promise<void> {
  const globalSnapshot = await readSnapshot({
    workspaceDir: params.workspaceDir,
    scope: "global",
  });
  if (params.globalPrunedEventCount > 0) {
    const nextGlobalOffset = Math.max(
      0,
      globalSnapshot.eventOffset - params.globalPrunedEventCount,
    );
    const shouldReplaceState = globalSnapshot.eventOffset < params.globalPrunedEventCount;
    const nextGlobal: MemorySnapshotRecord = {
      ...globalSnapshot,
      eventOffset: nextGlobalOffset,
      state: shouldReplaceState ? params.baseline.globalState : globalSnapshot.state,
      updatedAt: params.now,
    };
    await writeSnapshot({
      workspaceDir: params.workspaceDir,
      snapshot: nextGlobal,
    });
  }

  for (const [taskId, prunedCount] of params.taskPrunedEventCount) {
    if (prunedCount <= 0) {
      continue;
    }
    const taskSnapshot = await readSnapshot({
      workspaceDir: params.workspaceDir,
      scope: "task",
      taskId,
    });
    const nextOffset = Math.max(0, taskSnapshot.eventOffset - prunedCount);
    const baselineState = params.baseline.taskStates[taskId] ?? defaultCanonicalState();
    const shouldReplaceState = taskSnapshot.eventOffset < prunedCount;
    const nextSnapshot: MemorySnapshotRecord = {
      ...taskSnapshot,
      eventOffset: nextOffset,
      state: shouldReplaceState ? baselineState : taskSnapshot.state,
      updatedAt: params.now,
    };
    await writeSnapshot({
      workspaceDir: params.workspaceDir,
      snapshot: nextSnapshot,
    });
  }
}

export async function compactWalSegments(params: {
  workspaceDir: string;
  now?: number;
  maxSegments?: number;
}): Promise<{ compactedSegments: number; compactedEvents: number; lastCompactedSeq?: number }> {
  const now = params.now ?? Date.now();
  const lifecycle = resolveWalLifecycleConfig();
  const security = resolveMemorySecurityConfig();
  const signing = resolveSigningCredentialsForWrite(security);
  const cutoff = now - lifecycle.retentionDays * 24 * 60 * 60 * 1000;
  const manifest = await readWalManifestStore(params.workspaceDir);
  const baseline = await readWalBaselineStore(params.workspaceDir);
  const limit =
    typeof params.maxSegments === "number" && Number.isFinite(params.maxSegments)
      ? Math.max(1, Math.floor(params.maxSegments))
      : Number.POSITIVE_INFINITY;

  const eligible = manifest.segments
    .filter((entry) => entry.archivedAt < cutoff)
    .toSorted((a, b) => a.seq - b.seq);
  if (eligible.length === 0) {
    return { compactedSegments: 0, compactedEvents: 0 };
  }

  const compactable: WalSegmentManifestEntry[] = [];
  let expectedSeq = baseline.endSequence > 0 ? baseline.endSequence + 1 : eligible[0]!.seq;
  for (const segment of eligible) {
    if (compactable.length >= limit) {
      break;
    }
    if (segment.seq !== expectedSeq) {
      break;
    }
    compactable.push(segment);
    expectedSeq += 1;
  }
  if (compactable.length === 0) {
    return { compactedSegments: 0, compactedEvents: 0 };
  }

  let signatureSeed = baseline.endSignature;
  let globalState = normalizeSnapshot(baseline.globalState);
  const taskStates = new Map<string, CanonicalMemoryState>(
    Object.entries(baseline.taskStates).map(([taskId, state]) => [
      taskId,
      normalizeSnapshot(state),
    ]),
  );
  let compactedEvents = 0;
  let globalPrunedEventCount = 0;
  const taskPrunedEventCount = new Map<string, number>();

  for (const segment of compactable) {
    const absPath = path.join(params.workspaceDir, WAL_SEGMENTS_REL_DIR, segment.file);
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = readWalEventsFromRaw(raw, security, {
      initialSignature: signatureSeed,
    });
    assertWalWritableFromDiagnostics({ diagnostics: parsed.diagnostics, security });
    if (parsed.diagnostics.truncatedTail) {
      throw new Error(
        `memory wal segment requires explicit repair before compaction (${segment.file})`,
      );
    }
    for (const event of parsed.events) {
      compactedEvents += 1;
      if (event.scope === "global") {
        globalState = applyEventToState(globalState, event);
        globalPrunedEventCount += 1;
        continue;
      }
      const taskId = normalizeMemoryTaskId(event.taskId);
      if (!taskId) {
        continue;
      }
      const previous = taskStates.get(taskId) ?? defaultCanonicalState();
      const next = applyEventToState(previous, event);
      taskStates.set(taskId, next);
      taskPrunedEventCount.set(taskId, (taskPrunedEventCount.get(taskId) ?? 0) + 1);
    }
    signatureSeed = parsed.lastSignature ?? signatureSeed;
  }

  const lastCompactedSeq = compactable[compactable.length - 1]!.seq;
  const nextBaseline: WalBaselineStore = {
    version: 1,
    updatedAt: now,
    endSequence: lastCompactedSeq,
    ...(signatureSeed ? { endSignature: signatureSeed } : {}),
    globalState: normalizeSnapshot(globalState),
    taskStates: Object.fromEntries(
      [...taskStates.entries()].map(([taskId, state]) => [taskId, normalizeSnapshot(state)]),
    ),
  };
  const baselineEnvelope = buildSignedBaselineEnvelope(nextBaseline);
  const baselineSignature = signWalBaselineEnvelope(signing.secret, baselineEnvelope);
  nextBaseline.envelopeVersion = WAL_BASELINE_ENVELOPE_VERSION;
  nextBaseline.signatureVersion = WAL_BASELINE_SIGNATURE_VERSION;
  nextBaseline.keyId = signing.keyId;
  nextBaseline.signature = baselineSignature;
  await writeWalBaselineStore(params.workspaceDir, nextBaseline);
  for (const segment of compactable) {
    const absPath = path.join(params.workspaceDir, WAL_SEGMENTS_REL_DIR, segment.file);
    await fs.rm(absPath, { force: true }).catch(() => undefined);
  }
  manifest.segments = manifest.segments.filter((segment) => segment.seq > lastCompactedSeq);
  manifest.updatedAt = now;
  await writeWalManifestStore(params.workspaceDir, manifest);
  await adjustSnapshotsForCompaction({
    workspaceDir: params.workspaceDir,
    globalPrunedEventCount,
    taskPrunedEventCount,
    baseline: nextBaseline,
    now,
  });
  return { compactedSegments: compactable.length, compactedEvents, lastCompactedSeq };
}

export async function applyWalRetentionPolicy(params: {
  workspaceDir: string;
  now?: number;
}): Promise<{ prunedSegments: number }> {
  const now = params.now ?? Date.now();
  const lifecycle = resolveWalLifecycleConfig();
  const cutoff = now - lifecycle.retentionDays * 24 * 60 * 60 * 1000;
  const manifest = await readWalManifestStore(params.workspaceDir);
  const prune = manifest.segments.filter((entry) => entry.archivedAt < cutoff);
  if (prune.length === 0) {
    return { prunedSegments: 0 };
  }
  const compacted = await compactWalSegments({
    workspaceDir: params.workspaceDir,
    now,
    maxSegments: prune.length,
  });
  return { prunedSegments: compacted.compactedSegments };
}

export async function repairWalCorruptTail(params: {
  workspaceDir: string;
  lockOptions?: WalLockOptions;
}): Promise<WalReadDiagnostics> {
  const security = resolveMemorySecurityConfig();
  const lifecycle = resolveWalLifecycleConfig();
  return await withWalWriteLock(
    params.workspaceDir,
    async () => {
      const replay = await readWalReplayRaw({
        workspaceDir: params.workspaceDir,
        lifecycle,
        security,
      });
      const seedSignature =
        replay.selectedSegments[replay.selectedSegments.length - 1]?.endSignature ??
        replay.initialSignature;
      const absPath = path.join(params.workspaceDir, WAL_REL_PATH);
      const activeRaw = await fs.readFile(absPath, "utf-8").catch((error) => {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : null;
        if (code === "ENOENT") {
          return "";
        }
        throw error;
      });
      const result = readWalEventsFromRaw(activeRaw, security, {
        initialSignature: seedSignature,
      });
      assertWalWritableFromDiagnostics({ diagnostics: result.diagnostics, security });
      if (!result.diagnostics.truncatedTail) {
        return result.diagnostics;
      }
      await writeWalLines(params.workspaceDir, result.validLines);
      return result.diagnostics;
    },
    params.lockOptions,
  );
}

async function appendWalEvents(workspaceDir: string, events: MemoryEventRecord[]): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const absPath = path.join(workspaceDir, WAL_REL_PATH);
  ensureDir(path.dirname(absPath));
  const lines = events.map((entry) => JSON.stringify(entry)).join("\n");
  await fs.appendFile(absPath, `${lines}\n`, "utf-8");
}

function validateWriteScope(params: {
  writeScope: MemoryWriteScope;
  taskId?: string;
  events: Array<Partial<MemoryEventRecord>>;
}): { scope: MemoryScope; taskId?: string } {
  if (params.writeScope === "none") {
    if (params.events.length > 0) {
      throw new Error("writeScope=none cannot commit events");
    }
    return { scope: "global" };
  }

  if (params.writeScope === "global") {
    for (const event of params.events) {
      if (event.scope && event.scope !== "global") {
        throw new Error("single write scope invariant violated: mixed scopes in one turn");
      }
      if (event.taskId) {
        throw new Error("global scope events cannot include taskId");
      }
    }
    return { scope: "global" };
  }

  const taskId = normalizeMemoryTaskId(params.taskId);
  if (!taskId) {
    throw new Error("task write scope requires taskId");
  }
  for (const event of params.events) {
    if (event.scope && event.scope !== "task") {
      throw new Error("single write scope invariant violated: mixed scopes in one turn");
    }
    const eventTaskId = normalizeMemoryTaskId(event.taskId);
    if (eventTaskId && eventTaskId !== taskId) {
      throw new Error("single write scope invariant violated: mixed taskIds in one turn");
    }
  }
  return { scope: "task", taskId };
}

function nextIntegrityHash(
  previousSignature: string | undefined,
  event: MemoryEventRecord,
): string {
  const envelope = buildSignedEnvelope(event, previousSignature);
  return computeWalIntegrityHash(envelope);
}

function applyEventToState(
  state: CanonicalMemoryState,
  event: MemoryEventRecord,
): CanonicalMemoryState {
  const next: CanonicalMemoryState = {
    ...state,
    decisions: [...state.decisions],
    constraints: [...state.constraints],
    openQuestions: [...state.openQuestions],
    artifacts: [...state.artifacts],
    pins: [...state.pins],
    links: [...state.links],
    goalStack: [...(state.goalStack ?? [])],
    blockers: [...(state.blockers ?? [])],
  };
  const getString = (key: string): string | null => {
    const value = event.payload[key];
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  };

  switch (event.type) {
    case "TASK_CREATED": {
      const title = getString("title");
      if (title) {
        next.title = title;
      }
      next.status = "active";
      break;
    }
    case "TITLE_SET": {
      const title = getString("title");
      if (title) {
        next.title = title;
      }
      break;
    }
    case "GOAL_SET": {
      const goal = getString("goal");
      if (goal) {
        next.goal = goal;
      }
      break;
    }
    case "DECISION_MADE": {
      const decision = getString("decision");
      if (decision) {
        next.decisions = dedupeNormalized([...next.decisions, decision]);
      }
      break;
    }
    case "DECISION_REVERTED": {
      const decision = getString("decision");
      if (decision) {
        const needle = decision.toLowerCase();
        next.decisions = next.decisions.filter((entry) => entry.toLowerCase() !== needle);
      }
      break;
    }
    case "CONSTRAINT_ADDED": {
      const constraint = getString("constraint");
      if (constraint) {
        next.constraints = dedupeNormalized([...next.constraints, constraint]);
      }
      break;
    }
    case "CONSTRAINT_REMOVED": {
      const constraint = getString("constraint");
      if (constraint) {
        const needle = constraint.toLowerCase();
        next.constraints = next.constraints.filter((entry) => entry.toLowerCase() !== needle);
      }
      break;
    }
    case "OPEN_QUESTION_ADDED": {
      const question = getString("question");
      if (question) {
        next.openQuestions = dedupeNormalized([...next.openQuestions, question]);
      }
      break;
    }
    case "OPEN_QUESTION_RESOLVED": {
      const question = getString("question");
      if (question) {
        const needle = question.toLowerCase();
        next.openQuestions = next.openQuestions.filter((entry) => entry.toLowerCase() !== needle);
      }
      break;
    }
    case "NEXT_ACTION_SET": {
      const action = getString("action");
      if (action) {
        next.nextAction = action;
      }
      break;
    }
    case "NEXT_ACTION_COMPLETED": {
      const action = getString("action");
      if (!action) {
        delete next.nextAction;
      } else if ((next.nextAction ?? "").toLowerCase() === action.toLowerCase()) {
        delete next.nextAction;
      }
      next.goalLastProgressAt = event.timestamp;
      break;
    }
    case "ARTIFACT_LINKED": {
      const artifact = getString("artifact");
      if (artifact) {
        next.artifacts = dedupeNormalized([...next.artifacts, artifact]);
      }
      break;
    }
    case "PIN_ADDED": {
      const pinId = getString("pinId");
      if (pinId) {
        next.pins = dedupeNormalized([...next.pins, pinId]);
      }
      break;
    }
    case "PIN_REMOVE_REQUESTED": {
      // Audit-only: records intent. Actual removal handled by PIN_REMOVED.
      break;
    }
    case "PIN_REMOVED": {
      const pinId = getString("pinId");
      if (pinId) {
        const needle = pinId.toLowerCase();
        next.pins = next.pins.filter((entry) => entry.toLowerCase() !== needle);
      }
      break;
    }
    case "STATE_PATCH_APPLIED": {
      const patch = event.payload.patch;
      if (patch && typeof patch === "object") {
        const merged = {
          ...next,
          ...(patch as Partial<CanonicalMemoryState>),
        };
        return normalizeSnapshot(merged);
      }
      break;
    }
    case "USER_CONFIRMED": {
      next.lastConfirmedAt = event.timestamp;
      next.goalLastProgressAt = event.timestamp;
      break;
    }
    case "GOAL_PUSHED": {
      const goal = getString("goal");
      if (goal) {
        if (next.goal) {
          next.goalStack = [...(next.goalStack ?? []), next.goal];
        }
        next.goal = goal;
      }
      break;
    }
    case "GOAL_POPPED": {
      const stack = next.goalStack ?? [];
      if (stack.length > 0) {
        next.goal = stack[stack.length - 1];
        next.goalStack = stack.slice(0, -1);
      } else {
        delete next.goal;
      }
      break;
    }
    case "BLOCKER_ADDED": {
      const blocker = getString("blocker");
      if (blocker) {
        next.blockers = dedupeNormalized([...(next.blockers ?? []), blocker]);
      }
      break;
    }
    case "BLOCKER_RESOLVED": {
      const blocker = getString("blocker");
      if (blocker) {
        const needle = blocker.toLowerCase();
        next.blockers = (next.blockers ?? []).filter((entry) => entry.toLowerCase() !== needle);
      }
      break;
    }
    case "GOAL_PROGRESS_MARKED": {
      next.goalLastProgressAt = event.timestamp;
      break;
    }
    default:
      break;
  }

  return normalizeSnapshot(next);
}

function normalizeIncomingEvent(params: {
  scope: MemoryScope;
  taskId?: string;
  actor: MemoryEventActor;
  timestamp: number;
  event: Partial<MemoryEventRecord>;
}): MemoryEventRecord {
  const type = String(params.event.type ?? "").trim() as MemoryEventType;
  if (!EVENT_TYPE_SET.has(type)) {
    throw new Error(`unsupported memory event type: ${String(params.event.type ?? "")}`);
  }
  const timestamp =
    typeof params.event.timestamp === "number" && Number.isFinite(params.event.timestamp)
      ? Math.floor(params.event.timestamp)
      : params.timestamp;
  const payload =
    params.event.payload && typeof params.event.payload === "object"
      ? (params.event.payload as Record<string, unknown>)
      : {};
  const payloadSchemaError = validateEventPayloadSchema(type, payload);
  if (payloadSchemaError) {
    throw new Error(`memory event payload schema violation (${type}): ${payloadSchemaError}`);
  }
  return {
    eventId:
      (typeof params.event.eventId === "string" && params.event.eventId.trim()) ||
      `evt_${crypto.randomUUID()}`,
    scope: params.scope,
    taskId: params.scope === "task" ? params.taskId : undefined,
    type,
    payload,
    timestamp,
    actor: params.event.actor ?? params.actor,
  };
}

async function touchRegistryFromEvents(params: {
  workspaceDir: string;
  taskId?: string;
  timestamp: number;
}): Promise<void> {
  const taskId = normalizeMemoryTaskId(params.taskId);
  if (!taskId) {
    return;
  }
  const registry = await readTaskRegistryStore(params.workspaceDir);
  const index = registry.tasks.findIndex((entry) => entry.taskId === taskId);
  if (index < 0) {
    return;
  }
  const current = registry.tasks[index];
  registry.tasks[index] = {
    ...current,
    lastTouchedAt: Math.max(current.lastTouchedAt, params.timestamp),
  };
  registry.updatedAt = Math.max(registry.updatedAt, params.timestamp);
  await writeTaskRegistryStore(params.workspaceDir, registry);
}

export async function commitMemoryEvents(params: {
  workspaceDir: string;
  writeScope: MemoryWriteScope;
  taskId?: string;
  actor: MemoryEventActor;
  events: Array<Partial<MemoryEventRecord>>;
  now?: number;
  lockOptions?: WalLockOptions;
}): Promise<{ committed: MemoryEventRecord[]; snapshot?: MemorySnapshotRecord }> {
  const now = params.now ?? Date.now();
  const security = resolveMemorySecurityConfig();
  const lifecycle = resolveWalLifecycleConfig();
  assertMemorySecurityBootContract({ security, rawWal: "" });
  const scoped = validateWriteScope({
    writeScope: params.writeScope,
    taskId: params.taskId,
    events: params.events,
  });
  if (params.writeScope === "none" || params.events.length === 0) {
    return { committed: [] };
  }
  return await withWalWriteLock(
    params.workspaceDir,
    async () => {
      const signing = resolveSigningCredentialsForWrite(security);
      await maybeRotateWalActiveSegment({
        workspaceDir: params.workspaceDir,
        security,
        lifecycle,
        now,
      });
      const wal = await readWalEvents(params.workspaceDir);
      assertWalWritableFromDiagnostics({ diagnostics: wal.diagnostics, security });
      if (wal.diagnostics.truncatedTail) {
        throw new Error(
          `memory wal requires explicit repair before writes (${wal.diagnostics.stopReason ?? "unknown"})`,
        );
      }

      let prevSignature = wal.lastSignature;
      const normalizedEvents = params.events.map((event) =>
        normalizeIncomingEvent({
          scope: scoped.scope,
          taskId: scoped.taskId,
          actor: params.actor,
          timestamp: now,
          event,
        }),
      );
      const committed: MemoryEventRecord[] = normalizedEvents.map((entry) => {
        const envelope = buildSignedEnvelope(entry, prevSignature);
        const signature = signWalEnvelope(signing.secret, envelope);
        const integrityHash = nextIntegrityHash(prevSignature, entry);
        prevSignature = signature;
        return {
          ...entry,
          envelopeVersion: MEMORY_ENVELOPE_VERSION,
          signatureVersion: MEMORY_SIGNATURE_VERSION,
          keyId: signing.keyId,
          ...(envelope.prevSignature ? { prevSignature: envelope.prevSignature } : {}),
          signature,
          integrityHash,
        };
      });
      await appendWalEvents(params.workspaceDir, committed);

      const scopedWalEvents = wal.events.filter((event) => {
        if (event.scope !== scoped.scope) {
          return false;
        }
        if (scoped.scope === "task") {
          return event.taskId === scoped.taskId;
        }
        return true;
      });
      const snapshot = await readSnapshot({
        workspaceDir: params.workspaceDir,
        scope: scoped.scope,
        taskId: scoped.taskId,
      });
      if (snapshot.eventOffset > scopedWalEvents.length) {
        throw new Error(
          `snapshot eventOffset ahead of WAL (${snapshot.eventOffset} > ${scopedWalEvents.length})`,
        );
      }
      let baselineState = snapshot.state;
      let baselineOffset = snapshot.eventOffset;
      if (baselineOffset < scopedWalEvents.length) {
        for (const event of scopedWalEvents.slice(baselineOffset)) {
          baselineState = applyEventToState(baselineState, event);
        }
        baselineOffset = scopedWalEvents.length;
      }
      let nextState = baselineState;
      for (const event of committed) {
        nextState = applyEventToState(nextState, event);
      }
      const nextSnapshot: MemorySnapshotRecord = {
        ...snapshot,
        eventOffset: baselineOffset + committed.length,
        state: nextState,
        updatedAt: committed[committed.length - 1]?.timestamp ?? now,
      };
      await writeSnapshot({
        workspaceDir: params.workspaceDir,
        snapshot: nextSnapshot,
      });
      await touchRegistryFromEvents({
        workspaceDir: params.workspaceDir,
        taskId: scoped.taskId,
        timestamp: nextSnapshot.updatedAt,
      });

      return { committed, snapshot: nextSnapshot };
    },
    params.lockOptions,
  );
}

export async function rebuildSnapshotFromWal(params: {
  workspaceDir: string;
  scope: MemoryScope;
  taskId?: string;
  untilEventId?: string;
  write?: boolean;
}): Promise<MemorySnapshotRecord> {
  const scope = params.scope;
  const taskId = scope === "task" ? normalizeMemoryTaskId(params.taskId) : undefined;
  if (scope === "task" && !taskId) {
    throw new Error("task scope rebuild requires taskId");
  }
  const events = await listWalEvents(params.workspaceDir);
  const scopedEvents = events.filter((event) => {
    if (event.scope !== scope) {
      return false;
    }
    if (scope === "task") {
      return event.taskId === taskId;
    }
    return true;
  });
  const untilEventId = params.untilEventId?.trim();
  const baseline = await readWalBaselineStore(params.workspaceDir);
  const replayEvents = (() => {
    if (!untilEventId) {
      return scopedEvents;
    }
    const index = scopedEvents.findIndex((event) => event.eventId === untilEventId);
    if (index < 0) {
      throw new Error(`untilEventId not found for scope: ${untilEventId}`);
    }
    return scopedEvents.slice(0, index + 1);
  })();
  let state =
    scope === "global"
      ? normalizeSnapshot(baseline.globalState)
      : normalizeSnapshot((taskId && baseline.taskStates[taskId]) ?? defaultCanonicalState());
  for (const event of replayEvents) {
    state = applyEventToState(state, event);
  }
  const existing = await readSnapshot({
    workspaceDir: params.workspaceDir,
    scope,
    taskId,
  });
  const rebuilt: MemorySnapshotRecord = {
    snapshotId: existing.snapshotId,
    scope,
    taskId,
    eventOffset: replayEvents.length,
    state: normalizeSnapshot(state),
    updatedAt: replayEvents[replayEvents.length - 1]?.timestamp ?? Date.now(),
  };
  if (params.write !== false) {
    await writeSnapshot({
      workspaceDir: params.workspaceDir,
      snapshot: rebuilt,
    });
  }
  return rebuilt;
}

export async function validateSnapshotAgainstWal(params: {
  workspaceDir: string;
  scope: MemoryScope;
  taskId?: string;
  untilEventId?: string;
}): Promise<{
  ok: boolean;
  mismatches: string[];
  expected: MemorySnapshotRecord;
  actual: MemorySnapshotRecord;
}> {
  const expected = await rebuildSnapshotFromWal({
    ...params,
    write: false,
  });
  const actual = await readSnapshot({
    workspaceDir: params.workspaceDir,
    scope: params.scope,
    taskId: params.taskId,
  });
  const mismatches: string[] = [];
  if (expected.eventOffset !== actual.eventOffset) {
    mismatches.push(`eventOffset expected=${expected.eventOffset} actual=${actual.eventOffset}`);
  }
  if (JSON.stringify(expected.state) !== JSON.stringify(actual.state)) {
    mismatches.push("state mismatch");
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    expected,
    actual,
  };
}

export async function listTaskRegistry(workspaceDir: string): Promise<TaskRegistryRecord[]> {
  const store = await readTaskRegistryStore(workspaceDir);
  return [...store.tasks].toSorted((a, b) => b.lastTouchedAt - a.lastTouchedAt);
}

export async function getTaskRegistryTask(params: {
  workspaceDir: string;
  taskId: string;
}): Promise<TaskRegistryRecord | null> {
  const taskId = normalizeMemoryTaskId(params.taskId);
  if (!taskId) {
    return null;
  }
  const store = await readTaskRegistryStore(params.workspaceDir);
  return store.tasks.find((entry) => entry.taskId === taskId) ?? null;
}

export async function upsertTaskRegistryTask(params: {
  workspaceDir: string;
  taskId: string;
  title?: string;
  status?: TaskRegistryStatus;
  now?: number;
}): Promise<TaskRegistryRecord> {
  const taskId = normalizeMemoryTaskId(params.taskId);
  if (!taskId) {
    throw new Error("taskId required");
  }
  const now = params.now ?? Date.now();
  const title = (params.title ?? "").trim() || taskId;
  const status = params.status ?? "active";
  const store = await readTaskRegistryStore(params.workspaceDir);
  const index = store.tasks.findIndex((entry) => entry.taskId === taskId);
  if (index < 0) {
    const created: TaskRegistryRecord = {
      taskId,
      title,
      status,
      createdAt: now,
      lastTouchedAt: now,
      links: [],
      pinSetId: `pins:${taskId}`,
      schemaVersion: 1,
    };
    store.tasks.push(created);
    store.updatedAt = now;
    await writeTaskRegistryStore(params.workspaceDir, store);
    return created;
  }
  const existing = store.tasks[index];
  const updated: TaskRegistryRecord = {
    ...existing,
    title: params.title ? title : existing.title,
    status: params.status ?? existing.status,
    lastTouchedAt: Math.max(existing.lastTouchedAt, now),
  };
  store.tasks[index] = updated;
  store.updatedAt = Math.max(store.updatedAt, now);
  await writeTaskRegistryStore(params.workspaceDir, store);
  return updated;
}

export async function setTaskRegistryStatus(params: {
  workspaceDir: string;
  taskId: string;
  status: TaskRegistryStatus;
  now?: number;
}): Promise<TaskRegistryRecord | null> {
  const taskId = normalizeMemoryTaskId(params.taskId);
  if (!taskId) {
    return null;
  }
  const now = params.now ?? Date.now();
  const store = await readTaskRegistryStore(params.workspaceDir);
  const index = store.tasks.findIndex((entry) => entry.taskId === taskId);
  if (index < 0) {
    return null;
  }
  const existing = store.tasks[index];
  const updated: TaskRegistryRecord = {
    ...existing,
    status: params.status,
    lastTouchedAt: Math.max(existing.lastTouchedAt, now),
  };
  store.tasks[index] = updated;
  store.updatedAt = Math.max(store.updatedAt, now);
  await writeTaskRegistryStore(params.workspaceDir, store);
  return updated;
}

export async function linkTaskRegistryTasks(params: {
  workspaceDir: string;
  taskId: string;
  relatedTaskId: string;
  now?: number;
}): Promise<{ updated: boolean; task?: TaskRegistryRecord; related?: TaskRegistryRecord }> {
  const taskId = normalizeMemoryTaskId(params.taskId);
  const relatedTaskId = normalizeMemoryTaskId(params.relatedTaskId);
  if (!taskId || !relatedTaskId || taskId === relatedTaskId) {
    return { updated: false };
  }
  const now = params.now ?? Date.now();
  const store = await readTaskRegistryStore(params.workspaceDir);
  const leftIndex = store.tasks.findIndex((entry) => entry.taskId === taskId);
  const rightIndex = store.tasks.findIndex((entry) => entry.taskId === relatedTaskId);
  if (leftIndex < 0 || rightIndex < 0) {
    return { updated: false };
  }

  let updated = false;
  const left = store.tasks[leftIndex];
  const right = store.tasks[rightIndex];
  const nextLeftLinks = dedupeNormalized([...left.links, relatedTaskId]);
  const nextRightLinks = dedupeNormalized([...right.links, taskId]);
  if (nextLeftLinks.length !== left.links.length) {
    store.tasks[leftIndex] = {
      ...left,
      links: nextLeftLinks,
      lastTouchedAt: Math.max(left.lastTouchedAt, now),
    };
    updated = true;
  }
  if (nextRightLinks.length !== right.links.length) {
    store.tasks[rightIndex] = {
      ...right,
      links: nextRightLinks,
      lastTouchedAt: Math.max(right.lastTouchedAt, now),
    };
    updated = true;
  }
  if (!updated) {
    return { updated: false, task: store.tasks[leftIndex], related: store.tasks[rightIndex] };
  }
  store.updatedAt = Math.max(store.updatedAt, now);
  await writeTaskRegistryStore(params.workspaceDir, store);
  return { updated: true, task: store.tasks[leftIndex], related: store.tasks[rightIndex] };
}

async function readTransientBufferStore(workspaceDir: string): Promise<TransientBufferStore> {
  const absPath = path.join(workspaceDir, TRANSIENT_BUFFER_REL_PATH);
  try {
    const raw = await fs.readFile(absPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TransientBufferStore>;
    const items: TransientBufferItem[] = [];
    if (Array.isArray(parsed.items)) {
      for (const entry of parsed.items) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const item = entry as TransientBufferItem;
        const itemId = typeof item.itemId === "string" && item.itemId.trim() ? item.itemId : null;
        const content =
          typeof item.content === "string" && item.content.trim() ? item.content.trim() : null;
        const ttlExpiresAt =
          typeof item.ttlExpiresAt === "number" && Number.isFinite(item.ttlExpiresAt)
            ? Math.floor(item.ttlExpiresAt)
            : null;
        if (!itemId || !content || ttlExpiresAt == null) {
          continue;
        }
        const relatedTaskId = normalizeMemoryTaskId(item.relatedTaskId);
        items.push({
          itemId,
          content,
          ttlExpiresAt,
          ...(relatedTaskId ? { relatedTaskId } : {}),
        });
      }
    }
    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
          ? Math.floor(parsed.updatedAt)
          : Date.now(),
      items,
    };
  } catch {
    return defaultTransientBufferStore();
  }
}

async function writeTransientBufferStore(
  workspaceDir: string,
  store: TransientBufferStore,
): Promise<void> {
  const absPath = path.join(workspaceDir, TRANSIENT_BUFFER_REL_PATH);
  ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

export async function listTransientBufferItems(params: {
  workspaceDir: string;
  now?: number;
}): Promise<TransientBufferItem[]> {
  const now = params.now ?? Date.now();
  const store = await readTransientBufferStore(params.workspaceDir);
  return store.items
    .filter((item) => item.ttlExpiresAt > now)
    .toSorted((a, b) => a.ttlExpiresAt - b.ttlExpiresAt);
}

export async function upsertTransientBufferItem(params: {
  workspaceDir: string;
  content: string;
  ttlMs: number;
  relatedTaskId?: string;
  now?: number;
}): Promise<TransientBufferItem> {
  const now = params.now ?? Date.now();
  const content = params.content.trim();
  if (!content) {
    throw new Error("transient content required");
  }
  const ttlMs = Math.max(1, Math.floor(params.ttlMs));
  const expiresAt = now + ttlMs;
  const store = await readTransientBufferStore(params.workspaceDir);
  const item: TransientBufferItem = {
    itemId: `ttl_${crypto.randomUUID()}`,
    content,
    ttlExpiresAt: expiresAt,
    relatedTaskId: normalizeMemoryTaskId(params.relatedTaskId),
  };
  store.items = store.items.filter((entry) => entry.ttlExpiresAt > now);
  store.items.push(item);
  store.updatedAt = now;
  await writeTransientBufferStore(params.workspaceDir, store);
  return item;
}

export async function pruneExpiredTransientBufferItems(params: {
  workspaceDir: string;
  now?: number;
}): Promise<number> {
  const now = params.now ?? Date.now();
  const store = await readTransientBufferStore(params.workspaceDir);
  const before = store.items.length;
  store.items = store.items.filter((item) => item.ttlExpiresAt > now);
  const removed = before - store.items.length;
  if (removed <= 0) {
    return 0;
  }
  store.updatedAt = now;
  await writeTransientBufferStore(params.workspaceDir, store);
  return removed;
}
