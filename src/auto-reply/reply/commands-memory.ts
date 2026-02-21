import crypto from "node:crypto";
import type { SessionEntry } from "../../config/sessions.js";
import type { CommandHandler } from "./commands-types.js";
import {
  checkpointActiveTask,
  patchTaskCard,
  updateBotCurrentTask,
} from "../../agents/task-checkpoint.js";
import { parseDurationMs } from "../../cli/parse-duration.js";
import { updateSessionStore } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { forgetMemoryWorkspace } from "../../memory/forget.js";
import {
  cancelMemoryPinRemoveIntent,
  createMemoryPinRemoveIntent,
  editMemoryPin,
  executePinRemoval,
  listMemoryPins,
  removeMemoryPin,
  type MemoryPinType,
  upsertMemoryPin,
  validatePinRemoveIntent,
} from "../../memory/pins.js";
import {
  commitMemoryEvents,
  getTaskRegistryTask,
  linkTaskRegistryTasks,
  listTaskRegistry,
  setTaskRegistryStatus,
  type TaskRegistryStatus,
  upsertTaskRegistryTask,
} from "../../memory/task-memory-system.js";
import {
  applySessionTaskUpdate,
  DEFAULT_SESSION_TASK_ID,
  resolveSessionTaskView,
} from "../../sessions/task-context.js";

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
    if (!key) {
      continue;
    }
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

function normalizePinTextForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTaskStatus(
  action: string,
): "active" | "paused" | "completed" | "archived" | null {
  const normalized = action.trim().toLowerCase();
  if (normalized === "active") {
    return "active";
  }
  if (normalized === "paused" || normalized === "suspended") {
    return "paused";
  }
  if (normalized === "completed" || normalized === "done" || normalized === "closed") {
    return "completed";
  }
  if (normalized === "archived" || normalized === "archive") {
    return "archived";
  }
  return null;
}

function mapSessionStatusToRegistryStatus(
  status: "active" | "paused" | "completed" | "archived",
): TaskRegistryStatus {
  if (status === "active") {
    return "active";
  }
  if (status === "paused") {
    return "suspended";
  }
  if (status === "completed") {
    return "closed";
  }
  return "archived";
}

function slugifyTaskTitle(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `task-${Date.now()}`;
}

/**
 * Returns true when the first token of a `/task` command looks like a task-id
 * shorthand rather than a sub-command.
 * Matches: `#3`, `#my-task`, bare task-ids that start with a digit or contain
 * a hyphen (slug-style) — but NOT known sub-commands.
 */
const KNOWN_TASK_SUBCOMMANDS = new Set([
  "show",
  "status",
  "list",
  "new",
  "set",
  "switch",
  "link",
  "active",
  "paused",
  "suspended",
  "completed",
  "done",
  "closed",
  "archived",
  "archive",
]);

function isTaskIdShorthand(action: string): string | null {
  if (!action) {
    return null;
  }
  // Strip leading # if present (e.g. "#3" → "3", "#my-task" → "my-task")
  const stripped = action.startsWith("#") ? action.slice(1).trim() : action;
  if (!stripped) {
    return null;
  }
  if (KNOWN_TASK_SUBCOMMANDS.has(stripped.toLowerCase())) {
    return null;
  }
  return stripped;
}

/**
 * Checkpoint current task, switch bot_current in tasks.json, reset session.
 * Returns the confirmation reply text.
 */
