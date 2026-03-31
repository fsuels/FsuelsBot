import { Type } from "@sinclair/typebox";
import type { CronDelivery, CronMessageChannel } from "../../cron/types.js";
import { loadConfig } from "../../config/config.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import { formatDurationHuman } from "../../infra/format-time/format-duration.ts";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { truncateUtf16Safe } from "../../utils.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import {
  defineOpenClawTool,
  type ToolInvocationContract,
  toolValidationError,
  toolValidationOk,
} from "../tool-contract.js";
import {
  hasActionField,
  validateFlatActionInput,
  type ActionValidationRule,
} from "./action-validation.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

// NOTE: We use Type.Object({}, { additionalProperties: true }) for job/patch
// instead of CronAddParamsSchema/CronJobPatchSchema because the gateway schemas
// contain nested unions. Tool schemas need to stay provider-friendly, so we
// accept "any object" here and validate at runtime.

const CRON_ACTIONS = ["status", "list", "add", "update", "remove", "run", "runs", "wake"] as const;

const CRON_WAKE_MODES = ["now", "next-heartbeat"] as const;
const CRON_RUN_MODES = ["due", "force"] as const;

const REMINDER_CONTEXT_MESSAGES_MAX = 10;
const REMINDER_CONTEXT_PER_MESSAGE_MAX = 220;
const REMINDER_CONTEXT_TOTAL_MAX = 700;
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";

// Flattened schema: runtime validates per-action requirements.
const CronToolSchema = Type.Object({
  action: stringEnum(CRON_ACTIONS),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  includeDisabled: Type.Optional(Type.Boolean()),
  job: Type.Optional(Type.Object({}, { additionalProperties: true })),
  jobId: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  patch: Type.Optional(Type.Object({}, { additionalProperties: true })),
  text: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.Object({}, { additionalProperties: true })),
  sessionTarget: Type.Optional(Type.String()),
  wakeMode: Type.Optional(Type.String()),
  payload: Type.Optional(Type.Object({}, { additionalProperties: true })),
  delivery: Type.Optional(Type.Object({}, { additionalProperties: true })),
  enabled: Type.Optional(Type.Boolean()),
  description: Type.Optional(Type.String()),
  deleteAfterRun: Type.Optional(Type.Boolean()),
  agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  message: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  timeoutSeconds: Type.Optional(Type.Number()),
  allowUnsafeExternalContent: Type.Optional(Type.Boolean()),
  mode: optionalStringEnum(CRON_WAKE_MODES),
  runMode: optionalStringEnum(CRON_RUN_MODES),
  contextMessages: Type.Optional(
    Type.Number({ minimum: 0, maximum: REMINDER_CONTEXT_MESSAGES_MAX }),
  ),
});

const CRON_ID_GROUP = {
  keys: ["jobId", "id"],
  label: "jobId or id",
};

const CRON_ACTION_RULES: Record<string, ActionValidationRule> = {
  status: {},
  list: {},
  add: {
    custom: (input) => {
      if (hasActionField(input, { key: "job", presence: "defined" })) {
        return undefined;
      }
      const hasFlattenedJobSignal =
        hasActionField(input, { key: "schedule", presence: "defined" }) ||
        hasActionField(input, { key: "payload", presence: "defined" }) ||
        hasActionField(input, "message") ||
        hasActionField(input, "text");
      return hasFlattenedJobSignal
        ? undefined
        : "job required for action=add (flattened job fields like schedule/payload/message/text are also accepted)";
    },
  },
  update: {
    required: [{ key: "patch", label: "patch", presence: "defined" }],
    oneOf: [CRON_ID_GROUP],
  },
  remove: {
    oneOf: [CRON_ID_GROUP],
  },
  run: {
    oneOf: [CRON_ID_GROUP],
  },
  runs: {
    oneOf: [CRON_ID_GROUP],
  },
  wake: {
    required: ["text"],
  },
};

const CronToolOutputSchema = Type.Object(
  {
    action: stringEnum(CRON_ACTIONS),
    result: Type.Unknown(),
  },
  { additionalProperties: false },
);

