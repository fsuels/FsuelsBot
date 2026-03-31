import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { formatDurationCompact } from "../infra/format-time/format-duration.ts";
import {
  deleteSession,
  drainSession,
  getFinishedSession,
  getSession,
  listFinishedSessions,
  listRunningSessions,
  markExited,
  setJobTtlMs,
} from "./bash-process-registry.js";
import {
  deriveSessionName,
  killSession,
  pad,
  sliceLogLines,
  truncateMiddle,
} from "./bash-tools.shared.js";
import { encodeKeySequence, encodePaste } from "./pty-keys.js";
import { assertKnownParams, readAliasedStringParam } from "./tools/common.js";

export type ProcessToolDefaults = {
  cleanupMs?: number;
  scopeKey?: string;
};

const processSchema = Type.Object({
  action: Type.String({ description: "Process action" }),
  sessionId: Type.Optional(Type.String({ description: "Session id for actions other than list" })),
  shell_id: Type.Optional(
    Type.String({
      description: "Deprecated alias for sessionId. Kept for transcript replay compatibility.",
    }),
  ),
  data: Type.Optional(Type.String({ description: "Data to write for write" })),
  keys: Type.Optional(
    Type.Array(Type.String(), { description: "Key tokens to send for send-keys" }),
  ),
  hex: Type.Optional(Type.Array(Type.String(), { description: "Hex bytes to send for send-keys" })),
  literal: Type.Optional(Type.String({ description: "Literal string for send-keys" })),
  text: Type.Optional(Type.String({ description: "Text to paste for paste" })),
  bracketed: Type.Optional(Type.Boolean({ description: "Wrap paste in bracketed mode" })),
  eof: Type.Optional(Type.Boolean({ description: "Close stdin after write" })),
  offset: Type.Optional(Type.Number({ description: "Log offset" })),
  limit: Type.Optional(Type.Number({ description: "Log length" })),
});

type ProcessAction =
  | "list"
  | "poll"
  | "log"
  | "write"
  | "send-keys"
  | "submit"
  | "paste"
  | "kill"
  | "clear"
  | "remove";

const PROCESS_ACTION_ALIASES = {
  stop: "kill",
  cancel: "kill",
} as const satisfies Record<string, ProcessAction>;

const PROCESS_ALLOWED_KEYS: Record<ProcessAction, readonly string[]> = {
  list: ["action"],
  poll: ["action", "sessionId", "shell_id"],
  log: ["action", "sessionId", "shell_id", "offset", "limit"],
  write: ["action", "sessionId", "shell_id", "data", "eof"],
  "send-keys": ["action", "sessionId", "shell_id", "keys", "hex", "literal"],
  submit: ["action", "sessionId", "shell_id"],
  paste: ["action", "sessionId", "shell_id", "text", "bracketed"],
  kill: ["action", "sessionId", "shell_id"],
  clear: ["action", "sessionId", "shell_id"],
  remove: ["action", "sessionId", "shell_id"],
};

function normalizeProcessAction(value: unknown): {
  action?: ProcessAction;
  requestedAction?: string;
  usedAlias: boolean;
} {
  if (typeof value !== "string") {
    return { action: undefined, requestedAction: undefined, usedAlias: false };
  }
  const requestedAction = value.trim();
  if (!requestedAction) {
    return { action: undefined, requestedAction: undefined, usedAlias: false };
  }
  const lowered = requestedAction.toLowerCase();
  const aliased = PROCESS_ACTION_ALIASES[lowered as keyof typeof PROCESS_ACTION_ALIASES];
  if (aliased) {
    return {
      action: aliased,
      requestedAction,
      usedAlias: true,
    };
  }
  if (lowered in PROCESS_ALLOWED_KEYS) {
    return {
      action: lowered as ProcessAction,
      requestedAction,
      usedAlias: false,
    };
  }
  return {
    action: undefined,
    requestedAction,
    usedAlias: false,
  };
}