async function switchTaskWithSessionReset(params: {
  workspaceDir: string;
  entry: SessionEntry;
  taskId: string;
  title?: string;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  source: string;
}): Promise<{ reply: string; error?: unknown }> {
  const previousTaskId = params.entry.activeTaskId;

  // 1. Checkpoint current task progress (best-effort)
  try {
    await checkpointActiveTask({
      workspaceDir: params.workspaceDir,
      taskId: previousTaskId,
    });
  } catch {
    /* checkpoint is best-effort — don't block the switch */
  }

  // 2. Update tasks.json bot_current lane
  try {
    await updateBotCurrentTask({
      workspaceDir: params.workspaceDir,
      taskId: params.taskId,
      title: params.title,
      previousTaskId,
    });
  } catch {
    /* bot_current update is best-effort */
  }

  // 3. Run the normal task switch (session entry + registry)
  const nextEntry = await runTaskSwitch({
    workspaceDir: params.workspaceDir,
    entry: params.entry,
    taskId: params.taskId,
    title: params.title,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
    source: params.source,
  });

  // 4. Force session reset: generate new sessionId and clear sessionFile
  //    so the next message creates a fresh session file with the new task's bootstrap.
  nextEntry.sessionId = crypto.randomUUID();
  delete nextEntry.sessionFile;
  nextEntry.systemSent = false;
  nextEntry.compactionCount = 0;

  // Persist the reset session entry
  if (params.sessionKey) {
    if (params.sessionStore) {
      params.sessionStore[params.sessionKey] = nextEntry;
    }
    if (params.storePath) {
      await updateSessionStore(params.storePath, (store) => {
        store[params.sessionKey!] = nextEntry;
      });
    }
  }

  const taskLabel = params.title ?? params.taskId;
  const prevLabel =
    previousTaskId && previousTaskId !== DEFAULT_SESSION_TASK_ID
      ? ` (paused ${previousTaskId})`
      : "";
  return {
    reply: `⚡ Switched to task **${taskLabel}**${prevLabel}. Session reset — next message starts fresh with task context loaded.`,
  };
}

function ensureSessionEntry(params: {
  entry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
}): SessionEntry {
  const fromStore = params.sessionKey ? params.sessionStore?.[params.sessionKey] : undefined;
  if (params.entry) {
    return params.entry;
  }
  if (fromStore) {
    return fromStore;
  }
  const now = Date.now();
  return {
    sessionId: crypto.randomUUID(),
    updatedAt: now,
    activeTaskId: DEFAULT_SESSION_TASK_ID,
    taskStateById: {
      [DEFAULT_SESSION_TASK_ID]: {
        updatedAt: now,
        status: "active",
        title: "General",
      },
    },
  };
}

async function persistSessionEntry(params: {
  entry: SessionEntry;
  sessionKey?: string;
  storePath?: string;
  sessionStore?: Record<string, SessionEntry>;
}): Promise<void> {
  if (!params.sessionKey) {
    return;
  }
  if (params.sessionStore) {
    params.sessionStore[params.sessionKey] = params.entry;
  }
  if (params.storePath) {
    await updateSessionStore(params.storePath, (store) => {
      store[params.sessionKey!] = params.entry;
    });
  }
}

async function commitRequired(params: Parameters<typeof commitMemoryEvents>[0]): Promise<void> {
  try {
    await commitMemoryEvents(params);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`durable memory commit failed: ${detail}`, { cause: err });
  }
}

function durabilityFailureReply(
  action: string,
  error: unknown,
): { shouldContinue: false; reply: { text: string } } {
  const detail = error instanceof Error ? error.message : String(error);
  logVerbose(`${action} blocked by durability failure: ${detail}`);
  return {
    shouldContinue: false,
    reply: {
      text: `${action} failed because memory commit did not persist. ${detail}`,
    },
  };
}

