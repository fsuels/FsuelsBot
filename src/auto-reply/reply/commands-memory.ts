import { parseDurationMs } from "../../cli/parse-duration.js";
import type { SessionEntry } from "../../config/sessions.js";
import { updateSessionStore } from "../../config/sessions.js";
import { forgetMemoryWorkspace } from "../../memory/forget.js";
import {
  listMemoryPins,
  removeMemoryPin,
  type MemoryPinType,
  upsertMemoryPin,
} from "../../memory/pins.js";
import {
  applySessionTaskUpdate,
  DEFAULT_SESSION_TASK_ID,
  resolveSessionTaskView,
} from "../../sessions/task-context.js";
import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

type ParsedArgs = {
  values: string[];
  flags: Record<string, string | true>;
};

function tokenize(input: string): string[] {
  const out: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = regex.exec(input);
  while (match) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
    match = regex.exec(input);
  }
  return out;
}

function parseArgs(raw: string): ParsedArgs {
  const tokens = tokenize(raw);
  const values: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      values.push(token);
      continue;
    }
    const key = token.slice(2).trim().toLowerCase();
    if (!key) continue;
    const next = tokens[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { values, flags };
}

function formatPin(pin: {
  id: string;
  type: string;
  text: string;
  scope: string;
  taskId?: string;
  expiresAt?: number;
}) {
  const scope = pin.scope === "task" && pin.taskId ? `task:${pin.taskId}` : "global";
  const expires =
    typeof pin.expiresAt === "number" ? ` expires=${new Date(pin.expiresAt).toISOString()}` : "";
  return `- ${pin.id} [${pin.type}] (${scope}) ${pin.text}${expires}`;
}

async function persistSessionEntry(params: {
  entry: SessionEntry;
  sessionKey?: string;
  storePath?: string;
  sessionStore?: Record<string, SessionEntry>;
}): Promise<void> {
  if (!params.sessionKey) return;
  if (params.sessionStore) {
    params.sessionStore[params.sessionKey] = params.entry;
  }
  if (params.storePath) {
    await updateSessionStore(params.storePath, (store) => {
      store[params.sessionKey!] = params.entry;
    });
  }
}

export const handlePinCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/pin" && !normalized.startsWith("/pin ")) return null;
  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /pin from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }
  const raw = normalized === "/pin" ? "" : normalized.slice("/pin".length).trim();
  const parsed = parseArgs(raw);
  const action = parsed.values[0]?.toLowerCase();

  if (!action) {
    return {
      shouldContinue: false,
      reply: {
        text:
          "Usage:\n" +
          "/pin <fact|preference|constraint|temporary> <text> [--task <id>] [--ttl <duration>]\n" +
          "/pin list [--task <id>]\n" +
          "/pin remove <pinId>",
      },
    };
  }

  if (action === "list") {
    const taskIdRaw = typeof parsed.flags.task === "string" ? parsed.flags.task : undefined;
    const taskId = taskIdRaw?.trim();
    const pins = await listMemoryPins({
      workspaceDir: params.workspaceDir,
      scope: taskId ? "task" : "all",
      taskId,
    });
    if (pins.length === 0) {
      return { shouldContinue: false, reply: { text: "No active memory pins." } };
    }
    return {
      shouldContinue: false,
      reply: {
        text: `Memory pins (${pins.length})\n${pins.slice(0, 25).map((pin) => formatPin(pin)).join("\n")}`,
      },
    };
  }

  if (action === "remove" || action === "unpin") {
    const pinId = parsed.values[1]?.trim();
    if (!pinId) {
      return { shouldContinue: false, reply: { text: "Usage: /pin remove <pinId>" } };
    }
    const removed = await removeMemoryPin({ workspaceDir: params.workspaceDir, id: pinId });
    return {
      shouldContinue: false,
      reply: { text: removed ? `Removed pin ${pinId}.` : `Pin not found: ${pinId}.` },
    };
  }

  const allowedTypes: MemoryPinType[] = ["fact", "preference", "constraint", "temporary"];
  if (!allowedTypes.includes(action as MemoryPinType)) {
    return {
      shouldContinue: false,
      reply: { text: "Unknown pin type. Use fact|preference|constraint|temporary." },
    };
  }
  const type = action as MemoryPinType;
  const text = parsed.values.slice(1).join(" ").trim();
  if (!text) {
    return {
      shouldContinue: false,
      reply: { text: "Pin text required. Example: /pin fact API base URL is https://example" },
    };
  }
  const taskFlag = typeof parsed.flags.task === "string" ? parsed.flags.task : undefined;
  const activeTask = resolveSessionTaskView({ entry: params.sessionEntry });
  const taskId = taskFlag?.trim() || (type === "temporary" ? activeTask.taskId : undefined);
  const scope = taskId && taskId !== DEFAULT_SESSION_TASK_ID ? "task" : "global";
  const entity = typeof parsed.flags.entity === "string" ? parsed.flags.entity : undefined;
  const ttlRaw = typeof parsed.flags.ttl === "string" ? parsed.flags.ttl : undefined;
  let ttlMs: number | undefined;
  if (ttlRaw) {
    try {
      ttlMs = parseDurationMs(ttlRaw, { defaultUnit: "d" });
    } catch {
      return { shouldContinue: false, reply: { text: `Invalid --ttl value: ${ttlRaw}` } };
    }
  }
  const pin = await upsertMemoryPin({
    workspaceDir: params.workspaceDir,
    type,
    text,
    scope,
    taskId,
    entity,
    ttlMs,
  });
  return {
    shouldContinue: false,
    reply: {
      text: `Pinned ${pin.id} as ${pin.type} (${scope}${pin.taskId ? `:${pin.taskId}` : ""}).`,
    },
  };
};

