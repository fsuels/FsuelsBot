import fs from "node:fs";
import path from "node:path";
import type { TaskOutput } from "./task-output-contract.js";
import { resolveStateDir } from "../config/paths.js";
import {
  assertTaskOutputArtifact,
  assertTaskTranscriptEntry,
  parseTaskOutputArtifact,
  replayTaskTranscriptFromFile,
} from "./task-output-protocol.js";

function sanitizeTaskFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function readTaskOutputArtifactAtPath(pathname: string): TaskOutput | null {
  try {
    const raw = fs.readFileSync(pathname, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseTaskOutputArtifact(parsed);
  } catch {
    return null;
  }
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

function ensureArtifactDir(pathname: string) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function writeTaskOutputArtifact(task: TaskOutput) {
  const outputPath = task.output_path?.trim();
  if (!outputPath) {
    return;
  }
  const normalizedTask = assertTaskOutputArtifact(task);
  ensureArtifactDir(outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(normalizedTask, null, 2)}\n`, "utf8");
  fs.chmodSync(outputPath, 0o600);
}

export function readTaskOutputArtifact(taskId: string, env: NodeJS.ProcessEnv = process.env) {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return null;
  }
  const artifactsDir = resolveTaskArtifactsDir(env);
  const sanitizedTaskId = sanitizeTaskFilePart(trimmedTaskId);
  const candidatePaths = [
    resolveTaskOutputPath({ taskId: trimmedTaskId, taskType: "shell", env }),
    resolveTaskOutputPath({ taskId: trimmedTaskId, taskType: "agent", env }),
    resolveTaskOutputPath({ taskId: trimmedTaskId, taskType: "remote_agent", env }),
  ];

  for (const candidatePath of candidatePaths) {
    const artifact = readTaskOutputArtifactAtPath(candidatePath);
    if (artifact?.task_id === trimmedTaskId) {
      return artifact;
    }
  }

  let fileNames: string[] = [];
  try {
    fileNames = fs.readdirSync(artifactsDir);
  } catch {
    return null;
  }
  const suffix = `-${sanitizedTaskId}.json`;
  for (const fileName of fileNames) {
    if (!fileName.endsWith(suffix)) {
      continue;
    }
    const artifact = readTaskOutputArtifactAtPath(path.join(artifactsDir, fileName));
    if (artifact?.task_id === trimmedTaskId) {
      return artifact;
    }
  }
  return null;
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
    return;
  }
  if (fs.existsSync(transcriptPath)) {
    return;
  }
  ensureArtifactDir(transcriptPath);
  const header = assertTaskTranscriptEntry(params.header);
  fs.writeFileSync(transcriptPath, `${JSON.stringify(header)}\n`, "utf8");
  fs.chmodSync(transcriptPath, 0o600);
}

export function appendTaskTranscriptArtifact(params: {
  transcriptPath?: string;
  event: Record<string, unknown>;
}) {
  const transcriptPath = params.transcriptPath?.trim();
  if (!transcriptPath) {
    return;
  }
  ensureArtifactDir(transcriptPath);
  const event = assertTaskTranscriptEntry(params.event);
  fs.appendFileSync(transcriptPath, `${JSON.stringify(event)}\n`, "utf8");
}

export function readTaskOutputFromTranscript(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): TaskOutput | null {
  const trimmedTaskId = taskId.trim();
  if (!trimmedTaskId) {
    return null;
  }

  const taskTypes = ["shell", "agent", "remote_agent"];
  for (const taskType of taskTypes) {
    const transcriptPath = resolveTaskTranscriptPath({ taskId: trimmedTaskId, taskType, env });
    if (!fs.existsSync(transcriptPath)) {
      continue;
    }
    const replayed = replayTaskTranscriptFromFile({
      transcriptPath,
      outputPath: resolveTaskOutputPath({ taskId: trimmedTaskId, taskType, env }),
    });
    if (replayed.task?.task_id === trimmedTaskId) {
      return replayed.task;
    }
  }

  return null;
}