async function runTaskSwitch(params: {
  workspaceDir: string;
  entry: SessionEntry;
  taskId: string;
  title?: string;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  source: string;
  now?: number;
}): Promise<SessionEntry> {
  const now = params.now ?? Date.now();
  const activeBefore = resolveSessionTaskView({ entry: params.entry });
  const taskId = params.taskId.trim();
  const existingTask = await getTaskRegistryTask({
    workspaceDir: params.workspaceDir,
    taskId,
  });
  const resolvedTitle = params.title ?? existingTask?.title ?? taskId;
  const events: Parameters<typeof commitMemoryEvents>[0]["events"] = [];
  if (!existingTask) {
    events.push({ type: "TASK_CREATED", payload: { taskId, title: resolvedTitle } });
  }
  if (params.title) {
    events.push({ type: "TITLE_SET", payload: { title: params.title } });
  }
  events.push({
    type: "STATE_PATCH_APPLIED",
    payload: { patch: { status: "active", title: resolvedTitle } },
  });
  await commitRequired({
    workspaceDir: params.workspaceDir,
    writeScope: "task",
    taskId,
    actor: "user",
    events,
    now,
  });

  const taskRecord = await upsertTaskRegistryTask({
    workspaceDir: params.workspaceDir,
    taskId,
    title: params.title,
    status: "active",
    now,
  });
  if (
    activeBefore.taskId &&
    activeBefore.taskId !== DEFAULT_SESSION_TASK_ID &&
    activeBefore.taskId !== taskId
  ) {
    await setTaskRegistryStatus({
      workspaceDir: params.workspaceDir,
      taskId: activeBefore.taskId,
      status: "suspended",
      now,
    });
  }

  const nextEntry = applySessionTaskUpdate(params.entry, {
    taskId,
    title: params.title ?? taskRecord.title,
    status: "active",
    updatedAt: now,
    source: params.source,
  });
  await persistSessionEntry({
    entry: nextEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  return nextEntry;
}

function rewriteTaskCommand(normalized: string): string | null {
  if (normalized === "/tasks") {
    return "/task list";
  }
  if (normalized === "/resume") {
    return "/task set";
  }
  if (normalized.startsWith("/resume ")) {
    return `/task set ${normalized.slice("/resume".length).trim()}`;
  }
  if (normalized.startsWith("/switch ")) {
    return `/task set ${normalized.slice("/switch".length).trim()}`;
  }
  if (normalized.startsWith("/newtask ")) {
    return `/task new ${normalized.slice("/newtask".length).trim()}`;
  }
  if (normalized.startsWith("/archive ")) {
    return `/task archive ${normalized.slice("/archive".length).trim()}`;
  }
  if (normalized === "/archive") {
    return "/task archive";
  }
  if (normalized.startsWith("/close ")) {
    return `/task close ${normalized.slice("/close".length).trim()}`;
  }
  if (normalized === "/close") {
    return "/task close";
  }
  if (normalized.startsWith("/link ")) {
    return `/task link ${normalized.slice("/link".length).trim()}`;
  }
  if (normalized === "/task" || normalized.startsWith("/task ")) {
    return normalized;
  }
  return null;
}

export const handlePinCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.rawBodyNormalized || params.command.commandBodyNormalized;
  const isPinCommand = normalized === "/pin" || normalized.startsWith("/pin ");
  const isPinsAlias = normalized === "/pins" || normalized.startsWith("/pins ");
  const isUnpinAlias = normalized === "/unpin" || normalized.startsWith("/unpin ");
  if (!isPinCommand && !isPinsAlias && !isUnpinAlias) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /pin from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }
  const canonical = (() => {
    if (isPinsAlias) {
      return normalized.replace(/^\/pins\b/, "/pin list");
    }
    if (isUnpinAlias) {
      return normalized.replace(/^\/unpin\b/, "/pin remove");
    }
    return normalized;
  })();

  const raw = canonical === "/pin" ? "" : canonical.slice("/pin".length).trim();
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
          "/pin edit <pinId> <new text>\n" +
          "/pin remove <pinId>\n" +
          "/pin confirm <token>\n" +
          "/pin cancel <token>",
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
        text: `Memory pins (${pins.length})\n${pins
          .slice(0, 25)
          .map((pin) => formatPin(pin))
          .join("\n")}`,
      },
    };
  }

  if (action === "confirm") {
    const token = parsed.values[1]?.trim();
    if (!token) {
      return { shouldContinue: false, reply: { text: "Usage: /pin confirm <token>" } };
    }
    // WAL-first: validate intent without mutating the pin store.
    const validation = await validatePinRemoveIntent({
      workspaceDir: params.workspaceDir,
      token,
    });
    if (!validation.pinId) {
      return {
        shouldContinue: false,
        reply: { text: "Pin removal token not found. It may be expired or already used." },
      };
    }
    if (!validation.valid) {
      return {
        shouldContinue: false,
        reply: {
          text: validation.expired
            ? `Removal token expired for pin ${validation.pinId}.`
            : `Pin ${validation.pinId} was already removed.`,
        },
      };
    }
    // Commit durable event BEFORE mutating the pin store.
    try {
      await commitRequired({
        workspaceDir: params.workspaceDir,
        writeScope: validation.scope ?? "global",
        taskId: validation.taskId,
        actor: "user",
        events: [
          { type: "PIN_REMOVE_REQUESTED", payload: { pinId: validation.pinId } },
          { type: "PIN_REMOVED", payload: { pinId: validation.pinId } },
        ],
      });
    } catch (error) {
      // WAL failed — pin store is untouched, intent survives, user can retry.
      return durabilityFailureReply("Pin removal", error);
    }
    // WAL succeeded — now perform the actual pin store mutation.
    try {
      await executePinRemoval({
        workspaceDir: params.workspaceDir,
        token,
      });
    } catch (execError) {
      // WAL is authoritative; pin store will catch up on next replay.
      const detail = execError instanceof Error ? execError.message : String(execError);
      logVerbose(`Pin store mutation after WAL commit failed for ${validation.pinId}: ${detail}`);
    }
    return {
      shouldContinue: false,
      reply: { text: `Removed pin ${validation.pinId}.` },
    };
  }

  if (action === "cancel") {
    const token = parsed.values[1]?.trim();
    if (!token) {
      return { shouldContinue: false, reply: { text: "Usage: /pin cancel <token>" } };
    }
    const canceled = await cancelMemoryPinRemoveIntent({
      workspaceDir: params.workspaceDir,
      token,
    });
    return {
      shouldContinue: false,
      reply: { text: canceled ? "Pin removal canceled." : "Token not found or already resolved." },
    };
  }

  if (action === "remove" || action === "unpin") {
    const pinId = parsed.values[1]?.trim();
    if (!pinId) {
      return { shouldContinue: false, reply: { text: "Usage: /pin remove <pinId>" } };
    }
    const intent = await createMemoryPinRemoveIntent({
      workspaceDir: params.workspaceDir,
      id: pinId,
    });
    if (!intent) {
      return {
        shouldContinue: false,
        reply: { text: `Pin not found: ${pinId}.` },
      };
    }
    return {
      shouldContinue: false,
      reply: {
        text:
          `Pin removal requires confirmation.\n` +
          `Run: /pin confirm ${intent.token}\n` +
          `Expires: ${new Date(intent.expiresAt).toISOString()}\n` +
          `Cancel: /pin cancel ${intent.token}`,
      },
    };
  }

  if (action === "edit") {
    const pinId = parsed.values[1]?.trim();
    const text = parsed.values.slice(2).join(" ").trim();
    if (!pinId || !text) {
      return { shouldContinue: false, reply: { text: "Usage: /pin edit <pinId> <new text>" } };
    }
    const ttlRaw = typeof parsed.flags.ttl === "string" ? parsed.flags.ttl : undefined;
    let ttlMs: number | undefined;
    if (ttlRaw) {
      try {
        ttlMs = parseDurationMs(ttlRaw, { defaultUnit: "d" });
      } catch {
        return { shouldContinue: false, reply: { text: `Invalid --ttl value: ${ttlRaw}` } };
      }
    }
    const existingPin = (
      await listMemoryPins({
        workspaceDir: params.workspaceDir,
        scope: "all",
        includeExpired: true,
      })
    ).find((pin) => pin.id === pinId);
    if (!existingPin) {
      return { shouldContinue: false, reply: { text: `Pin not found: ${pinId}.` } };
    }
    const edited = await editMemoryPin({
      workspaceDir: params.workspaceDir,
      id: pinId,
      text,
      entity: typeof parsed.flags.entity === "string" ? parsed.flags.entity : undefined,
      ttlMs,
    });
    if (!edited) {
      return { shouldContinue: false, reply: { text: `Pin not found: ${pinId}.` } };
    }
    try {
      await commitRequired({
        workspaceDir: params.workspaceDir,
        writeScope: edited.scope,
        taskId: edited.taskId,
        actor: "user",
        events: [{ type: "STATE_PATCH_APPLIED", payload: { patch: { pins: [edited.id] } } }],
      });
    } catch (error) {
      const rollbackTtlMs =
        existingPin.type === "temporary" && typeof existingPin.expiresAt === "number"
          ? Math.max(existingPin.expiresAt - Date.now(), 1)
          : undefined;
      try {
        await editMemoryPin({
          workspaceDir: params.workspaceDir,
          id: existingPin.id,
          text: existingPin.text,
          entity: existingPin.entity,
          ttlMs: rollbackTtlMs,
        });
      } catch (rollbackError) {
        const rollbackDetail =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        logVerbose(`Pin edit rollback failed for ${existingPin.id}: ${rollbackDetail}`);
      }
      return durabilityFailureReply("Pin edit", error);
    }
    return { shouldContinue: false, reply: { text: `Updated pin ${pinId}.` } };
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
  const expectedTaskId = scope === "task" ? taskId : undefined;
  const normalizedText = normalizePinTextForMatch(text);
  const existingPin = (
    await listMemoryPins({
      workspaceDir: params.workspaceDir,
      scope: scope === "task" ? "task" : "global",
      taskId: expectedTaskId,
    })
  ).find(
    (candidate) =>
      candidate.type === type &&
      candidate.scope === scope &&
      (candidate.taskId ?? "") === (expectedTaskId ?? "") &&
      normalizePinTextForMatch(candidate.text) === normalizedText,
  );
  const pin = await upsertMemoryPin({
    workspaceDir: params.workspaceDir,
    type,
    text,
    scope,
    taskId,
    entity,
    ttlMs,
  });
  try {
    await commitRequired({
      workspaceDir: params.workspaceDir,
      writeScope: pin.scope,
      taskId: pin.taskId,
      actor: "user",
      events: [
        { type: "PIN_ADDED", payload: { pinId: pin.id, text: pin.text, pinType: pin.type } },
      ],
    });
  } catch (error) {
    if (!existingPin) {
      try {
        await removeMemoryPin({
          workspaceDir: params.workspaceDir,
          id: pin.id,
        });
      } catch (rollbackError) {
        const rollbackDetail =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        logVerbose(`Pin add rollback failed for ${pin.id}: ${rollbackDetail}`);
      }
    }
    return durabilityFailureReply("Pin add", error);
  }
  return {
    shouldContinue: false,
    reply: {
      text: `Pinned ${pin.id} as ${pin.type} (${scope}${pin.taskId ? `:${pin.taskId}` : ""}).`,
    },
  };
};

