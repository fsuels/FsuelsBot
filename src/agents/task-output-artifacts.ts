import fs from "node:fs";
import path from "node:path";
import type { TaskOutput } from "./task-output-contract.js";
import { resolveStateDir } from "../config/paths.js";
import { writeTextFileAtomicSync } from "../infra/atomic-file.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  assertTaskOutputArtifact,
  assertTaskTranscriptEntry,
  parseTaskOutputArtifact,
  parseTaskTranscriptEntry,
  replayTaskTranscript,
} from "./task-output-protocol.js";

const log = createSubsystemLogger("agents/task-output");
const TASK_OUTPUT_ARTIFACT_TYPES = ["shell", "agent", "remote_agent"] as const;

export type TaskArtifactReadDiagnostic = {
  kind: "output" | "transcript";
  taskType: string;
  path: string;
  error: string;
};

export type TaskArtifactReadResult = {
  task: TaskOutput | null;
  diagnostic?: TaskArtifactReadDiagnostic;
};

function sanitizeTaskFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

const NOT_FOUND_CODES = new Set(["ENOENT", "ENOTDIR"]);

function ensureTrailingSep(value: string) {
  return value.endsWith(path.sep) ? value : value + path.sep;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return Boolean(err && typeof err === "object" && "code" in (err as Record<string, unknown>));
}

function isNotFoundError(err: unknown) {
  return isNodeError(err) && typeof err.code === "string" && NOT_FOUND_CODES.has(err.code);
}

function isSymlinkError(err: unknown) {
  return (
    isNodeError(err) && (err.code === "ELOOP" || err.code === "EINVAL" || err.code === "ENOTSUP")
  );
}

function formatArtifactIoError(err: unknown) {
  if (isSymlinkError(err)) {
    return "symlink access blocked";
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  return String(err);
}

function tryLstat(pathname: string) {
  try {
    return fs.lstatSync(pathname);
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

function resolveArtifactsRoot(env: NodeJS.ProcessEnv = process.env) {
  const artifactsDir = resolveTaskArtifactsDir(env);
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });
  }
  const resolvedDir = path.resolve(artifactsDir);
  const realDir = fs.realpathSync(artifactsDir);
  return {
    resolvedDir,
    realDir,
    realDirWithSep: ensureTrailingSep(realDir),
  };
}

function validateArtifactPath(pathname: string, env: NodeJS.ProcessEnv = process.env) {
  const { resolvedDir, realDir, realDirWithSep } = resolveArtifactsRoot(env);
  const resolvedPath = path.resolve(pathname);
  const relativePath = path.relative(resolvedDir, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`task artifact path escapes ${resolvedDir}`);
  }

  const parentDir = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  }

  const parentReal = fs.realpathSync(parentDir);
  if (parentReal !== realDir && !parentReal.startsWith(realDirWithSep)) {
    throw new Error(`task artifact path escapes ${resolvedDir}`);
  }

  const targetStat = tryLstat(resolvedPath);
  if (targetStat?.isSymbolicLink()) {
    throw new Error("symlink artifacts are not allowed");
  }

  return resolvedPath;
}

type ArtifactTextReadResult =
  | { exists: false }
  | { exists: true; text: string }
  | { exists: true; error: string };