function buildProcessTextResult(
  message: string,
  details: Record<string, unknown>,
): AgentToolResult<unknown> {
  return {
    content: [{ type: "text" as const, text: message }],
    details,
  };
}

function buildProcessValidationFailure(params: {
  status?: "failed" | "completed";
  action?: ProcessAction;
  requestedAction?: string;
  sessionId?: string;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}) {
  return buildProcessTextResult(params.message, {
    status: params.status ?? "failed",
    action: params.action,
    requestedAction: params.requestedAction,
    sessionId: params.sessionId,
    errorCode: params.code,
    error: params.message,
    message: params.message,
    ...params.extra,
  });
}

function resolveManagedSessionId(params: Record<string, unknown>) {
  return readAliasedStringParam(params, {
    primaryKey: "sessionId",
    aliasKeys: ["shell_id"],
    required: true,
    label: "sessionId",
  });
}

export function createProcessTool(
  defaults?: ProcessToolDefaults,
  // oxlint-disable-next-line typescript/no-explicit-any
): AgentTool<any> {
  if (defaults?.cleanupMs !== undefined) {
    setJobTtlMs(defaults.cleanupMs);
  }
  const scopeKey = defaults?.scopeKey;
  const isInScope = (session?: { scopeKey?: string } | null) =>
    !scopeKey || session?.scopeKey === scopeKey;

  return {
    name: "process",
    label: "process",
    description:
      "Manage running exec sessions: list, poll, log, write, send-keys, submit, paste, and stop/kill background sessions. Deprecated aliases: action=stop|cancel and shell_id.",
    parameters: processSchema,
    execute: async (_toolCallId, args) => {
      const params = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      const normalizedAction = normalizeProcessAction(params.action);
      const action = normalizedAction.action;

      if (!action) {
        return buildProcessValidationFailure({
          code: "invalid_action",
          requestedAction: normalizedAction.requestedAction,
          message: `Unsupported process action: ${normalizedAction.requestedAction ?? "(missing)"}`,
        });
      }

      try {
        assertKnownParams(params, PROCESS_ALLOWED_KEYS[action], { label: "process" });
      } catch (err) {
        return buildProcessValidationFailure({
          action,
          requestedAction: normalizedAction.requestedAction,
          code: "unknown_parameter",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (action === "list") {
        const running = listRunningSessions()
          .filter((s) => isInScope(s))
          .map((s) => ({
            sessionId: s.id,
            status: "running",
            pid: s.pid ?? undefined,
            startedAt: s.startedAt,
            runtimeMs: Date.now() - s.startedAt,
            cwd: s.cwd,
            command: s.command,
            name: deriveSessionName(s.command),
            tail: s.tail,
            truncated: s.truncated,
          }));
        const finished = listFinishedSessions()
          .filter((s) => isInScope(s))
          .map((s) => ({
            sessionId: s.id,
            status: s.status,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            runtimeMs: s.endedAt - s.startedAt,
            cwd: s.cwd,
            command: s.command,
            name: deriveSessionName(s.command),
            tail: s.tail,
            truncated: s.truncated,
            exitCode: s.exitCode ?? undefined,
            exitSignal: s.exitSignal ?? undefined,
          }));
        const lines = [...running, ...finished]
          .toSorted((a, b) => b.startedAt - a.startedAt)
          .map((s) => {
            const label = s.name ? truncateMiddle(s.name, 80) : truncateMiddle(s.command, 120);
            return `${s.sessionId} ${pad(s.status, 9)} ${formatDurationCompact(s.runtimeMs) ?? "n/a"} :: ${label}`;
          });
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n") || "No running or recent sessions.",
            },
          ],
          details: { status: "completed", sessions: [...running, ...finished] },
        };
      }

      let sessionId = "";
      try {
        sessionId = resolveManagedSessionId(params).value;
      } catch (err) {
        return buildProcessValidationFailure({
          action,
          requestedAction: normalizedAction.requestedAction,
          code: "missing_session_id",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      const session = getSession(sessionId);
      const finished = getFinishedSession(sessionId);
      const scopedSession = isInScope(session) ? session : undefined;
      const scopedFinished = isInScope(finished) ? finished : undefined;
      const offset = typeof params.offset === "number" ? params.offset : undefined;
      const limit = typeof params.limit === "number" ? params.limit : undefined;
      const stdinText = typeof params.data === "string" ? params.data : "";
      const pasteText = typeof params.text === "string" ? params.text : "";

      const backgroundedValidationFailure = () => {
        if (!scopedSession) {
          return buildProcessValidationFailure({
            action,
            requestedAction: normalizedAction.requestedAction,
            sessionId,
            code: "session_not_found",
            message: `No active session found for ${sessionId}`,
          });
        }
        if (!scopedSession.backgrounded) {
          return buildProcessValidationFailure({
            action,
            requestedAction: normalizedAction.requestedAction,
            sessionId,
            code: "session_not_backgrounded",
            message: `Session ${sessionId} is not backgrounded.`,
          });
        }
        return null;
      };

      switch (action) {
        case "poll": {
          if (!scopedSession) {
            if (scopedFinished) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      (scopedFinished.tail ||
                        `(no output recorded${
                          scopedFinished.truncated ? " — truncated to cap" : ""
                        })`) +
                      `\n\nProcess exited with ${
                        scopedFinished.exitSignal
                          ? `signal ${scopedFinished.exitSignal}`
                          : `code ${scopedFinished.exitCode ?? 0}`
                      }.`,
                  },
                ],
                details: {
                  status: scopedFinished.status === "completed" ? "completed" : "failed",
                  sessionId,
                  exitCode: scopedFinished.exitCode ?? undefined,
                  aggregated: scopedFinished.aggregated,
                  name: deriveSessionName(scopedFinished.command),
                },
              };
            }
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_found",
              message: `No session found for ${sessionId}`,
            });
          }
          if (!scopedSession.backgrounded) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_backgrounded",
              message: `Session ${sessionId} is not backgrounded.`,
            });
          }
          const { stdout, stderr } = drainSession(scopedSession);
          const exited = scopedSession.exited;
          const exitCode = scopedSession.exitCode ?? 0;
          const exitSignal = scopedSession.exitSignal ?? undefined;
          if (exited) {
            const status = exitCode === 0 && exitSignal == null ? "completed" : "failed";
            markExited(
              scopedSession,
              scopedSession.exitCode ?? null,
              scopedSession.exitSignal ?? null,
              status,
              {
                terminalReason:
                  exitCode === 0 && exitSignal == null
                    ? "completed"
                    : exitSignal != null
                      ? "cancelled"
                      : "error",
              },
            );
          }
          const status = exited
            ? exitCode === 0 && exitSignal == null
              ? "completed"
              : "failed"
            : "running";
          const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n").trim();
          return {
            content: [
              {
                type: "text",
                text:
                  (output || "(no new output)") +
                  (exited
                    ? `\n\nProcess exited with ${
                        exitSignal ? `signal ${exitSignal}` : `code ${exitCode}`
                      }.`
                    : "\n\nProcess still running."),
              },
            ],
            details: {
              status,
              sessionId,
              exitCode: exited ? exitCode : undefined,
              aggregated: scopedSession.aggregated,
              name: deriveSessionName(scopedSession.command),
            },
          };
        }

        case "log": {
          if (scopedSession) {
            if (!scopedSession.backgrounded) {
              return buildProcessValidationFailure({
                action,
                requestedAction: normalizedAction.requestedAction,
                sessionId,
                code: "session_not_backgrounded",
                message: `Session ${sessionId} is not backgrounded.`,
              });
            }
            const { slice, totalLines, totalChars } = sliceLogLines(
              scopedSession.aggregated,
              offset,
              limit,
            );
            return {
              content: [{ type: "text", text: slice || "(no output yet)" }],
              details: {
                status: scopedSession.exited ? "completed" : "running",
                sessionId,
                total: totalLines,
                totalLines,
                totalChars,
                truncated: scopedSession.truncated,
                name: deriveSessionName(scopedSession.command),
              },
            };
          }
          if (scopedFinished) {
            const { slice, totalLines, totalChars } = sliceLogLines(
              scopedFinished.aggregated,
              offset,
              limit,
            );
            const status = scopedFinished.status === "completed" ? "completed" : "failed";
            return {
              content: [{ type: "text", text: slice || "(no output recorded)" }],
              details: {
                status,
                sessionId,
                total: totalLines,
                totalLines,
                totalChars,
                truncated: scopedFinished.truncated,
                exitCode: scopedFinished.exitCode ?? undefined,
                exitSignal: scopedFinished.exitSignal ?? undefined,
                name: deriveSessionName(scopedFinished.command),
              },
            };
          }
          return buildProcessValidationFailure({
            action,
            requestedAction: normalizedAction.requestedAction,
            sessionId,
            code: "session_not_found",
            message: `No session found for ${sessionId}`,
          });
        }

        case "write": {
          const validationFailure = backgroundedValidationFailure();
          if (validationFailure) {
            return validationFailure;
          }
          const activeSession = scopedSession;
          if (!activeSession) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_found",
              message: `No active session found for ${sessionId}`,
            });
          }
          const stdin = activeSession.stdin ?? activeSession.child?.stdin;
          if (!stdin || stdin.destroyed) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "stdin_not_writable",
              message: `Session ${sessionId} stdin is not writable.`,
            });
          }
          await new Promise<void>((resolve, reject) => {
            stdin.write(stdinText, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
          if (params.eof === true) {
            stdin.end();
          }
          return {
            content: [
              {
                type: "text",
                text: `Wrote ${stdinText.length} bytes to session ${sessionId}${
                  params.eof === true ? " (stdin closed)" : ""
                }.`,
              },
            ],
            details: {
              status: "running",
              sessionId,
              name: deriveSessionName(activeSession.command),
            },
          };
        }

        case "send-keys": {
          const validationFailure = backgroundedValidationFailure();
          if (validationFailure) {
            return validationFailure;
          }
          const activeSession = scopedSession;
          if (!activeSession) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_found",
              message: `No active session found for ${sessionId}`,
            });
          }
          const stdin = activeSession.stdin ?? activeSession.child?.stdin;
          if (!stdin || stdin.destroyed) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "stdin_not_writable",
              message: `Session ${sessionId} stdin is not writable.`,
            });
          }
          const { data, warnings } = encodeKeySequence({
            keys: Array.isArray(params.keys)
              ? params.keys.filter((entry): entry is string => typeof entry === "string")
              : undefined,
            hex: Array.isArray(params.hex)
              ? params.hex.filter((entry): entry is string => typeof entry === "string")
              : undefined,
            literal: typeof params.literal === "string" ? params.literal : undefined,
          });
          if (!data) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "missing_key_data",
              message: "No key data provided.",
            });
          }
          await new Promise<void>((resolve, reject) => {
            stdin.write(data, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
          return {
            content: [
              {
                type: "text",
                text:
                  `Sent ${data.length} bytes to session ${sessionId}.` +
                  (warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : ""),
              },
            ],
            details: {
              status: "running",
              sessionId,
              name: deriveSessionName(activeSession.command),
            },
          };
        }

        case "submit": {
          const validationFailure = backgroundedValidationFailure();
          if (validationFailure) {
            return validationFailure;
          }
          const activeSession = scopedSession;
          if (!activeSession) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_found",
              message: `No active session found for ${sessionId}`,
            });
          }
          const stdin = activeSession.stdin ?? activeSession.child?.stdin;
          if (!stdin || stdin.destroyed) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "stdin_not_writable",
              message: `Session ${sessionId} stdin is not writable.`,
            });
          }
          await new Promise<void>((resolve, reject) => {
            stdin.write("\r", (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
          return {
            content: [
              {
                type: "text",
                text: `Submitted session ${sessionId} (sent CR).`,
              },
            ],
            details: {
              status: "running",
              sessionId,
              name: deriveSessionName(activeSession.command),
            },
          };
        }

        case "paste": {
          const validationFailure = backgroundedValidationFailure();
          if (validationFailure) {
            return validationFailure;
          }
          const activeSession = scopedSession;
          if (!activeSession) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_found",
              message: `No active session found for ${sessionId}`,
            });
          }
          const stdin = activeSession.stdin ?? activeSession.child?.stdin;
          if (!stdin || stdin.destroyed) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "stdin_not_writable",
              message: `Session ${sessionId} stdin is not writable.`,
            });
          }
          const payload = encodePaste(pasteText, params.bracketed !== false);
          if (!payload) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "missing_paste_text",
              message: "No paste text provided.",
            });
          }
          await new Promise<void>((resolve, reject) => {
            stdin.write(payload, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
          return {
            content: [
              {
                type: "text",
                text: `Pasted ${pasteText.length} chars to session ${sessionId}.`,
              },
            ],
            details: {
              status: "running",
              sessionId,
              name: deriveSessionName(activeSession.command),
            },
          };
        }

        case "kill": {
          if (!scopedSession) {
            if (scopedFinished) {
              const message = `Session ${sessionId} is already stopped.`;
              return buildProcessTextResult(message, {
                status: "completed",
                action,
                requestedAction: normalizedAction.requestedAction,
                sessionId,
                result: "noop",
                errorCode: "already_stopped",
                previousStatus: scopedFinished.status,
                command: scopedFinished.command,
                name: deriveSessionName(scopedFinished.command),
                message,
              });
            }
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_found",
              message: `No active session found for ${sessionId}`,
            });
          }
          if (!scopedSession.backgrounded) {
            return buildProcessValidationFailure({
              action,
              requestedAction: normalizedAction.requestedAction,
              sessionId,
              code: "session_not_backgrounded",
              message: `Session ${sessionId} is not backgrounded.`,
            });
          }
          const command = scopedSession.command;
          const name = deriveSessionName(command);
          killSession(scopedSession);
          markExited(scopedSession, null, "SIGKILL", "failed", {
            terminalReason: "cancelled",
            error: "Process killed by user request.",
          });
          const message = `Stopped session ${sessionId}.`;
          return buildProcessTextResult(message, {
            status: "completed",
            action,
            requestedAction: normalizedAction.requestedAction,
            sessionId,
            result: "killed",
            previousStatus: "running",
            command,
            name,
            message,
          });
        }

        case "clear": {
          if (scopedFinished) {
            deleteSession(sessionId);
            return {
              content: [{ type: "text", text: `Cleared session ${sessionId}.` }],
              details: { status: "completed", sessionId },
            };
          }
          return buildProcessValidationFailure({
            action,
            requestedAction: normalizedAction.requestedAction,
            sessionId,
            code: "finished_session_not_found",
            message: `No finished session found for ${sessionId}`,
          });
        }

        case "remove": {
          if (scopedSession) {
            killSession(scopedSession);
            markExited(scopedSession, null, "SIGKILL", "failed", {
              terminalReason: "cancelled",
              error: "Process removed by user request.",
            });
            return {
              content: [{ type: "text", text: `Removed session ${sessionId}.` }],
              details: {
                status: "failed",
                sessionId,
                name: scopedSession ? deriveSessionName(scopedSession.command) : undefined,
              },
            };
          }
          if (scopedFinished) {
            deleteSession(sessionId);
            return {
              content: [{ type: "text", text: `Removed session ${sessionId}.` }],
              details: { status: "completed", sessionId },
            };
          }
          return buildProcessValidationFailure({
            action,
            requestedAction: normalizedAction.requestedAction,
            sessionId,
            code: "session_not_found",
            message: `No session found for ${sessionId}`,
          });
        }
      }

      return buildProcessValidationFailure({
        code: "invalid_action",
        requestedAction: normalizedAction.requestedAction,
        message: `Unsupported process action: ${normalizedAction.requestedAction ?? "(missing)"}`,
      });
    },
  };
}

export const processTool = createProcessTool();