const CRON_TOOL_INVOCATION_CONTRACT: ToolInvocationContract = {
  usagePolicy: "explicit_only",
  sideEffectLevel: "high",
  whenToUse: [
    "The user explicitly asks for a reminder, scheduled follow-up, recurring automation, or cron job management.",
    "You need durable work that must survive process restarts.",
  ],
  whenNotToUse: [
    "Do not use cron for work that should happen right now in the current turn.",
    "Do not infer scheduling from a generic request to fix or investigate something.",
    "Do not use wake/add as a substitute for replying directly to the current user.",
  ],
  preconditions: [
    "Choose the correct action first: add/update/remove/run/runs/wake/status/list.",
    "If a future run must reach a specific chat, include the delivery target explicitly.",
  ],
  behaviorSummary:
    "Creates, updates, removes, or triggers Gateway scheduler jobs. Jobs are durable; wake requests are immediate and non-persistent.",
  parametersSummary: [
    "action: the scheduler operation to perform.",
    "job or flattened add fields: full job payload when action=add.",
    "jobId or id: existing cron job identifier for update/remove/run/runs.",
    "patch: partial job update payload for action=update.",
    "text: wake/reminder text for action=wake.",
    "contextMessages: optional recent-session context to append to reminder-style systemEvent text.",
  ],
};

type CronToolOptions = {
  agentSessionKey?: string;
};

type CronToolAction = (typeof CRON_ACTIONS)[number];
type CronToolPayload = {
  action: CronToolAction;
  result: unknown;
};

type ChatMessage = {
  role?: unknown;
  content?: unknown;
};

const ADD_JOB_KEYS: ReadonlySet<string> = new Set([
  "name",
  "schedule",
  "sessionTarget",
  "wakeMode",
  "payload",
  "delivery",
  "enabled",
  "description",
  "deleteAfterRun",
  "agentId",
  "message",
  "text",
  "model",
  "thinking",
  "timeoutSeconds",
  "allowUnsafeExternalContent",
]);

function stripExistingContext(text: string) {
  const index = text.indexOf(REMINDER_CONTEXT_MARKER);
  if (index === -1) {
    return text;
  }
  return text.slice(0, index).trim();
}

function truncateText(input: string, maxLen: number) {
  if (input.length <= maxLen) {
    return input;
  }
  const truncated = truncateUtf16Safe(input, Math.max(0, maxLen - 3)).trimEnd();
  return `${truncated}...`;
}

function normalizeContextText(raw: string) {
  return raw.replace(/\s+/g, " ").trim();
}

function extractMessageText(message: ChatMessage): { role: string; text: string } | null {
  const role = typeof message.role === "string" ? message.role : "";
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  const content = message.content;
  if (typeof content === "string") {
    const normalized = normalizeContextText(content);
    return normalized ? { role, text: normalized } : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if ((block as { type?: unknown }).type !== "text") {
      continue;
    }
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      chunks.push(text);
    }
  }
  const joined = normalizeContextText(chunks.join(" "));
  return joined ? { role, text: joined } : null;
}

