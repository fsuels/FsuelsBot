import type { Skill } from "@mariozechner/pi-coding-agent";
import crypto from "node:crypto";
import type { CapabilityEntry } from "../../agents/capability-ledger.js";
import type { CoherenceEntry } from "../../agents/coherence-log.js";
import type { EventVerb } from "../../agents/coherence-log.js";
import type { CorrectionEvent } from "../../agents/drift-detection.js";
import type { ToolFailureRecord, FailureSignature } from "../../agents/tool-failure-tracker.js";
import type { ChatType } from "../../channels/chat-type.js";
import type { ChannelId } from "../../channels/plugins/types.js";
import type { DeliveryContext } from "../../utils/delivery-context.js";
import type { TtsAutoMode } from "../types.tts.js";
import type { SessionWorkspaceFingerprint } from "./workspace.js";

// -- Cross-Session Event Promotion (RSC v3.1) --

/** Intermediate tracking for events observed across sessions but not yet promoted. */
export type PromotionCandidate = {
  verb: EventVerb;
  subject: string;
  outcome: string;
  /** Session keys where this pattern was observed. */
  seenInSessions: string[];
  /** Timestamps of observations. */
  seenTimestamps: number[];
};

/** An event pattern promoted to agent-level cross-session memory. */
export type PromotedEvent = {
  verb: EventVerb;
  subject: string;
  outcome: string;
  /** How many times this event pattern was seen across sessions. */
  occurrences: number;
  /** First time this pattern was seen. */
  firstSeenTs: number;
  /** Last time this pattern was seen. */
  lastSeenTs: number;
  /** Session keys that contributed to this promotion. */
  sourceSessionKeys: string[];
  /** Event retires if not reinforced by this timestamp. */
  retireAfterTs: number;
};

export type SessionScope = "per-sender" | "global";

export type SessionChannelId = ChannelId | "webchat";

export type SessionChatType = ChatType;

export type SessionOrigin = {
  label?: string;
  provider?: string;
  surface?: string;
  chatType?: SessionChatType;
  from?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
};

export type SessionTaskState = {
  status?: "active" | "paused" | "completed" | "archived";
  title?: string;
  updatedAt: number;
  compactionCount?: number;
  totalTokens?: number;
  memoryFlushAt?: number;
  memoryFlushCompactionCount?: number;
};

export type SessionTaskSwitchAudit = {
  fromTaskId?: string;
  toTaskId: string;
  switchedAt: number;
  source?: string;
};

export type SessionClarificationPreviewFormat = "markdown";

export type SessionClarificationOption = {
  id: string;
  label: string;
  description: string;
  preview?: string;
  previewFormat?: SessionClarificationPreviewFormat;
};

export type SessionClarificationQuestion = {
  id: string;
  header: string;
  question: string;
  multiSelect: boolean;
  allowOther: boolean;
  recommendedOptionId?: string;
  metadata?: {
    source?: string;
    reason?: string;
  };
  options: SessionClarificationOption[];
};

export type SessionClarificationDelivery = {
  transport: "telegram_buttons" | "plain_text" | "tool_result" | "assumption";
  channel?: string;
  target?: string;
  interactiveUi: boolean;
  fallbackUsed: boolean;
};

export type SessionClarificationAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  otherText?: string;
  notes?: string;
  selectedPreview?: string;
};

export type SessionClarificationPending = {
  promptId: string;
  askedAt: number;
  promptText: string;
  delivery: SessionClarificationDelivery;
  questions: SessionClarificationQuestion[];
};

export type SessionClarificationTelemetry = {
  promptId: string;
  status: "asked" | "answered" | "declined" | "assumed" | "timed_out";
  recordedAt: number;
  source?: string;
  reason?: string;
  channel?: string;
  transport?: SessionClarificationDelivery["transport"];
  interactiveUi?: boolean;
  fallbackUsed?: boolean;
  timeToAnswerMs?: number;
  changedExecutionPath?: boolean;
};

