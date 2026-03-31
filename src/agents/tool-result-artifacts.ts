import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { extensionForMime } from "../media/mime.js";

const TOOL_RESULT_ARTIFACT_DIRNAME = "tool-results";

export type PersistedToolResultArtifact = {
  path: string;
  sizeBytes: number;
  sha256: string;
  mimeType?: string;
};

export function resolveToolResultArtifactsDir(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStateDir(env), TOOL_RESULT_ARTIFACT_DIRNAME);
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureArtifactsDir(env: NodeJS.ProcessEnv = process.env) {
  const dir = resolveToolResultArtifactsDir(env);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function inferTextArtifactType(text: string): { ext: string; mimeType: string } {
  const trimmed = text.trimStart().slice(0, 256).toLowerCase();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { ext: ".json", mimeType: "application/json" };
  }
  if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) {
    return { ext: ".html", mimeType: "text/html" };
  }
  if (
    trimmed.startsWith("# ") ||
    trimmed.startsWith("## ") ||
    trimmed.startsWith("```") ||
    trimmed.includes("\n```")
  ) {
    return { ext: ".md", mimeType: "text/markdown" };
  }
  return { ext: ".txt", mimeType: "text/plain" };
}

export async function persistToolResultTextArtifact(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PersistedToolResultArtifact> {
  const dir = await ensureArtifactsDir(env);
  const { ext, mimeType } = inferTextArtifactType(text);
  const targetPath = path.join(dir, `${randomUUID()}${ext}`);
  await fs.writeFile(targetPath, text, { encoding: "utf8", mode: 0o600 });
  return {
    path: targetPath,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    sha256: sha256Hex(text),
    mimeType,
  };
}

export async function persistToolResultBinaryArtifact(
  buffer: Buffer,
  params?: {
    mimeType?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<PersistedToolResultArtifact> {
  const dir = await ensureArtifactsDir(params?.env);
  const ext = extensionForMime(params?.mimeType) ?? ".bin";
  const targetPath = path.join(dir, `${randomUUID()}${ext}`);
  await fs.writeFile(targetPath, buffer, { mode: 0o600 });
  return {
    path: targetPath,
    sizeBytes: buffer.byteLength,
    sha256: sha256Hex(buffer),
    mimeType: params?.mimeType,
  };
}