function readArtifactTextFile(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
): ArtifactTextReadResult {
  const existingStat = tryLstat(pathname);
  if (!existingStat) {
    return { exists: false as const };
  }
  if (!existingStat.isFile()) {
    return {
      exists: true as const,
      error: existingStat.isSymbolicLink()
        ? "symlink artifacts are not allowed"
        : "artifact path is not a regular file",
    };
  }

  let resolvedPath: string;
  try {
    resolvedPath = validateArtifactPath(pathname, env);
  } catch (err) {
    return {
      exists: true as const,
      error: formatArtifactIoError(err),
    };
  }

  const supportsNoFollow = process.platform !== "win32" && "O_NOFOLLOW" in fs.constants;
  const flags = fs.constants.O_RDONLY | (supportsNoFollow ? fs.constants.O_NOFOLLOW : 0);
  let fd: number | undefined;
  try {
    fd = fs.openSync(resolvedPath, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      return {
        exists: true as const,
        error: "artifact path is not a regular file",
      };
    }
    return {
      exists: true as const,
      text: fs.readFileSync(fd, "utf8"),
    };
  } catch (err) {
    return {
      exists: true as const,
      error: formatArtifactIoError(err),
    };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function writeArtifactTextFile(
  pathname: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    const resolvedPath = validateArtifactPath(pathname, env);
    writeTextFileAtomicSync(resolvedPath, content, { mode: 0o600 });
    return true;
  } catch (err) {
    log.warn(`task artifact write failed (${pathname}): ${formatArtifactIoError(err)}`);
    return false;
  }
}

function appendArtifactTextFile(
  pathname: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  let fd: number | undefined;
  try {
    const resolvedPath = validateArtifactPath(pathname, env);
    const supportsNoFollow = process.platform !== "win32" && "O_NOFOLLOW" in fs.constants;
    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_APPEND |
      fs.constants.O_CREAT |
      (supportsNoFollow ? fs.constants.O_NOFOLLOW : 0);
    fd = fs.openSync(resolvedPath, flags, 0o600);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error("artifact path is not a regular file");
    }
    fs.writeFileSync(fd, content, "utf8");
    return true;
  } catch (err) {
    log.warn(`task artifact append failed (${pathname}): ${formatArtifactIoError(err)}`);
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function buildDiagnostic(params: TaskArtifactReadDiagnostic): TaskArtifactReadDiagnostic {
  return {
    kind: params.kind,
    taskType: params.taskType,
    path: params.path,
    error: params.error,
  };
}

function readTaskOutputArtifactAtPath(params: {
  pathname: string;
  taskType: string;
  env?: NodeJS.ProcessEnv;
}): TaskArtifactReadResult {
  const read = readArtifactTextFile(params.pathname, params.env);
  if (!read.exists) {
    return { task: null };
  }
  if (!("text" in read)) {
    return {
      task: null,
      diagnostic: buildDiagnostic({
        kind: "output",
        taskType: params.taskType,
        path: params.pathname,
        error: read.error,
      }),
    };
  }
  try {
    const parsed = JSON.parse(read.text) as unknown;
    const task = parseTaskOutputArtifact(parsed);
    if (!task) {
      return {
        task: null,
        diagnostic: buildDiagnostic({
          kind: "output",
          taskType: params.taskType,
          path: params.pathname,
          error: "invalid task output artifact",
        }),
      };
    }
    return { task };
  } catch (err) {
    return {
      task: null,
      diagnostic: buildDiagnostic({
        kind: "output",
        taskType: params.taskType,
        path: params.pathname,
        error: `invalid JSON: ${formatArtifactIoError(err)}`,
      }),
    };
  }
}

function replayTaskTranscriptText(params: {
  raw: string;
  transcriptPath: string;
  outputPath?: string;
}): TaskOutput | null {
  const entries = params.raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        const entry = parseTaskTranscriptEntry(parsed);
        return entry ? [entry] : [];
      } catch {
        return [];
      }
    });
  const task = replayTaskTranscript(entries);
  if (!task) {
    return null;
  }
  return {
    ...task,
    output_path: task.output_path ?? params.outputPath,
    transcript_path: task.transcript_path ?? params.transcriptPath,
  };
}

function readTaskTranscriptAtPath(params: {
  transcriptPath: string;
  outputPath?: string;
  taskType: string;
  env?: NodeJS.ProcessEnv;
}): TaskArtifactReadResult {
  const read = readArtifactTextFile(params.transcriptPath, params.env);
  if (!read.exists) {
    return { task: null };
  }
  if (!("text" in read)) {
    return {
      task: null,
      diagnostic: buildDiagnostic({
        kind: "transcript",
        taskType: params.taskType,
        path: params.transcriptPath,
        error: read.error,
      }),
    };
  }
  const task = replayTaskTranscriptText({
    raw: read.text,
    transcriptPath: params.transcriptPath,
    outputPath: params.outputPath,
  });
  if (!task) {
    return {
      task: null,
      diagnostic: buildDiagnostic({
        kind: "transcript",
        taskType: params.taskType,
        path: params.transcriptPath,
        error: "transcript did not contain a recoverable task state",
      }),
    };
  }
  return { task };
}

export function resolveTaskArtifactsDir(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStateDir(env), "task-output");
}

export function resolveTaskOutputPath(params: {
  taskId: string;
  taskType: string;
  env?: NodeJS.ProcessEnv;
}) {
  return path.join(
    resolveTaskArtifactsDir(params.env),
    `${sanitizeTaskFilePart(params.taskType)}-${sanitizeTaskFilePart(params.taskId)}.json`,
  );
}

export function resolveTaskTranscriptPath(params: {
  taskId: string;
  taskType: string;
  env?: NodeJS.ProcessEnv;
}) {
  return path.join(
    resolveTaskArtifactsDir(params.env),
    `${sanitizeTaskFilePart(params.taskType)}-${sanitizeTaskFilePart(params.taskId)}.jsonl`,
  );
}

export function writeTaskOutputArtifact(task: TaskOutput) {
  const outputPath = task.output_path?.trim();
  if (!outputPath) {
    return false;
  }
  const normalizedTask = assertTaskOutputArtifact(task);
  return writeArtifactTextFile(outputPath, `${JSON.stringify(normalizedTask, null, 2)}\n`);
}

export function readTaskOutputArtifact(taskId: string, env: NodeJS.ProcessEnv = process.env) {
  return readTaskOutputArtifactDetailed(taskId, env).task;
}

