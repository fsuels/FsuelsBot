import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { createFindTool, type FindOperations } from "@mariozechner/pi-coding-agent";
import { Static, Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "./tools/common.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import { defineOpenClawTool, toolValidationError, toolValidationOk } from "./tool-contract.js";

const DEFAULT_FIND_LIMIT = 100;
const MAX_FIND_LIMIT = 1_000;

const FindToolInputSchema = Type.Object(
  {
    pattern: Type.String({
      minLength: 1,
      description:
        "Glob pattern for precise filename/path matching, for example '*.ts' or 'src/**/*.test.ts'.",
    }),
    path: Type.Optional(
      Type.String({
        description: "Directory to search. Omit to search from the current workspace root.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        description: `Maximum number of filenames to return (default: ${DEFAULT_FIND_LIMIT}, hard cap: ${MAX_FIND_LIMIT}).`,
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

const FindToolOutputSchema = Type.Object(
  {
    durationMs: Type.Number({ minimum: 0 }),
    returnedCount: Type.Number({ minimum: 0 }),
    filenames: Type.Array(Type.String()),
    truncated: Type.Boolean(),
    totalMatches: Type.Optional(Type.Number({ minimum: 0 })),
  },
  {
    additionalProperties: false,
  },
);

type FindToolInput = Static<typeof FindToolInputSchema>;
type FindToolOutput = Static<typeof FindToolOutputSchema>;

type DirectoryStat = {
  isDirectory: () => boolean;
};

function normalizeSlashPath(value: string) {
  return value.replace(/\\/g, "/");
}

function isBlockedNetworkPath(value: string) {
  return value.startsWith("\\\\") || /^\/\/[^/]/.test(value);
}

function isWithinRoot(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRequestedPath(raw: string | undefined) {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function coerceLimit(limit: number | undefined) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_FIND_LIMIT;
  }
  return Math.max(1, Math.min(MAX_FIND_LIMIT, Math.floor(limit)));
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { name?: unknown; message?: unknown };
  return (
    record.name === "AbortError" ||
    (typeof record.message === "string" && record.message.toLowerCase().includes("abort"))
  );
}

function withTrailingSlash(value: string, trailingSlash: boolean) {
  if (!trailingSlash) {
    return value;
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function isSubsequence(shorter: string, longer: string) {
  let shorterIndex = 0;
  for (const char of longer) {
    if (char === shorter[shorterIndex]) {
      shorterIndex += 1;
      if (shorterIndex >= shorter.length) {
        return true;
      }
    }
  }
  return shorterIndex >= shorter.length;
}

function isCheapFuzzyMatch(target: string, candidate: string) {
  if (!target || !candidate) {
    return false;
  }
  if (target === candidate) {
    return true;
  }
  const lengthDelta = Math.abs(target.length - candidate.length);
  if (lengthDelta > 1) {
    return false;
  }
  const shorter = target.length <= candidate.length ? target : candidate;
  const longer = target.length <= candidate.length ? candidate : target;
  return isSubsequence(shorter, longer);
}

function rebaseFilename(params: { filename: string; searchRoot: string; workspaceRoot: string }) {
  const normalizedFilename = params.filename.trim();
  if (!normalizedFilename) {
    return normalizedFilename;
  }
  const hadTrailingSlash = normalizedFilename.endsWith("/");
  const bare = hadTrailingSlash ? normalizedFilename.slice(0, -1) : normalizedFilename;
  const absolute = path.isAbsolute(bare) ? bare : path.resolve(params.searchRoot, bare);
  if (!isWithinRoot(absolute, params.workspaceRoot)) {
    return withTrailingSlash(normalizeSlashPath(bare), hadTrailingSlash);
  }
  const relative = path.relative(params.workspaceRoot, absolute);
  return withTrailingSlash(normalizeSlashPath(relative || "."), hadTrailingSlash);
}

function parseFindTextOutput(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "No files found matching pattern" || trimmed === "No files found") {
    return [] as string[];
  }
  const noticeStart = trimmed.lastIndexOf("\n\n[");
  const body =
    noticeStart !== -1 && trimmed.endsWith("]") ? trimmed.slice(0, noticeStart).trim() : trimmed;
  if (!body) {
    return [];
  }
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderFindResultText(details: FindToolOutput) {
  if (!Array.isArray(details.filenames) || details.filenames.length === 0) {
    return "No files found";
  }
  let text = details.filenames.join("\n");
  if (details.truncated) {
    text += "\n\n(Results are truncated. Use a more specific path or pattern.)";
  }
  return text;
}

function buildFindResult(details: FindToolOutput): AgentToolResult<FindToolOutput> {
  return {
    content: [
      {
        type: "text",
        text: renderFindResultText(details),
      },
    ],
    details,
  };
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return await promise;
  }
  if (signal.aborted) {
    throw new Error("Search aborted");
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Search aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function suggestPath(params: {
  requestedPath: string;
  resolvedPath: string;
  workspaceRoot: string;
  readdir: (dir: string) => Promise<string[]>;
}) {
  const parent = path.dirname(params.resolvedPath);
  if (!parent || parent === params.resolvedPath) {
    return undefined;
  }
  const missingName = path.basename(params.resolvedPath).trim();
  if (!missingName || missingName === "." || missingName === "..") {
    return undefined;
  }
  try {
    const entries = await params.readdir(parent);
    if (!Array.isArray(entries) || entries.length === 0) {
      return undefined;
    }
    const lowered = missingName.toLowerCase();
    const match =
      entries.find((entry) => entry.toLowerCase() === lowered) ??
      entries.find((entry) => entry.toLowerCase().startsWith(lowered)) ??
      entries.find((entry) => lowered.startsWith(entry.toLowerCase())) ??
      entries.find((entry) => entry.toLowerCase().includes(lowered)) ??
      entries.find((entry) => isCheapFuzzyMatch(lowered, entry.toLowerCase()));
    if (!match) {
      return undefined;
    }
    const suggestionAbsolute = path.join(parent, match);
    if (!isWithinRoot(suggestionAbsolute, params.workspaceRoot)) {
      return undefined;
    }
    return normalizeSlashPath(path.relative(params.workspaceRoot, suggestionAbsolute));
  } catch {
    return undefined;
  }
}

export function createOpenClawFindTool(options?: {
  workspaceRoot?: string;
  sandboxRoot?: string;
  operations?: FindOperations;
  stat?: (absolutePath: string) => Promise<DirectoryStat> | DirectoryStat;
  readdir?: (absolutePath: string) => Promise<string[]>;
  now?: () => number;
  allowNetworkPaths?: boolean;
}): AnyAgentTool {
  const workspaceRoot = path.resolve(options?.workspaceRoot ?? process.cwd());
  const sandboxRoot = options?.sandboxRoot?.trim() ? path.resolve(options.sandboxRoot) : undefined;
  const stat = options?.stat ?? ((absolutePath: string) => fs.stat(absolutePath));
  const readdir = options?.readdir ?? ((absolutePath: string) => fs.readdir(absolutePath));
  const now = options?.now ?? (() => Date.now());
  const allowNetworkPaths = options?.allowNetworkPaths === true;
  const baseTool = createFindTool(
    workspaceRoot,
    options?.operations ? { operations: options.operations } : undefined,
  ) as unknown as AnyAgentTool;
  const resolvedSearchPaths = new Map<string, string>();

  return defineOpenClawTool({
    name: "find",
    label: "find",
    userFacingName: () => "File Search",
    description:
      "Find files by glob pattern for precise filename/path matching. Use this when you already have a specific pattern or subtree. Do not use it for broad exploratory repo analysis that needs multiple search passes.",
    operatorManual: () =>
      "Use `find` for targeted filename/path discovery with a concrete glob pattern. Prefer `grep` for content search, and prefer higher-level planning or shell workflows for broad repo exploration across many passes.",
    parameters: FindToolInputSchema,
    inputSchema: FindToolInputSchema,
    outputSchema: FindToolOutputSchema,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    validateInput: async (input, context) => {
      const requestedPath = normalizeRequestedPath(input.path);
      if (requestedPath === "undefined" || requestedPath === "null") {
        return toolValidationError({
          code: "invalid_input",
          message: 'Invalid path. Omit the field instead of passing "undefined" or "null".',
          details: { reasonCode: "PATH_SENTINEL_STRING" },
        });
      }
      if (requestedPath && !allowNetworkPaths && isBlockedNetworkPath(requestedPath)) {
        return toolValidationError({
          code: "precondition_failed",
          message: "Network paths are blocked for file search.",
          details: { reasonCode: "NETWORK_PATH_BLOCKED" },
        });
      }

      let resolvedSearchPath = workspaceRoot;
      try {
        if (sandboxRoot) {
          const sandboxed = await assertSandboxPath({
            filePath: requestedPath ?? ".",
            cwd: workspaceRoot,
            root: sandboxRoot,
          });
          resolvedSearchPath = sandboxed.resolved;
        } else if (requestedPath) {
          resolvedSearchPath = path.resolve(workspaceRoot, requestedPath);
        }
      } catch {
        return toolValidationError({
          code: "precondition_failed",
          message: "Path is outside the allowed workspace.",
          details: { reasonCode: "PATH_OUTSIDE_WORKSPACE" },
        });
      }

      try {
        const directoryStat = await stat(resolvedSearchPath);
        if (!directoryStat.isDirectory()) {
          return toolValidationError({
            code: "precondition_failed",
            message: "Path is not a directory.",
            details: { reasonCode: "PATH_NOT_DIRECTORY" },
          });
        }
      } catch (error) {
        const record = error as { code?: string };
        if (record?.code === "ENOENT") {
          const suggestion = requestedPath
            ? await suggestPath({
                requestedPath,
                resolvedPath: resolvedSearchPath,
                workspaceRoot,
                readdir,
              })
            : undefined;
          return toolValidationError({
            code: "not_found",
            message: suggestion
              ? `Directory not found. Did you mean "${suggestion}"?`
              : "Directory not found.",
            details: {
              reasonCode: "DIR_NOT_FOUND",
              ...(suggestion ? { suggestion } : {}),
            },
          });
        }
        if (record?.code === "EACCES" || record?.code === "EPERM") {
          return toolValidationError({
            code: "precondition_failed",
            message: "Cannot access directory.",
            details: { reasonCode: "PATH_ACCESS_DENIED" },
          });
        }
        return toolValidationError({
          code: "precondition_failed",
          message: "Error validating search path.",
          details: { reasonCode: "PATH_VALIDATION_FAILED" },
        });
      }

      resolvedSearchPaths.set(context.toolCallId, resolvedSearchPath);
      return toolValidationOk<FindToolInput>({
        params: {
          pattern: input.pattern,
          ...(requestedPath ? { path: requestedPath } : {}),
          limit: coerceLimit(input.limit),
        },
      });
    },
    mapToolResultToText: async (result) => {
      const details = result.details;
      if (!details || typeof details !== "object") {
        return "No files found";
      }
      const shaped = details as FindToolOutput;
      return renderFindResultText(shaped);
    },
    execute: async (toolCallId, input, signal) => {
      const startedAt = now();
      const searchRoot = path.resolve(resolvedSearchPaths.get(toolCallId) ?? workspaceRoot);
      const effectiveLimit = coerceLimit(input.limit);

      try {
        let rawMatches: string[];
        let truncated = false;

        if (options?.operations) {
          const matches = await abortable(
            Promise.resolve(
              options.operations.glob(input.pattern, searchRoot, {
                ignore: ["**/node_modules/**", "**/.git/**"],
                limit: effectiveLimit,
              }),
            ),
            signal,
          );
          rawMatches = matches
            .map((entry) => {
              if (typeof entry !== "string") {
                return "";
              }
              if (path.isAbsolute(entry)) {
                return path.relative(searchRoot, entry);
              }
              return entry;
            })
            .map((entry) => normalizeSlashPath(entry.trim()))
            .filter(Boolean);
          truncated = rawMatches.length >= effectiveLimit;
        } else {
          const baseResult = await baseTool.execute(
            _toolCallId,
            {
              pattern: input.pattern,
              path: searchRoot,
              limit: effectiveLimit,
            },
            signal,
          );
          const text = baseResult.content.find((block) => block.type === "text");
          const rawText = text && "text" in text ? String(text.text ?? "") : "";
          rawMatches = parseFindTextOutput(rawText);
          const baseDetails =
            baseResult.details && typeof baseResult.details === "object"
              ? (baseResult.details as {
                  resultLimitReached?: number;
                  truncation?: unknown;
                })
              : undefined;
          truncated = Boolean(baseDetails?.resultLimitReached || baseDetails?.truncation);
        }

        const filenames = rawMatches.slice(0, effectiveLimit).map((filename) =>
          rebaseFilename({
            filename,
            searchRoot,
            workspaceRoot,
          }),
        );
        const details: FindToolOutput = {
          durationMs: Math.max(0, now() - startedAt),
          returnedCount: filenames.length,
          filenames,
          truncated,
        };
        return buildFindResult(details);
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          throw new Error("Search aborted", { cause: error });
        }
        throw new Error("Error searching files", { cause: error });
      } finally {
        resolvedSearchPaths.delete(toolCallId);
      }
    },
  });
}
