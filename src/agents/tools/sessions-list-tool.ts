import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { isSubagentSessionKey, resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { defineOpenClawTool } from "../tool-contract.js";
import {
  assertKnownParams,
  formatStructuredResultForModel,
  jsonResult,
  readStringArrayParam,
} from "./common.js";
import {
  createAgentToAgentPolicy,
  classifySessionKind,
  deriveChannel,
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
  type SessionListRow,
  stripToolMessages,
} from "./sessions-helpers.js";

const SessionsListToolSchema = Type.Object(
  {
    kinds: Type.Optional(
      Type.Array(
        Type.String({
          description:
            "Optional kind filter. Supported values: main, group, cron, hook, node, other.",
        }),
      ),
    ),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        description: "Maximum number of sessions to return.",
      }),
    ),
    activeMinutes: Type.Optional(
      Type.Number({
        minimum: 1,
        description: "Only include sessions active within the last N minutes.",
      }),
    ),
    messageLimit: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Include up to N recent non-tool messages per session.",
      }),
    ),
  },
  { additionalProperties: false },
);

function resolveSandboxSessionToolsVisibility(cfg: ReturnType<typeof loadConfig>) {
  return cfg.agents?.defaults?.sandbox?.sessionToolsVisibility ?? "spawned";
}

type SessionsListWarning = {
  sessionKey: string;
  reason: string;
};

type SessionsListToolPayload = {
  count: number;
  sessions: SessionListRow[];
  partial?: boolean;
  warnings?: SessionsListWarning[];
};

const SessionsListWarningSchema = Type.Object(
  {
    sessionKey: Type.String(),
    reason: Type.String(),
  },
  { additionalProperties: false },
);

const SessionListRowSchema = Type.Object(
  {
    key: Type.String(),
    kind: Type.String(),
  },
  { additionalProperties: true },
);

const SessionsListToolOutputSchema = Type.Object(
  {
    count: Type.Number({ minimum: 0 }),
    sessions: Type.Array(SessionListRowSchema),
    partial: Type.Optional(Type.Boolean()),
    warnings: Type.Optional(Type.Array(SessionsListWarningSchema)),
  },
  { additionalProperties: false },
);