async function buildReminderContextLines(params: {
  agentSessionKey?: string;
  gatewayOpts: GatewayCallOptions;
  contextMessages: number;
}) {
  const maxMessages = Math.min(
    REMINDER_CONTEXT_MESSAGES_MAX,
    Math.max(0, Math.floor(params.contextMessages)),
  );
  if (maxMessages <= 0) {
    return [];
  }
  const sessionKey = params.agentSessionKey?.trim();
  if (!sessionKey) {
    return [];
  }
  const cfg = loadConfig();
  const { mainKey, alias } = resolveMainSessionAlias(cfg);
  const resolvedKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
  try {
    const res = await callGatewayTool<{ messages: Array<unknown> }>(
      "chat.history",
      params.gatewayOpts,
      {
        sessionKey: resolvedKey,
        limit: maxMessages,
      },
    );
    const messages = Array.isArray(res?.messages) ? res.messages : [];
    const parsed = messages
      .map((msg) => extractMessageText(msg as ChatMessage))
      .filter((msg): msg is { role: string; text: string } => Boolean(msg));
    const recent = parsed.slice(-maxMessages);
    if (recent.length === 0) {
      return [];
    }
    const lines: string[] = [];
    let total = 0;
    for (const entry of recent) {
      const label = entry.role === "user" ? "User" : "Assistant";
      const text = truncateText(entry.text, REMINDER_CONTEXT_PER_MESSAGE_MAX);
      const line = `- ${label}: ${text}`;
      total += line.length;
      if (total > REMINDER_CONTEXT_TOTAL_MAX) {
        break;
      }
      lines.push(line);
    }
    return lines;
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildCronToolOperatorManual() {
  return [
    "Purpose: manage durable Gateway scheduler jobs and immediate wake requests.",
    "Defaults: prefer action=add with sessionTarget=isolated and payload.kind=agentTurn for follow-ups, reminders, or background agent work. Use sessionTarget=main only when you intentionally want a systemEvent injected into the main session.",
    "Schedules: use schedule.kind=at for one-shots, every for fixed intervals, cron for recurring wall-clock schedules. If the user gives a local wall-clock time, include schedule.tz explicitly instead of relying on the Gateway host timezone.",
    "Approximate times: when the user does not care about the exact minute, avoid synchronized defaults like :00 and :30. Pick a nearby uneven minute such as :07, :13, :37, or :43 to spread load.",
    "Delivery: for isolated jobs, put channel/to on the top-level delivery object. Do not plan to call message tools inside the future run just to reach a recipient.",
    "Lifecycle disclosure: when creating or updating a job, tell the user whether it is one-shot or recurring, whether it is durable, when it should run next, and how to cancel it with action=remove and the returned job id.",
    "Context: contextMessages only helps systemEvent reminder text. Use it when the reminder should carry a small amount of recent context into the future prompt.",
    "Wake vs add: use wake for immediate nudges that should not persist. Use add when the work must survive process restarts.",
    "Anti-patterns: do not use cron for a task that should happen right now, do not omit delivery targets when the future run must reach a specific chat, and do not assume the model inside a future isolated run will remember current context unless you include it in the payload.",
  ].join("\n");
}

function buildGatewayOptions(params: Record<string, unknown>): GatewayCallOptions {
  return {
    gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
    gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
    timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 60_000,
  };
}

function maybeRecoverFlatAddJob(params: Record<string, unknown>) {
  if (params.job && (!isRecord(params.job) || Object.keys(params.job).length > 0)) {
    return params;
  }

  const synthetic: Record<string, unknown> = {};
  let found = false;
  for (const key of Object.keys(params)) {
    if (ADD_JOB_KEYS.has(key) && params[key] !== undefined) {
      synthetic[key] = params[key];
      found = true;
    }
  }

  if (
    found &&
    (synthetic.schedule !== undefined ||
      synthetic.payload !== undefined ||
      synthetic.message !== undefined ||
      synthetic.text !== undefined)
  ) {
    return { ...params, job: synthetic };
  }

  return params;
}

function resolveCanonicalJobId(params: Record<string, unknown>) {
  const id = readStringParam(params, "jobId") ?? readStringParam(params, "id");
  if (!id) {
    throw new Error("jobId required (id accepted for backward compatibility)");
  }
  return id;
}

function resolveActionOrThrow(input: unknown) {
  if (!isRecord(input)) {
    throw new Error("action required");
  }
  return readStringParam(input, "action", { required: true }) as CronToolAction;
}

function normalizeCronToolInput(input: unknown, opts?: CronToolOptions): Record<string, unknown> {
  const action = resolveActionOrThrow(input);
  const params: Record<string, unknown> = isRecord(input) ? { ...input, action } : { action };
  const gatewayFields = {
    gatewayUrl: params.gatewayUrl,
    gatewayToken: params.gatewayToken,
    timeoutMs: params.timeoutMs,
  };
  const flatValidation = validateFlatActionInput({
    toolName: "cron",
    action,
    input: params,
    rules: CRON_ACTION_RULES,
  });
  if (!flatValidation.result) {
    throw new Error(flatValidation.message);
  }

  switch (action) {
    case "status":
      return { action, ...gatewayFields } satisfies Record<string, unknown>;
    case "list":
      return {
        ...gatewayFields,
        action,
        includeDisabled: Boolean(params.includeDisabled),
      } satisfies Record<string, unknown>;
    case "add": {
      const recovered = maybeRecoverFlatAddJob(params);
      if (!isRecord(recovered.job)) {
        throw new Error("job required");
      }
      const job = normalizeCronJobCreate(recovered.job) ?? recovered.job;
      if (job && isRecord(job) && !("agentId" in job)) {
        const cfg = loadConfig();
        const agentId = opts?.agentSessionKey
          ? resolveSessionAgentId({ sessionKey: opts.agentSessionKey, config: cfg })
          : undefined;
        if (agentId) {
          job.agentId = agentId;
        }
      }
      return {
        ...recovered,
        action,
        job,
      };
    }
    case "update":
      return {
        ...params,
        action,
        jobId: resolveCanonicalJobId(params),
        patch: isRecord(params.patch)
          ? (normalizeCronJobPatch(params.patch) ?? params.patch)
          : params.patch,
      };
    case "remove":
      return {
        ...gatewayFields,
        action,
        jobId: resolveCanonicalJobId(params),
      };
    case "run":
      return {
        ...gatewayFields,
        action,
        jobId: resolveCanonicalJobId(params),
        runMode: params.runMode === "due" || params.runMode === "force" ? params.runMode : "force",
      };
    case "runs":
      return {
        ...gatewayFields,
        action,
        jobId: resolveCanonicalJobId(params),
      };
    case "wake":
      return {
        ...gatewayFields,
        action,
        text: readStringParam(params, "text", { required: true }),
        mode:
          params.mode === "now" || params.mode === "next-heartbeat"
            ? params.mode
            : "next-heartbeat",
      };
    default:
      throw new Error(`Unsupported cron action: ${action}`);
  }
}

function formatTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "not scheduled";
  }
  return new Date(value).toISOString();
}