export const handleForgetCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/forget" && !normalized.startsWith("/forget ")) return null;
  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /forget from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }
  const raw = normalized === "/forget" ? "" : normalized.slice("/forget".length).trim();
  const parsed = parseArgs(raw);
  const text = parsed.values.join(" ").trim() || undefined;
  const taskId = typeof parsed.flags.task === "string" ? parsed.flags.task.trim() : undefined;
  const entity = typeof parsed.flags.entity === "string" ? parsed.flags.entity.trim() : undefined;
  const beforeRaw = typeof parsed.flags.before === "string" ? parsed.flags.before.trim() : undefined;
  let before: number | undefined;
  if (beforeRaw) {
    const parsedDate = Date.parse(beforeRaw);
    if (!Number.isFinite(parsedDate)) {
      return { shouldContinue: false, reply: { text: `Invalid --before date: ${beforeRaw}` } };
    }
    before = parsedDate;
  }
  if (!text && !taskId && !entity && before == null) {
    return {
      shouldContinue: false,
      reply: {
        text:
          "Usage:\n" +
          "/forget <text>\n" +
          "/forget --task <id>\n" +
          "/forget --entity <name>\n" +
          "/forget --before <date>\n" +
          "(can combine filters)",
      },
    };
  }
  const result = await forgetMemoryWorkspace({
    workspaceDir: params.workspaceDir,
    text,
    taskId,
    entity,
    before,
  });

  if (taskId && params.sessionEntry) {
    const activeTask = resolveSessionTaskView({ entry: params.sessionEntry });
    if (activeTask.taskId === taskId) {
      let next = applySessionTaskUpdate(params.sessionEntry, {
        taskId,
        status: "archived",
        updatedAt: Date.now(),
        source: "forget",
      });
      next = applySessionTaskUpdate(next, {
        taskId: DEFAULT_SESSION_TASK_ID,
        status: "active",
        updatedAt: Date.now(),
        source: "forget",
      });
      await persistSessionEntry({
        entry: next,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
      });
    }
  }

  return {
    shouldContinue: false,
    reply: {
      text:
        `Forgot memory entries.` +
        ` files=${result.removedFiles} lines=${result.removedLines} pins=${result.removedPins}.`,
    },
  };
};

export const handleTaskCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/task" && !normalized.startsWith("/task ")) return null;
  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /task from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }
  const raw = normalized === "/task" ? "" : normalized.slice("/task".length).trim();
  const parsed = parseArgs(raw);
  const action = parsed.values[0]?.toLowerCase() ?? "show";
  const entry = params.sessionEntry;

  if (!entry) {
    return { shouldContinue: false, reply: { text: "No session task state available yet." } };
  }

  const active = resolveSessionTaskView({ entry });
  if (action === "show" || action === "status") {
    const line = `Task ${active.taskId} (${active.status ?? "active"})`;
    const title = active.title ? `\nTitle: ${active.title}` : "";
    return { shouldContinue: false, reply: { text: `${line}${title}` } };
  }

  if (action === "list") {
    const tasks = Object.entries(entry.taskStateById ?? {}).sort(
      (a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0),
    );
    if (!tasks.length) {
      return { shouldContinue: false, reply: { text: "No known tasks." } };
    }
    const lines = tasks
      .slice(0, 25)
      .map(([taskId, state]) => `- ${taskId} (${state.status ?? "active"})`);
    return { shouldContinue: false, reply: { text: `Known tasks:\n${lines.join("\n")}` } };
  }

  if (action === "set") {
    const taskId = parsed.values[1]?.trim();
    if (!taskId) {
      return { shouldContinue: false, reply: { text: "Usage: /task set <id> [title]" } };
    }
    const title = parsed.values.slice(2).join(" ").trim() || undefined;
    const next = applySessionTaskUpdate(entry, {
      taskId,
      title,
      status: "active",
      updatedAt: Date.now(),
      source: "task.set",
    });
    await persistSessionEntry({
      entry: next,
      sessionStore: params.sessionStore,
      sessionKey: params.sessionKey,
      storePath: params.storePath,
    });
    return { shouldContinue: false, reply: { text: `Active task set to ${taskId}.` } };
  }

  const statusAction = action === "done" ? "completed" : action;
  if (
    statusAction !== "active" &&
    statusAction !== "paused" &&
    statusAction !== "completed" &&
    statusAction !== "archived"
  ) {
    return {
      shouldContinue: false,
      reply: {
        text:
          "Usage:\n" +
          "/task show|list\n" +
          "/task set <id> [title]\n" +
          "/task <active|paused|completed|archived|done>",
      },
    };
  }

  let next = applySessionTaskUpdate(entry, {
    taskId: active.taskId,
    status: statusAction,
    updatedAt: Date.now(),
    source: "task.status",
  });
  if (
    (statusAction === "completed" || statusAction === "archived") &&
    active.taskId !== DEFAULT_SESSION_TASK_ID
  ) {
    next = applySessionTaskUpdate(next, {
      taskId: DEFAULT_SESSION_TASK_ID,
      status: "active",
      updatedAt: Date.now(),
      source: "task.status",
    });
  }
  await persistSessionEntry({
    entry: next,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  return { shouldContinue: false, reply: { text: `Task ${active.taskId} marked ${statusAction}.` } };
};


