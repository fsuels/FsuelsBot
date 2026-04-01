import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeResolvePath } from "../infra/path-resolution.js";
import { resolvePathAgainstBase } from "../infra/path-safety.js";

const HTTP_URL_RE = /^https?:\/\//i;
const DATA_URL_RE = /^data:/i;

export function resolveSandboxPath(params: { filePath: string; cwd: string; root: string }): {
  resolved: string;
  relative: string;
} {
  const resolved = resolvePathAgainstBase(params.filePath, params.cwd);
  const rootResolved = path.resolve(params.root);
  const relative = path.relative(rootResolved, resolved);
  if (!relative || relative === "") {
    return { resolved, relative: "" };
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes sandbox root (${shortPath(rootResolved)}): ${params.filePath}`);
  }
  return { resolved, relative };
}

export async function assertSandboxPath(params: { filePath: string; cwd: string; root: string }) {
  const resolved = resolveSandboxPath(params);
  const normalizedRoot = path.resolve(params.root);
  const [resolvedRoot, resolvedTarget] = await Promise.all([
    safeResolvePath(normalizedRoot),
    safeResolvePath(resolved.resolved),
  ]);
  if (!resolvedRoot.canonical || resolvedRoot.resolutionErrorCode) {
    throw new Error(`Sandbox root is unavailable: ${shortPath(normalizedRoot)}`);
  }
  if (resolvedTarget.resolutionErrorCode) {
    throw new Error(`Path cannot be authorized safely: ${params.filePath}`);
  }
  if (!isWithinRoot(resolvedTarget.effectivePath, resolvedRoot.effectivePath)) {
    throw new Error(
      `Path escapes sandbox root (${shortPath(resolvedRoot.effectivePath)}): ${params.filePath}`,
    );
  }
  const relative = path.relative(resolvedRoot.effectivePath, resolvedTarget.effectivePath);
  return {
    resolved: resolvedTarget.effectivePath,
    relative: relative && relative !== "." ? relative : "",
  };
}

export function assertMediaNotDataUrl(media: string): void {
  const raw = media.trim();
  if (DATA_URL_RE.test(raw)) {
    throw new Error("data: URLs are not supported for media. Use buffer instead.");
  }
}

export async function resolveSandboxedMediaSource(params: {
  media: string;
  sandboxRoot: string;
}): Promise<string> {
  const raw = params.media.trim();
  if (!raw) {
    return raw;
  }
  if (HTTP_URL_RE.test(raw)) {
    return raw;
  }
  let candidate = raw;
  if (/^file:\/\//i.test(candidate)) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      throw new Error(`Invalid file:// URL for sandboxed media: ${raw}`);
    }
  }
  const resolved = await assertSandboxPath({
    filePath: candidate,
    cwd: params.sandboxRoot,
    root: params.sandboxRoot,
  });
  return resolved.resolved;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shortPath(value: string) {
  if (value.startsWith(os.homedir())) {
    return `~${value.slice(os.homedir().length)}`;
  }
  return value;
}