function formatScheduleSummary(schedule: unknown) {
  if (!isRecord(schedule)) {
    return "unknown schedule";
  }
  if (schedule.kind === "at" && typeof schedule.at === "string") {
    return `at ${schedule.at}`;
  }
  if (schedule.kind === "every" && typeof schedule.everyMs === "number") {
    return `every ${formatDurationHuman(schedule.everyMs)}`;
  }
  if (schedule.kind === "cron" && typeof schedule.expr === "string") {
    const tz =
      typeof schedule.tz === "string" && schedule.tz.trim() ? ` (${schedule.tz.trim()})` : "";
    return `cron ${schedule.expr}${tz}`;
  }
  return "unknown schedule";
}

function formatJobLifecycle(job: Record<string, unknown>) {
  const recurring = isRecord(job.schedule) && job.schedule.kind !== "at";
  const cadence = recurring ? "recurring" : "one-shot";
  const target = typeof job.sessionTarget === "string" ? job.sessionTarget : "unknown-target";
  const payloadKind =
    isRecord(job.payload) && typeof job.payload.kind === "string"
      ? job.payload.kind
      : "unknown-payload";
  const nextRunAt = isRecord(job.state) ? formatTimestamp(job.state.nextRunAtMs) : "not scheduled";
  return `${cadence}; target=${target}; payload=${payloadKind}; next=${nextRunAt}`;
}

function formatCronToolResultText(payload: CronToolPayload) {
  const result = isRecord(payload.result) ? payload.result : null;
  switch (payload.action) {
    case "status":
      return result
        ? `Cron scheduler ${result.enabled === false ? "disabled" : "enabled"}. Jobs: ${
            typeof result.jobs === "number" ? result.jobs : "unknown"
          }. Next wake: ${formatTimestamp(result.nextWakeAtMs)}.`
        : "Fetched cron scheduler status.";
    case "list": {
      const jobs = Array.isArray(result?.jobs) ? result.jobs.filter(isRecord) : [];
      if (jobs.length === 0) {
        return "Listed cron jobs. No matching jobs found.";
      }
      const first = jobs[0];
      const name = typeof first?.name === "string" ? first.name : first?.id;
      return `Listed ${jobs.length} cron job${jobs.length === 1 ? "" : "s"}. Next: ${name ?? "unknown"} (${formatScheduleSummary(first?.schedule)}).`;
    }
    case "add": {
      const job = result;
      return job
        ? `Created cron job ${typeof job.id === "string" ? job.id : "unknown"} (${typeof job.name === "string" ? job.name : "unnamed"}). ${formatScheduleSummary(job.schedule)}. ${formatJobLifecycle(job)}. Cancel with action=remove and jobId=${typeof job.id === "string" ? job.id : "<job-id>"}.`
        : "Created cron job.";
    }
    case "update": {
      const job = result;
      return job
        ? `Updated cron job ${typeof job.id === "string" ? job.id : "unknown"} (${typeof job.name === "string" ? job.name : "unnamed"}). ${formatScheduleSummary(job.schedule)}. ${formatJobLifecycle(job)}.`
        : "Updated cron job.";
    }
    case "remove":
      return result?.removed
        ? "Removed cron job."
        : "No cron job was removed because the job id was not found.";
    case "run":
      if (!result) {
        return "Requested cron job run.";
      }
      if (result.ran === true) {
        return "Triggered cron job run immediately.";
      }
      if (result.reason === "already-running") {
        return "Cron job was already running, so no duplicate run was started.";
      }
      if (result.reason === "not-due") {
        return "Cron job was not due, so no run was started.";
      }
      return "Processed cron job run request.";
    case "runs": {
      const entries = Array.isArray(result?.entries) ? result.entries.filter(isRecord) : [];
      if (entries.length === 0) {
        return "Fetched cron run history. No runs were recorded.";
      }
      const latest = entries[0];
      return `Fetched ${entries.length} cron run record${entries.length === 1 ? "" : "s"}. Latest status: ${
        typeof latest.status === "string" ? latest.status : "unknown"
      } at ${formatTimestamp(latest.runAtMs ?? latest.ts)}.`;
    }
    case "wake":
      return "Queued a wake request for the Gateway scheduler.";
    default:
      return "Processed cron tool action.";
  }
}