export const handleForgetCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/forget" && !normalized.startsWith("/forget ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /forget from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const raw = normalized === "/forget" ? "" : normalized.slice("/forget".length).trim();
  const parsed = parseArgs(raw);
  const text = parsed.values.join(" ").trim() || undefined;
  const taskId = typeof parsed.flags.task === "string" ? parsed.flags.task.trim() : undefined;
  const entity = typeof parsed.flags.entity === "string" ? parsed.flags.entity.trim() : undefined;
  const beforeRaw =
    typeof parsed.flags.before === "string" ? parsed.flags.before.trim() : undefined;
  const includePins =
    parsed.flags.pins === true || String(parsed.flags.pins ?? "").toLowerCase() === "true";
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
          "/forget --pins true (required to remove pins)\n" +
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
    includePins,
  });

  if (taskId && params.sessionEntry) {
    const activeTask = resolveSessionTaskView({ entry: params.sessionEntry });
    if (activeTask.taskId === taskId) {
      const now = Date.now();
      try {
        await commitRequired({
          workspaceDir: params.workspaceDir,
          writeScope: "task",
          taskId,
          actor: "user",
          events: [{ type: "STATE_PATCH_APPLIED", payload: { patch: { status: "archived" } } }],
          now,
        });
      } catch (error) {
        return durabilityFailureReply(`Forget task ${taskId}`, error);
      }

      let next = applySessionTaskUpdate(params.sessionEntry, {
        taskId,
        status: "archived",
        updatedAt: now,
        source: "forget",
      });
      next = applySessionTaskUpdate(next, {
        taskId: DEFAULT_SESSION_TASK_ID,
        status: "active",
        updatedAt: now,
        source: "forget",
      });
      await persistSessionEntry({
        entry: next,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
      });
      try {
        await patchTaskCard({
          workspaceDir: params.workspaceDir,
          taskId,
          patch: { status: "archived" },
        });
      } catch {
        /* task-card patch is best-effort */
      }
      try {
        await updateBotCurrentTask({
          workspaceDir: params.workspaceDir,
          taskId: undefined,
          previousTaskId: taskId,
          previousStatus: "archived",
        });
      } catch {
        /* bot_current update is best-effort */
      }
      await setTaskRegistryStatus({
        workspaceDir: params.workspaceDir,
        taskId,
        status: "archived",
        now,
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
  if (!allowTextCommands) {
    return null;
  }
  const rewritten =
    rewriteTaskCommand(params.command.rawBodyNormalized) ??
    rewriteTaskCommand(params.command.commandBodyNormalized);
  if (!rewritten) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /task from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const raw = rewritten === "/task" ? "" : rewritten.slice("/task".length).trim();
  const parsed = parseArgs(raw);
  const action = parsed.values[0]?.toLowerCase() ?? "show";
  const entry = ensureSessionEntry({
    entry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
  });
  const active = resolveSessionTaskView({ entry });

  if (action === "show" || action === "status") {
    const line = `Task ${active.taskId} (${active.status ?? "active"})`;
    const title = active.title ? `\nTitle: ${active.title}` : "";
    const stack = (entry.taskStack ?? []).length
      ? `\nStack: ${(entry.taskStack ?? []).join(" -> ")}`
      : "";
    const autoSwitch = entry.autoSwitchOptIn === true ? "on" : "off";
    return {
      shouldContinue: false,
      reply: { text: `${line}${title}\nAutoswitch: ${autoSwitch}${stack}` },
    };
  }

  if (action === "list") {
    const registryTasks = await listTaskRegistry(params.workspaceDir);
    if (registryTasks.length > 0) {
      const lines = registryTasks
        .slice(0, 25)
        .map((task) => `- ${task.taskId} (${task.status})${task.title ? ` - ${task.title}` : ""}`);
      return { shouldContinue: false, reply: { text: `Known tasks:\n${lines.join("\n")}` } };
    }
    const tasks = Object.entries(entry.taskStateById ?? {}).toSorted(
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

  if (action === "new") {
    const title = parsed.values.slice(1).join(" ").trim();
    if (!title) {
      return { shouldContinue: false, reply: { text: "Usage: /task new <title>" } };
    }
    const existing = new Set(
      (await listTaskRegistry(params.workspaceDir)).map((task) => task.taskId),
    );
    let taskId = slugifyTaskTitle(title);
    let suffix = 2;
    while (existing.has(taskId)) {
      taskId = `${slugifyTaskTitle(title)}-${suffix}`;
      suffix += 1;
    }
    try {
      const result = await switchTaskWithSessionReset({
        workspaceDir: params.workspaceDir,
        entry,
        taskId,
        title,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
        source: "task.new",
      });
      return { shouldContinue: false, reply: { text: result.reply } };
    } catch (error) {
      return durabilityFailureReply(`Create task ${taskId}`, error);
    }
  }

  if (action === "set" || action === "switch") {
    const taskId = parsed.values[1]?.trim();
    if (!taskId) {
      return { shouldContinue: false, reply: { text: "Usage: /task set <id> [title]" } };
    }
    const title = parsed.values.slice(2).join(" ").trim() || undefined;
    try {
      const result = await switchTaskWithSessionReset({
        workspaceDir: params.workspaceDir,
        entry,
        taskId,
        title,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
        source: "task.set",
      });
      return { shouldContinue: false, reply: { text: result.reply } };
    } catch (error) {
      return durabilityFailureReply(`Set active task to ${taskId}`, error);
    }
  }

  if (action === "link") {
    const left = parsed.values[1]?.trim();
    const right = parsed.values[2]?.trim();
    if (!left || !right) {
      return { shouldContinue: false, reply: { text: "Usage: /task link <id1> <id2>" } };
    }
    const leftTask = await getTaskRegistryTask({ workspaceDir: params.workspaceDir, taskId: left });
    const rightTask = await getTaskRegistryTask({
      workspaceDir: params.workspaceDir,
      taskId: right,
    });
    if (!leftTask || !rightTask) {
      return {
        shouldContinue: false,
        reply: { text: `Could not link tasks. Ensure both task ids exist: ${left}, ${right}` },
      };
    }

    try {
      await commitRequired({
        workspaceDir: params.workspaceDir,
        writeScope: "global",
        actor: "user",
        events: [
          {
            type: "STATE_PATCH_APPLIED",
            payload: { patch: { links: [left, right] } },
          },
        ],
      });
      const linked = await linkTaskRegistryTasks({
        workspaceDir: params.workspaceDir,
        taskId: left,
        relatedTaskId: right,
      });
      if (!linked.updated) {
        return {
          shouldContinue: false,
          reply: { text: `Could not link tasks. Ensure both task ids exist: ${left}, ${right}` },
        };
      }
    } catch (error) {
      return durabilityFailureReply(`Link tasks ${left} and ${right}`, error);
    }
    return { shouldContinue: false, reply: { text: `Linked tasks ${left} <-> ${right}.` } };
  }

  // Shorthand: /task #3, /task my-task-id, /task 3 → treat as task switch
  const shorthandTaskId = isTaskIdShorthand(action);
  if (shorthandTaskId) {
    try {
      const result = await switchTaskWithSessionReset({
        workspaceDir: params.workspaceDir,
        entry,
        taskId: shorthandTaskId,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
        source: "task.shorthand",
      });
      return { shouldContinue: false, reply: { text: result.reply } };
    } catch (error) {
      return durabilityFailureReply(`Switch to task ${shorthandTaskId}`, error);
    }
  }

  const statusAction = normalizeTaskStatus(action);
  if (!statusAction) {
    return {
      shouldContinue: false,
      reply: {
        text:
          "Usage:\n" +
          "/task show|list|new|set|link|<task-id>\n" +
          "/task set <id> [title]\n" +
          "/task <active|paused|completed|archived|done>\n" +
          "/tasks | /resume <id> | /switch <id> | /newtask <title> | /archive <id> | /close <id>",
      },
    };
  }

  const targetTaskId = parsed.values[1]?.trim() || active.taskId;
  const now = Date.now();
  let next = applySessionTaskUpdate(entry, {
    taskId: targetTaskId,
    status: statusAction,
    updatedAt: now,
    source: "task.status",
  });
  if (
    (statusAction === "completed" || statusAction === "archived") &&
    targetTaskId !== DEFAULT_SESSION_TASK_ID &&
    resolveSessionTaskView({ entry: next }).taskId === targetTaskId
  ) {
    next = applySessionTaskUpdate(next, {
      taskId: DEFAULT_SESSION_TASK_ID,
      status: "active",
      updatedAt: now,
      source: "task.status",
    });
  }
  try {
    await commitRequired({
      workspaceDir: params.workspaceDir,
      writeScope: "task",
      taskId: targetTaskId,
      actor: "user",
      events: [
        {
          type: "STATE_PATCH_APPLIED",
          payload: { patch: { status: mapSessionStatusToRegistryStatus(statusAction) } },
        },
      ],
      now,
    });
    await persistSessionEntry({
      entry: next,
      sessionStore: params.sessionStore,
      sessionKey: params.sessionKey,
      storePath: params.storePath,
    });
    await upsertTaskRegistryTask({
      workspaceDir: params.workspaceDir,
      taskId: targetTaskId,
      status: mapSessionStatusToRegistryStatus(statusAction),
      now,
    });
    try {
      await patchTaskCard({
        workspaceDir: params.workspaceDir,
        taskId: targetTaskId,
        patch: { status: statusAction },
      });
    } catch {
      /* task-card patch is best-effort */
    }
    try {
      const nextActiveTaskId = resolveSessionTaskView({ entry: next }).taskId;
      const boardTaskId =
        nextActiveTaskId !== DEFAULT_SESSION_TASK_ID ? nextActiveTaskId : undefined;
      const previousTaskId =
        active.taskId !== DEFAULT_SESSION_TASK_ID && active.taskId !== boardTaskId
          ? active.taskId
          : undefined;
      if (previousTaskId || boardTaskId) {
        const previousStatus =
          previousTaskId === targetTaskId &&
          (statusAction === "completed" || statusAction === "archived")
            ? statusAction
            : "paused";
        await updateBotCurrentTask({
          workspaceDir: params.workspaceDir,
          taskId: boardTaskId,
          title: next.taskStateById?.[boardTaskId ?? ""]?.title,
          previousTaskId,
          previousStatus,
        });
      }
    } catch {
      /* bot_current update is best-effort */
    }
  } catch (error) {
    return durabilityFailureReply(`Set task ${targetTaskId} status`, error);
  }
  return { shouldContinue: false, reply: { text: `Task ${targetTaskId} marked ${statusAction}.` } };
};

export const handleAutoSwitchCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/autoswitch" && !normalized.startsWith("/autoswitch ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /autoswitch from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const raw = normalized === "/autoswitch" ? "" : normalized.slice("/autoswitch".length).trim();
  const mode = raw.toLowerCase();
  const entry = ensureSessionEntry({
    entry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
  });
  const nextValue = mode === "on" ? true : mode === "off" ? false : entry.autoSwitchOptIn === true;
  const next: SessionEntry = {
    ...entry,
    autoSwitchOptIn: nextValue,
    updatedAt: Date.now(),
  };
  await persistSessionEntry({
    entry: next,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  if (mode !== "" && mode !== "on" && mode !== "off" && mode !== "status") {
    return { shouldContinue: false, reply: { text: "Usage: /autoswitch on|off|status" } };
  }
  return {
    shouldContinue: false,
    reply: { text: `Autoswitch is ${nextValue ? "on" : "off"}.` },
  };
};

export const handleMemoryModeCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/mode" && !normalized.startsWith("/mode ")) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /mode from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  const raw = normalized === "/mode" ? "" : normalized.slice("/mode".length).trim().toLowerCase();
  const entry = ensureSessionEntry({
    entry: params.sessionEntry,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
  });
  if (raw && raw !== "minimal" && raw !== "supportive" && raw !== "status") {
    return { shouldContinue: false, reply: { text: "Usage: /mode minimal|supportive|status" } };
  }
  const nextMode =
    raw === "minimal" || raw === "supportive" ? raw : (entry.memoryGuidanceMode ?? "supportive");
  const next: SessionEntry = {
    ...entry,
    memoryGuidanceMode: nextMode,
    updatedAt: Date.now(),
  };
  await persistSessionEntry({
    entry: next,
    sessionStore: params.sessionStore,
    sessionKey: params.sessionKey,
    storePath: params.storePath,
  });
  return { shouldContinue: false, reply: { text: `Memory mode is ${nextMode}.` } };
};