export type SessionEntry = {
  /**
   * Last delivered heartbeat payload (used to suppress duplicate heartbeat notifications).
   * Stored on the main session entry.
   */
  lastHeartbeatText?: string;
  /** Timestamp (ms) when lastHeartbeatText was delivered. */
  lastHeartbeatSentAt?: number;
  sessionId: string;
  updatedAt: number;
  sessionFile?: string;
  /** Parent session key that spawned this session (used for sandbox session-tool scoping). */
  spawnedBy?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  chatType?: SessionChatType;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  ttsAuto?: TtsAutoMode;
  execHost?: string;
  execSecurity?: string;
  execAsk?: string;
  execNode?: string;
  responseUsage?: "on" | "off" | "tokens" | "full";
  providerOverride?: string;
  modelOverride?: string;
  authProfileOverride?: string;
  authProfileOverrideSource?: "auto" | "user";
  authProfileOverrideCompactionCount?: number;
  activeTaskId?: string;
  activeTaskTitle?: string;
  taskStack?: string[];
  taskStateById?: Record<string, SessionTaskState>;
  lastTaskSwitch?: SessionTaskSwitchAudit;
  lastTaskSwitchAt?: number;
  autoSwitchOptIn?: boolean;
  taskSwitchThrashCounter?: number;
  taskMismatchCounter?: number;
  lastRetrievalRejectAt?: number;
  memoryGuidanceMode?: "supportive" | "minimal";
  memoryGuidancePromptCount?: number;
  memoryGuidanceExplicitCount?: number;
  memoryGuidanceIgnoredCount?: number;
  memoryGuidanceLastNudgeKind?: string;
  memoryGuidanceLastNudgeAt?: number;
  groupActivation?: "mention" | "always";
  groupActivationNeedsSystemIntro?: boolean;
  sendPolicy?: "allow" | "deny";
  collaborationMode?: "plan";
  planProfile?: "proactive" | "conservative";
  queueMode?:
    | "steer"
    | "followup"
    | "collect"
    | "steer-backlog"
    | "steer+backlog"
    | "queue"
    | "interrupt";
  queueDebounceMs?: number;
  queueCap?: number;
  queueDrop?: "old" | "new" | "summarize";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelProvider?: string;
  model?: string;
  contextTokens?: number;
  compactionCount?: number;
  memoryFlushAt?: number;
  memoryFlushCompactionCount?: number;
  cliSessionIds?: Record<string, string>;
  claudeCliSessionId?: string;
  label?: string;
  tag?: string;
  displayName?: string;
  channel?: string;
  groupId?: string;
  subject?: string;
  groupChannel?: string;
  space?: string;
  origin?: SessionOrigin;
  deliveryContext?: DeliveryContext;
  workspaceFingerprint?: SessionWorkspaceFingerprint;
  lastChannel?: SessionChannelId;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
  skillsSnapshot?: SessionSkillSnapshot;
  systemPromptReport?: SessionSystemPromptReport;
  // -- Drift Detection (RSC v2.0) --
  driftEvents?: CorrectionEvent[];
  driftBaselineRate?: number;
  driftBaselineTurns?: number;
  driftLevel?: string;
  driftLevelChangedAt?: number;
  driftResponseCount?: number;
  // -- Coherence Log (RSC v2.0 capture) --
  coherenceEntries?: CoherenceEntry[];
  coherencePinned?: CoherenceEntry[];
  // -- Tool Failure Tracking (RSC v2.1) --
  toolFailures?: ToolFailureRecord[];
  failureSignatures?: FailureSignature[];
  // -- Cross-Session Event Promotion (RSC v3.1) --
  promotionCandidates?: PromotionCandidate[];
  promotedEvents?: PromotedEvent[];
  // -- Capability Ledger (RSC v3.2) --
  capabilityLedger?: CapabilityEntry[];
  // -- Task Checkpoint (auto-save cadence) --
  /** Counts completed reply turns in this session; used to trigger periodic task checkpoints. */
  replyCount?: number;
  pendingClarification?: SessionClarificationPending;
  clarificationTelemetry?: SessionClarificationTelemetry[];
};

export function mergeSessionEntry(
  existing: SessionEntry | undefined,
  patch: Partial<SessionEntry>,
): SessionEntry {
  const sessionId = patch.sessionId ?? existing?.sessionId ?? crypto.randomUUID();
  const updatedAt = Math.max(existing?.updatedAt ?? 0, patch.updatedAt ?? 0, Date.now());
  if (!existing) {
    return { ...patch, sessionId, updatedAt };
  }
  return { ...existing, ...patch, sessionId, updatedAt };
}

export type GroupKeyResolution = {
  key: string;
  channel?: string;
  id?: string;
  chatType?: SessionChatType;
};

export type SessionSkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string }>;
  resolvedSkills?: Skill[];
  version?: number;
};

export type SessionSystemPromptReport = {
  source: "run" | "estimate";
  generatedAt: number;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  workspaceDir?: string;
  bootstrapMaxChars?: number;
  sandbox?: {
    mode?: string;
    sandboxed?: boolean;
  };
  systemPrompt: {
    chars: number;
    projectContextChars: number;
    nonProjectContextChars: number;
  };
  cache?: {
    boundaryMarker: string;
    staticPrefixHash: string;
    staticPrefixChars: number;
    dynamicTailChars: number;
    staticPrefixCacheStatus: "hit" | "miss";
    staticPrefixSeenCount: number;
    recomputedSectionCount: number;
    staticSectionNames: string[];
    dynamicSectionNames: string[];
  };
  injectedWorkspaceFiles: Array<{
    name: string;
    path: string;
    missing: boolean;
    rawChars: number;
    injectedChars: number;
    truncated: boolean;
    synthetic?: boolean;
    sourceGroup?: "project" | "user" | "managed" | "built-in" | "unknown";
  }>;
  skills: {
    promptChars: number;
    availableCount?: number;
    loadedCount?: number;
    entries: Array<{
      name: string;
      blockChars: number;
      sourceCategory?: "bundled" | "workspace" | "managed" | "plugin" | "extra" | "unknown";
    }>;
  };
  tools: {
    listChars: number;
    schemaChars: number;
    entries: Array<{
      name: string;
      summaryChars: number;
      schemaChars: number;
      propertiesCount?: number | null;
    }>;
  };
  modelView?: {
    branchHistoryMessages: number;
    branchHistoryTokens: number;
    scopedHistoryMessages: number;
    scopedHistoryTokens: number;
    sanitizedHistoryMessages: number;
    sanitizedHistoryTokens: number;
    validatedHistoryMessages: number;
    validatedHistoryTokens: number;
    limitedHistoryMessages: number;
    limitedHistoryTokens: number;
    projectedHistoryMessages: number;
    projectedHistoryTokens: number;
    taskScoped: boolean;
    dmHistoryLimit?: number;
    truncatedToolResults: number;
    systemPromptTokens: number;
    toolSchemaTokens: number;
    projectedTotalTokens: number;
    contextWindowTokens?: number;
    contextPressure?: number;
    historyStages?: Array<{
      key: "branch" | "scoped" | "sanitized" | "validated" | "limited" | "projected";
      label: string;
      messages: number;
      tokens: number;
      changed: boolean;
      savingsTokens: number;
      reason?: string;
    }>;
  };
};

export const DEFAULT_RESET_TRIGGER = "/new";
export const DEFAULT_RESET_TRIGGERS = ["/new", "/reset"];
export const DEFAULT_IDLE_MINUTES = 60;