function buildCronToolResult(payload: CronToolPayload) {
  const result = jsonResult(payload);
  result.content = [
    {
      type: "text",
      text: formatCronToolResultText(payload),
    },
  ];
  return result;
}

function stripThreadSuffixFromSessionKey(sessionKey: string): string {
  const normalized = sessionKey.toLowerCase();
  const idx = normalized.lastIndexOf(":thread:");
  if (idx <= 0) {
    return sessionKey;
  }
  const parent = sessionKey.slice(0, idx).trim();
  return parent ? parent : sessionKey;
}

function inferDeliveryFromSessionKey(agentSessionKey?: string): CronDelivery | null {
  const rawSessionKey = agentSessionKey?.trim();
  if (!rawSessionKey) {
    return null;
  }
  const parsed = parseAgentSessionKey(stripThreadSuffixFromSessionKey(rawSessionKey));
  if (!parsed || !parsed.rest) {
    return null;
  }
  const parts = parsed.rest.split(":").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const head = parts[0]?.trim().toLowerCase();
  if (!head || head === "main" || head === "subagent" || head === "acp") {
    return null;
  }

  // buildAgentPeerSessionKey encodes peers as:
  // - direct:<peerId>
  // - <channel>:direct:<peerId>
  // - <channel>:<accountId>:direct:<peerId>
  // - <channel>:group:<peerId>
  // - <channel>:channel:<peerId>
  // Note: legacy keys may use "dm" instead of "direct".
  // Threaded sessions append :thread:<id>, which we strip so delivery targets the parent peer.
  // NOTE: Telegram forum topics encode as <chatId>:topic:<topicId> and should be preserved.
  const markerIndex = parts.findIndex(
    (part) => part === "direct" || part === "dm" || part === "group" || part === "channel",
  );
  if (markerIndex === -1) {
    return null;
  }
  const peerId = parts
    .slice(markerIndex + 1)
    .join(":")
    .trim();
  if (!peerId) {
    return null;
  }

  let channel: CronMessageChannel | undefined;
  if (markerIndex >= 1) {
    channel = parts[0]?.trim().toLowerCase() as CronMessageChannel;
  }

  const delivery: CronDelivery = { mode: "announce", to: peerId };
  if (channel) {
    delivery.channel = channel;
  }
  return delivery;
}