function buildSessionsListOperatorManual() {
  return [
    "Read-only discovery across main, group, cron, hook, node, and sub-agent sessions.",
    "Examples:",
    '- `{"kinds":["cron"],"limit":10}` -> recent cron sessions only',
    '- `{"activeMinutes":30,"messageLimit":2}` -> active sessions with up to 2 recent non-tool messages',
    "If `partial=true`, some per-session history lookups failed; inspect `warnings`.",
  ].join("\n");
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function summarizeSessionPreview(row: SessionListRow): Record<string, unknown> {
  return {
    key: row.key,
    kind: row.kind,
    ...(row.channel ? { channel: row.channel } : {}),
    ...(typeof row.updatedAt === "number" ? { updatedAt: row.updatedAt } : {}),
    ...(Array.isArray(row.messages) && row.messages.length > 0
      ? { messages: row.messages.slice(-2) }
      : {}),
  };
}

function formatSessionsListForModel(payload: SessionsListToolPayload): string {
  return formatStructuredResultForModel(payload, {
    emptyMessage: "No sessions matched the current filters.",
    isEmpty: (value) => value.count === 0,
    maxChars: 8_000,
    summarize: (value) => ({
      count: value.count,
      partial: value.partial === true,
      warnings: value.warnings?.slice(0, 5),
      truncated: true,
      message: "Sessions list preview truncated. Narrow filters or lower messageLimit.",
      sessions: value.sessions.slice(0, 10).map(summarizeSessionPreview),
    }),
  });
}

export function createSessionsListTool(opts?: {
  agentSessionKey?: string;
  sandboxed?: boolean;
}): AnyAgentTool {
  return defineOpenClawTool({
    label: "Sessions",
    name: "sessions_list",
    description: "List sessions with optional filters and last messages.",
    parameters: SessionsListToolSchema,
    inputSchema: SessionsListToolSchema,
    outputSchema: SessionsListToolOutputSchema,
    operatorManual: buildSessionsListOperatorManual,
    userFacingName: () => "Sessions",
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 24_000,
    mapToolResultToText: async (result) =>
      formatSessionsListForModel(result.details as SessionsListToolPayload),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      assertKnownParams(params, ["kinds", "limit", "activeMinutes", "messageLimit"], {
        label: "sessions_list",
      });
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const visibility = resolveSandboxSessionToolsVisibility(cfg);
      const requesterInternalKey =
        typeof opts?.agentSessionKey === "string" && opts.agentSessionKey.trim()
          ? resolveInternalSessionKey({
              key: opts.agentSessionKey,
              alias,
              mainKey,
            })
          : undefined;
      const restrictToSpawned =
        opts?.sandboxed === true &&
        visibility === "spawned" &&
        requesterInternalKey &&
        !isSubagentSessionKey(requesterInternalKey);

      const kindsRaw = readStringArrayParam(params, "kinds")?.map((value) =>
        value.trim().toLowerCase(),
      );
      const allowedKindsList = (kindsRaw ?? []).filter((value) =>
        ["main", "group", "cron", "hook", "node", "other"].includes(value),
      );
      const allowedKinds = allowedKindsList.length ? new Set(allowedKindsList) : undefined;

      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.floor(params.limit))
          : undefined;
      const activeMinutes =
        typeof params.activeMinutes === "number" && Number.isFinite(params.activeMinutes)
          ? Math.max(1, Math.floor(params.activeMinutes))
          : undefined;
      const messageLimitRaw =
        typeof params.messageLimit === "number" && Number.isFinite(params.messageLimit)
          ? Math.max(0, Math.floor(params.messageLimit))
          : 0;
      const messageLimit = Math.min(messageLimitRaw, 20);

      const list = await callGateway<{ sessions: Array<SessionListRow>; path: string }>({
        method: "sessions.list",
        params: {
          limit,
          activeMinutes,
          includeGlobal: !restrictToSpawned,
          includeUnknown: !restrictToSpawned,
          spawnedBy: restrictToSpawned ? requesterInternalKey : undefined,
        },
      });

      const sessions = Array.isArray(list?.sessions) ? list.sessions : [];
      const storePath = typeof list?.path === "string" ? list.path : undefined;
      const a2aPolicy = createAgentToAgentPolicy(cfg);
      const requesterAgentId = resolveAgentIdFromSessionKey(requesterInternalKey);
      const rows: SessionListRow[] = [];

      for (const entry of sessions) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const key = typeof entry.key === "string" ? entry.key : "";
        if (!key) {
          continue;
        }

        const entryAgentId = resolveAgentIdFromSessionKey(key);
        const crossAgent = entryAgentId !== requesterAgentId;
        if (crossAgent && !a2aPolicy.isAllowed(requesterAgentId, entryAgentId)) {
          continue;
        }

        if (key === "unknown") {
          continue;
        }
        if (key === "global" && alias !== "global") {
          continue;
        }

        const gatewayKind = typeof entry.kind === "string" ? entry.kind : undefined;
        const kind = classifySessionKind({ key, gatewayKind, alias, mainKey });
        if (allowedKinds && !allowedKinds.has(kind)) {
          continue;
        }

        const displayKey = resolveDisplaySessionKey({
          key,
          alias,
          mainKey,
        });

        const entryChannel = typeof entry.channel === "string" ? entry.channel : undefined;
        const deliveryContext =
          entry.deliveryContext && typeof entry.deliveryContext === "object"
            ? (entry.deliveryContext as Record<string, unknown>)
            : undefined;
        const deliveryChannel =
          typeof deliveryContext?.channel === "string" ? deliveryContext.channel : undefined;
        const deliveryTo = typeof deliveryContext?.to === "string" ? deliveryContext.to : undefined;
        const deliveryAccountId =
          typeof deliveryContext?.accountId === "string" ? deliveryContext.accountId : undefined;
        const lastChannel =
          deliveryChannel ??
          (typeof entry.lastChannel === "string" ? entry.lastChannel : undefined);
        const lastAccountId =
          deliveryAccountId ??
          (typeof entry.lastAccountId === "string" ? entry.lastAccountId : undefined);
        const derivedChannel = deriveChannel({
          key,
          kind,
          channel: entryChannel,
          lastChannel,
        });

        const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
        const transcriptPath =
          sessionId && storePath
            ? path.join(path.dirname(storePath), `${sessionId}.jsonl`)
            : undefined;

        const row: SessionListRow = {
          key: displayKey,
          kind,
          channel: derivedChannel,
          label: typeof entry.label === "string" ? entry.label : undefined,
          displayName: typeof entry.displayName === "string" ? entry.displayName : undefined,
          deliveryContext:
            deliveryChannel || deliveryTo || deliveryAccountId
              ? {
                  channel: deliveryChannel,
                  to: deliveryTo,
                  accountId: deliveryAccountId,
                }
              : undefined,
          updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : undefined,
          sessionId,
          model: typeof entry.model === "string" ? entry.model : undefined,
          contextTokens: typeof entry.contextTokens === "number" ? entry.contextTokens : undefined,
          totalTokens: typeof entry.totalTokens === "number" ? entry.totalTokens : undefined,
          thinkingLevel: typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : undefined,
          verboseLevel: typeof entry.verboseLevel === "string" ? entry.verboseLevel : undefined,
          systemSent: typeof entry.systemSent === "boolean" ? entry.systemSent : undefined,
          abortedLastRun:
            typeof entry.abortedLastRun === "boolean" ? entry.abortedLastRun : undefined,
          sendPolicy: typeof entry.sendPolicy === "string" ? entry.sendPolicy : undefined,
          lastChannel,
          lastTo: deliveryTo ?? (typeof entry.lastTo === "string" ? entry.lastTo : undefined),
          lastAccountId,
          transcriptPath,
        };

        rows.push(row);
      }

      const warnings: SessionsListWarning[] = [];
      if (messageLimit > 0 && rows.length > 0) {
        const historyResults = await Promise.all(
          rows.map(async (row) => {
            const resolvedKey = resolveInternalSessionKey({
              key: row.key,
              alias,
              mainKey,
            });
            try {
              const history = await callGateway<{ messages: Array<unknown> }>({
                method: "chat.history",
                params: { sessionKey: resolvedKey, limit: messageLimit },
              });
              const rawMessages = Array.isArray(history?.messages) ? history.messages : [];
              const filtered = stripToolMessages(rawMessages);
              return {
                sessionKey: row.key,
                messages: filtered.length > messageLimit ? filtered.slice(-messageLimit) : filtered,
              };
            } catch (error) {
              return {
                sessionKey: row.key,
                warning: {
                  sessionKey: row.key,
                  reason: extractErrorMessage(error),
                } satisfies SessionsListWarning,
              };
            }
          }),
        );

        for (const result of historyResults) {
          const row = rows.find((entry) => entry.key === result.sessionKey);
          if (!row) {
            continue;
          }
          if ("warning" in result) {
            warnings.push(result.warning);
            continue;
          }
          row.messages = result.messages;
        }
      }

      const payload: SessionsListToolPayload = {
        count: rows.length,
        sessions: rows,
        ...(warnings.length > 0 ? { partial: true, warnings } : {}),
      };
      return jsonResult(payload);
    },
  });
}