export function readTaskOutputArtifactDetailed(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): TaskArtifactReadResult {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return { task: null };
  }
  const artifactsDir = resolveTaskArtifactsDir(env);
  const sanitizedTaskId = sanitizeTaskFilePart(trimmedTaskId);
  const candidatePaths = TASK_OUTPUT_ARTIFACT_TYPES.map((taskType) => ({
    taskType,
    pathname: resolveTaskOutputPath({ taskId: trimmedTaskId, taskType, env }),
  }));
  let diagnostic: TaskArtifactReadDiagnostic | undefined;

  for (const candidate of candidatePaths) {
    const artifact = readTaskOutputArtifactAtPath({
      pathname: candidate.pathname,
      taskType: candidate.taskType,
      env,
    });
    if (artifact.task?.task_id === trimmedTaskId) {
      return artifact;
    }
    if (!diagnostic && artifact.diagnostic) {
      diagnostic = artifact.diagnostic;
    }
  }

  let fileNames: string[] = [];
  try {
    fileNames = fs.readdirSync(artifactsDir);
  } catch {
    return { task: null, diagnostic };
  }
  const suffix = `-${sanitizedTaskId}.json`;
  for (const fileName of fileNames) {
    if (!fileName.endsWith(suffix)) {
      continue;
    }
    const taskType = fileName.slice(0, fileName.length - suffix.length) || "unknown";
    const artifact = readTaskOutputArtifactAtPath({
      pathname: path.join(artifactsDir, fileName),
      taskType,
      env,
    });
    if (artifact.task?.task_id === trimmedTaskId) {
      return artifact;
    }
    if (!diagnostic && artifact.diagnostic) {
      diagnostic = artifact.diagnostic;
    }
  }
  return { task: null, diagnostic };
}

export function listTaskOutputArtifacts(env: NodeJS.ProcessEnv = process.env): TaskOutput[] {
  let fileNames: string[] = [];
  try {
    fileNames = fs.readdirSync(resolveTaskArtifactsDir(env));
  } catch {
    return [];
  }
  const artifacts = new Map<string, TaskOutput>();
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const taskType = fileName.replace(/-[^-]+\.json$/, "") || "unknown";
    const artifact = readTaskOutputArtifactAtPath({
      pathname: path.join(resolveTaskArtifactsDir(env), fileName),
      taskType,
      env,
    }).task;
    if (!artifact || artifacts.has(artifact.task_id)) {
      continue;
    }
    artifacts.set(artifact.task_id, artifact);
  }
  return [...artifacts.values()];
}

export function setTaskOutputArtifactNotified(
  taskId: string,
  notified = true,
  env: NodeJS.ProcessEnv = process.env,
) {
  const artifact = readTaskOutputArtifact(taskId, env);
  if (!artifact?.output_path) {
    return false;
  }
  if (artifact.notified === notified) {
    return true;
  }
  writeTaskOutputArtifact({
    ...artifact,
    notified,
  });
  return true;
}

export function ensureTaskTranscriptArtifact(params: {
  transcriptPath?: string;
  header: Record<string, unknown>;
}) {
  const transcriptPath = params.transcriptPath?.trim();
  if (!transcriptPath) {
    return false;
  }
  if (fs.existsSync(transcriptPath)) {
    try {
      validateArtifactPath(transcriptPath);
      return true;
    } catch (err) {
      log.warn(`task transcript init blocked (${transcriptPath}): ${formatArtifactIoError(err)}`);
      return false;
    }
  }
  const header = assertTaskTranscriptEntry(params.header);
  return writeArtifactTextFile(transcriptPath, `${JSON.stringify(header)}\n`);
}

export function appendTaskTranscriptArtifact(params: {
  transcriptPath?: string;
  event: Record<string, unknown>;
}) {
  const transcriptPath = params.transcriptPath?.trim();
  if (!transcriptPath) {
    return false;
  }
  const event = assertTaskTranscriptEntry(params.event);
  return appendArtifactTextFile(transcriptPath, `${JSON.stringify(event)}\n`);
}

export function readTaskOutputFromTranscript(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): TaskOutput | null {
  return readTaskOutputFromTranscriptDetailed(taskId, env).task;
}

export function readTaskOutputFromTranscriptDetailed(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): TaskArtifactReadResult {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return { task: null };
  }

  let diagnostic: TaskArtifactReadDiagnostic | undefined;
  for (const taskType of TASK_OUTPUT_ARTIFACT_TYPES) {
    const transcriptPath = resolveTaskTranscriptPath({ taskId: trimmedTaskId, taskType, env });
    const replayed = readTaskTranscriptAtPath({
      transcriptPath,
      outputPath: resolveTaskOutputPath({ taskId: trimmedTaskId, taskType, env }),
      taskType,
      env,
    });
    if (replayed.task?.task_id === trimmedTaskId) {
      return replayed;
    }
    if (!diagnostic && replayed.diagnostic) {
      diagnostic = replayed.diagnostic;
    }
  }

  return { task: null, diagnostic };
}