export function createCronTool(opts?: CronToolOptions): AnyAgentTool {
  const executeAction = async (
    normalizedInput: Record<string, unknown>,
  ): Promise<CronToolPayload> => {
    const action = normalizedInput.action as CronToolAction;
    const gatewayOpts = buildGatewayOptions(normalizedInput);

    switch (action) {
      case "status":
        return {
          action,
          result: await callGatewayTool("cron.status", gatewayOpts, {}),
        };
      case "list":
        return {
          action,
          result: await callGatewayTool("cron.list", gatewayOpts, {
            includeDisabled: Boolean(normalizedInput.includeDisabled),
          }),
        };
      case "add": {
        const job = isRecord(normalizedInput.job)
          ? { ...normalizedInput.job }
          : normalizedInput.job;
        if (!isRecord(job)) {
          throw new Error("job required");
        }

        if (opts?.agentSessionKey && isRecord(job.payload) && job.payload.kind === "agentTurn") {
          const deliveryValue = job.delivery;
          const delivery = isRecord(deliveryValue) ? deliveryValue : undefined;
          const modeRaw = typeof delivery?.mode === "string" ? delivery.mode : "";
          const mode = modeRaw.trim().toLowerCase();
          const hasTarget =
            (typeof delivery?.channel === "string" && delivery.channel.trim()) ||
            (typeof delivery?.to === "string" && delivery.to.trim());
          const shouldInfer = (deliveryValue == null || delivery) && mode !== "none" && !hasTarget;
          if (shouldInfer) {
            const inferred = inferDeliveryFromSessionKey(opts.agentSessionKey);
            if (inferred) {
              job.delivery = {
                ...delivery,
                ...inferred,
              } satisfies CronDelivery;
            }
          }
        }

        const contextMessages =
          typeof normalizedInput.contextMessages === "number" &&
          Number.isFinite(normalizedInput.contextMessages)
            ? normalizedInput.contextMessages
            : 0;
        if (isRecord(job.payload) && job.payload.kind === "systemEvent") {
          const payload = job.payload as { kind: string; text: string };
          if (typeof payload.text === "string" && payload.text.trim()) {
            const contextLines = await buildReminderContextLines({
              agentSessionKey: opts?.agentSessionKey,
              gatewayOpts,
              contextMessages,
            });
            if (contextLines.length > 0) {
              const baseText = stripExistingContext(payload.text);
              payload.text = `${baseText}${REMINDER_CONTEXT_MARKER}${contextLines.join("\n")}`;
            }
          }
        }

        return {
          action,
          result: await callGatewayTool("cron.add", gatewayOpts, job),
        };
      }
      case "update":
        return {
          action,
          result: await callGatewayTool("cron.update", gatewayOpts, {
            id: normalizedInput.jobId,
            patch: normalizedInput.patch,
          }),
        };
      case "remove":
        return {
          action,
          result: await callGatewayTool("cron.remove", gatewayOpts, {
            id: normalizedInput.jobId,
          }),
        };
      case "run":
        return {
          action,
          result: await callGatewayTool("cron.run", gatewayOpts, {
            id: normalizedInput.jobId,
            mode: normalizedInput.runMode,
          }),
        };
      case "runs":
        return {
          action,
          result: await callGatewayTool("cron.runs", gatewayOpts, {
            id: normalizedInput.jobId,
          }),
        };
      case "wake":
        return {
          action,
          result: await callGatewayTool(
            "wake",
            gatewayOpts,
            {
              mode: normalizedInput.mode,
              text: normalizedInput.text,
            },
            { expectFinal: false },
          ),
        };
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  };

  return defineOpenClawTool({
    label: "Cron",
    name: "cron",
    description:
      "Manage Gateway cron jobs and wake events. Use add/update/remove/run/runs for scheduler work, and wake for immediate non-persistent nudges.",
    parameters: CronToolSchema,
    outputSchema: CronToolOutputSchema,
    operatorManual: buildCronToolOperatorManual,
    invocationContract: CRON_TOOL_INVOCATION_CONTRACT,
    validateInput: async (input, _context) => {
      try {
        return toolValidationOk({
          params: normalizeCronToolInput(input, opts),
        });
      } catch (error) {
        return toolValidationError({
          code: "invalid_input",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    call: async (input) => ({
      data: await executeAction(input as Record<string, unknown>),
    }),
    mapToolResultToText: async (result) => {
      if (!isRecord(result.details) || typeof result.details.action !== "string") {
        return Array.isArray(result.content) && result.content[0]?.type === "text"
          ? result.content[0].text
          : JSON.stringify(result.details, null, 2);
      }
      return formatCronToolResultText(result.details as CronToolPayload);
    },
    execute: async (_toolCallId, args) => {
      const normalized = normalizeCronToolInput(args, opts);
      return buildCronToolResult(await executeAction(normalized));
    },
  });
}
