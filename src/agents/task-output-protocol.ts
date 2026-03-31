import type { Static, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import AjvPkg, { type ErrorObject, type ValidateFunction } from "ajv";
import fs from "node:fs";
import type { TaskOutput, TaskOutputStatus } from "./task-output-contract.js";

declare const taskTranscriptTaskIdBrand: unique symbol;

export type TaskTranscriptTaskId = string & {
  readonly [taskTranscriptTaskIdBrand]: "TaskTranscriptTaskId";
};

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

const Ajv = AjvPkg as unknown as new (opts?: object) => import("ajv").default;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});

const validatorCache = new WeakMap<object, ValidateFunction>();

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const NullableNumberSchema = Type.Union([Type.Number(), Type.Null()]);
const NullableSignalSchema = Type.Union([Type.String(), Type.Number(), Type.Null()]);
const TaskOutputStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("awaiting_input"),
  Type.Literal("success"),
  Type.Literal("error"),
  Type.Literal("cancelled"),
  Type.Literal("timeout"),
]);

const TaskAwaitingInputSchema = Type.Object(
  {
    detected_at: Type.Number(),
    reason: NonEmptyStringSchema,
    guidance: NonEmptyStringSchema,
    prompt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const TaskOutputUsageSchema = Type.Object(
  {
    input_tokens: Type.Optional(NullableNumberSchema),
    output_tokens: Type.Optional(NullableNumberSchema),
    total_tokens: Type.Optional(NullableNumberSchema),
    duration_ms: Type.Optional(NullableNumberSchema),
  },
  { additionalProperties: false },
);

export const TaskOutputArtifactSchema = Type.Object(
  {
    task_id: NonEmptyStringSchema,
    task_type: NonEmptyStringSchema,
    status: TaskOutputStatusSchema,
    description: Type.String(),
    output_path: Type.Optional(Type.String()),
    transcript_path: Type.Optional(Type.String()),
    final_text: Type.Optional(Type.String()),
    stdout: Type.Optional(Type.String()),
    stderr: Type.Optional(Type.String()),
    exit_code: Type.Optional(NullableNumberSchema),
    error: Type.Optional(Type.String()),
    prompt: Type.Optional(Type.String()),
    notified: Type.Optional(Type.Boolean()),
    awaiting_input: Type.Optional(TaskAwaitingInputSchema),
    usage: Type.Optional(TaskOutputUsageSchema),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

type TaskOutputArtifactSchemaValue = Static<typeof TaskOutputArtifactSchema>;
type _TaskOutputArtifactParity = Expect<Equal<TaskOutputArtifactSchemaValue, TaskOutput>>;

const TaskTranscriptHeaderSchema = Type.Object(
  {
    type: Type.Literal("task_header"),
    task_id: NonEmptyStringSchema,
    task_type: NonEmptyStringSchema,
    started_at: Type.Number(),
    command: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    cwd: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const LegacyShellTaskHeaderSchema = Type.Object(
  {
    type: Type.Literal("shell_task"),
    task_id: NonEmptyStringSchema,
    task_type: Type.Literal("shell"),
    started_at: Type.Number(),
    command: Type.String(),
    cwd: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const TaskTranscriptStreamSchema = Type.Object(
  {
    type: Type.Union([Type.Literal("stdout"), Type.Literal("stderr")]),
    task_id: NonEmptyStringSchema,
    task_type: NonEmptyStringSchema,
    ts: Type.Number(),
    chunk: Type.String(),
  },
  { additionalProperties: false },
);

const TaskTranscriptExitSchema = Type.Object(
  {
    type: Type.Literal("exit"),
    task_id: NonEmptyStringSchema,
    task_type: NonEmptyStringSchema,
    ts: Type.Number(),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("killed"),
    ]),
    terminal_reason: Type.Optional(
      Type.Union([
        Type.Literal("completed"),
        Type.Literal("error"),
        Type.Literal("cancelled"),
        Type.Literal("timeout"),
      ]),
    ),
    exit_code: Type.Optional(NullableNumberSchema),
    exit_signal: Type.Optional(NullableSignalSchema),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const TaskTranscriptSnapshotSchema = Type.Object(
  {
    type: Type.Literal("snapshot"),
    ts: Type.Number(),
    task: TaskOutputArtifactSchema,
  },
  { additionalProperties: false },
);

export const TaskTranscriptEntrySchema = Type.Union([
  TaskTranscriptHeaderSchema,
  TaskTranscriptStreamSchema,
  TaskTranscriptExitSchema,
  TaskTranscriptSnapshotSchema,
]);

type TaskTranscriptHeaderSchemaValue = Static<typeof TaskTranscriptHeaderSchema>;
type TaskTranscriptStreamSchemaValue = Static<typeof TaskTranscriptStreamSchema>;
type TaskTranscriptExitSchemaValue = Static<typeof TaskTranscriptExitSchema>;
type TaskTranscriptSnapshotSchemaValue = Static<typeof TaskTranscriptSnapshotSchema>;
type TaskTranscriptEntrySchemaValue = Static<typeof TaskTranscriptEntrySchema>;

type _TaskTranscriptEntryParity = Expect<
  Equal<
    TaskTranscriptEntrySchemaValue,
    | TaskTranscriptHeaderSchemaValue
    | TaskTranscriptStreamSchemaValue
    | TaskTranscriptExitSchemaValue
    | TaskTranscriptSnapshotSchemaValue
  >
>;

export type TaskTranscriptHeaderEntry = Omit<TaskTranscriptHeaderSchemaValue, "task_id"> & {
  task_id: TaskTranscriptTaskId;
};

export type TaskTranscriptStreamEntry = Omit<TaskTranscriptStreamSchemaValue, "task_id"> & {
  task_id: TaskTranscriptTaskId;
};

export type TaskTranscriptExitEntry = Omit<TaskTranscriptExitSchemaValue, "task_id"> & {
  task_id: TaskTranscriptTaskId;
};

export type TaskTranscriptSnapshotEntry = TaskTranscriptSnapshotSchemaValue;

export type TaskTranscriptEntry =
  | TaskTranscriptHeaderEntry
  | TaskTranscriptStreamEntry
  | TaskTranscriptExitEntry
  | TaskTranscriptSnapshotEntry;

export type TaskTranscriptReplayResult = {
  task: TaskOutput | null;
  invalidLineCount: number;
  parsedEntryCount: number;
};

function getValidator(schema: object): ValidateFunction {
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }
  const compiled = ajv.compile(schema);
  validatorCache.set(schema, compiled);
  return compiled;
}

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "invalid payload";
  }
  return errors
    .map((error) => {
      const path = error.instancePath?.replace(/^\//, "").replace(/\//g, ".") || "<root>";
      return `${path}: ${error.message ?? "invalid value"}`;
    })
    .join("; ");
}

function validateSchema<T>(
  schema: TSchema,
  value: unknown,
): { ok: true; value: T } | { ok: false; error: string } {
  const validate = getValidator(schema);
  const cloned = structuredClone(value);
  if (validate(cloned)) {
    return { ok: true, value: cloned as T };
  }
  return { ok: false, error: formatValidationErrors(validate.errors) };
}

function brandTaskId(value: string): TaskTranscriptTaskId {
  return value as TaskTranscriptTaskId;
}

function normalizeTaskOutputArtifact(value: TaskOutputArtifactSchemaValue): TaskOutput {
  return {
    ...value,
    task_id: value.task_id.trim(),
    task_type: value.task_type.trim(),
  };
}

function normalizeTaskTranscriptEntry(value: TaskTranscriptEntrySchemaValue): TaskTranscriptEntry {
  switch (value.type) {
    case "task_header":
      return {
        ...value,
        task_id: brandTaskId(value.task_id.trim()),
        task_type: value.task_type.trim(),
      };
    case "stdout":
    case "stderr":
      return {
        ...value,
        task_id: brandTaskId(value.task_id.trim()),
        task_type: value.task_type.trim(),
      };
    case "exit":
      return {
        ...value,
        task_id: brandTaskId(value.task_id.trim()),
        task_type: value.task_type.trim(),
      };
    case "snapshot":
      return {
        ...value,
        task: normalizeTaskOutputArtifact(value.task),
      };
    default:
      return assertNever(value);
  }
}

function normalizeLegacyShellHeader(
  value: Static<typeof LegacyShellTaskHeaderSchema>,
): TaskTranscriptHeaderEntry {
  return {
    type: "task_header",
    task_id: brandTaskId(value.task_id.trim()),
    task_type: "shell",
    started_at: value.started_at,
    command: value.command,
    description: value.command,
    cwd: value.cwd,
  };
}

function createReplayTask(params: {
  taskId: string;
  taskType: string;
  description?: string;
  prompt?: string;
}): TaskOutput {
  return {
    task_id: params.taskId,
    task_type: params.taskType,
    status: "running",
    description: params.description?.trim() || params.prompt?.trim() || `${params.taskType} task`,
    prompt: params.prompt?.trim() || undefined,
  };
}

function resolveTaskOutputStatusFromExit(entry: TaskTranscriptExitEntry): TaskOutputStatus {
  switch (entry.terminal_reason) {
    case "completed":
      return "success";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "error":
      return "error";
    default:
      switch (entry.status) {
        case "completed":
          return "success";
        case "killed":
          return "cancelled";
        case "failed":
          return "error";
        case "running":
          return "running";
        default:
          return assertNever(entry.status);
      }
  }
}

function applyHeaderEntry(task: TaskOutput | null, entry: TaskTranscriptHeaderEntry): TaskOutput {
  if (!task) {
    return createReplayTask({
      taskId: entry.task_id,
      taskType: entry.task_type,
      description: entry.description,
      prompt: entry.command,
    });
  }
  return {
    ...task,
    task_id: entry.task_id,
    task_type: entry.task_type,
    description: task.description || entry.description || entry.command || task.description,
    prompt: task.prompt ?? entry.command,
  };
}

function applyStreamEntry(
  task: TaskOutput | null,
  entry: TaskTranscriptStreamEntry,
  stream: "stdout" | "stderr",
): TaskOutput {
  const base =
    task ??
    createReplayTask({
      taskId: entry.task_id,
      taskType: entry.task_type,
    });
  const existing = base[stream] ?? "";
  return {
    ...base,
    task_id: entry.task_id,
    task_type: entry.task_type,
    [stream]: existing + entry.chunk,
  };
}

function applyExitEntry(task: TaskOutput | null, entry: TaskTranscriptExitEntry): TaskOutput {
  const base =
    task ??
    createReplayTask({
      taskId: entry.task_id,
      taskType: entry.task_type,
    });
  return {
    ...base,
    task_id: entry.task_id,
    task_type: entry.task_type,
    status: resolveTaskOutputStatusFromExit(entry),
    exit_code: entry.exit_code,
    error: entry.error,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${JSON.stringify(value)}`);
}

export function parseTaskOutputArtifact(value: unknown): TaskOutput | null {
  const validated = validateSchema<TaskOutputArtifactSchemaValue>(TaskOutputArtifactSchema, value);
  if (!validated.ok) {
    return null;
  }
  return normalizeTaskOutputArtifact(validated.value);
}

export function assertTaskOutputArtifact(value: unknown): TaskOutput {
  const parsed = parseTaskOutputArtifact(value);
  if (!parsed) {
    const validated = validateSchema<TaskOutputArtifactSchemaValue>(
      TaskOutputArtifactSchema,
      value,
    );
    throw new Error(
      `Invalid task output artifact: ${validated.ok ? "unknown validation error" : validated.error}`,
    );
  }
  return parsed;
}

export function parseTaskTranscriptEntry(value: unknown): TaskTranscriptEntry | null {
  const validated = validateSchema<TaskTranscriptEntrySchemaValue>(
    TaskTranscriptEntrySchema,
    value,
  );
  if (validated.ok) {
    return normalizeTaskTranscriptEntry(validated.value);
  }
  const legacy = validateSchema<Static<typeof LegacyShellTaskHeaderSchema>>(
    LegacyShellTaskHeaderSchema,
    value,
  );
  if (legacy.ok) {
    return normalizeLegacyShellHeader(legacy.value);
  }
  return null;
}

export function assertTaskTranscriptEntry(value: unknown): TaskTranscriptEntry {
  const parsed = parseTaskTranscriptEntry(value);
  if (!parsed) {
    const validated = validateSchema<TaskTranscriptEntrySchemaValue>(
      TaskTranscriptEntrySchema,
      value,
    );
    if (!validated.ok) {
      throw new Error(`Invalid task transcript entry: ${validated.error}`);
    }
    throw new Error("Invalid task transcript entry.");
  }
  return parsed;
}

export function replayTaskTranscript(entries: readonly TaskTranscriptEntry[]): TaskOutput | null {
  let task: TaskOutput | null = null;

  for (const entry of entries) {
    switch (entry.type) {
      case "task_header":
        task = applyHeaderEntry(task, entry);
        break;
      case "stdout":
        task = applyStreamEntry(task, entry, "stdout");
        break;
      case "stderr":
        task = applyStreamEntry(task, entry, "stderr");
        break;
      case "exit":
        task = applyExitEntry(task, entry);
        break;
      case "snapshot":
        task = {
          ...entry.task,
        };
        break;
      default:
        assertNever(entry);
    }
  }

  return task;
}

export function replayTaskTranscriptFromFile(params: {
  transcriptPath: string;
  outputPath?: string;
}): TaskTranscriptReplayResult {
  let raw = "";
  try {
    raw = fs.readFileSync(params.transcriptPath, "utf8");
  } catch {
    return {
      task: null,
      invalidLineCount: 0,
      parsedEntryCount: 0,
    };
  }

  const entries: TaskTranscriptEntry[] = [];
  let invalidLineCount = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      invalidLineCount += 1;
      continue;
    }
    const entry = parseTaskTranscriptEntry(parsed);
    if (!entry) {
      invalidLineCount += 1;
      continue;
    }
    entries.push(entry);
  }

  const task = replayTaskTranscript(entries);
  if (!task) {
    return {
      task: null,
      invalidLineCount,
      parsedEntryCount: entries.length,
    };
  }

  return {
    task: {
      ...task,
      output_path: task.output_path ?? params.outputPath,
      transcript_path: task.transcript_path ?? params.transcriptPath,
    },
    invalidLineCount,
    parsedEntryCount: entries.length,
  };
}
