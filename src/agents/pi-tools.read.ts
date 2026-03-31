import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  createEditTool,
  createReadTool,
  createWriteTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { ToolFailureCode } from "./tool-contract.js";
import { detectMime } from "../media/mime.js";
import {
  assertSafeToolPathInput,
  createFileEditStateTracker,
  fileToolErrorToResult,
  FileToolError,
  resolveFileToolPath,
} from "./file-edit-safety.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import { sanitizeToolResultImages } from "./tool-images.js";
import { createTransactionalEditTool } from "./transactional-edit-tool.js";

type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
};

type FileEditStateTracker = ReturnType<typeof createFileEditStateTracker>;

type FileSafetyOptions = {
  stateTracker?: FileEditStateTracker;
  cwd?: string;
  sandboxRoot?: string;
};

type ReadResultDetails =
  | {
      kind: "text";
      path: string;
      startLine: number;
      endLine: number;
      numLines: number;
      totalLines: number;
      requestedOffset: number;
      requestedLimit?: number;
      truncated: boolean;
      truncatedBy?: "lines" | "bytes";
      nextOffset?: number;
    }
  | {
      kind: "image";
      path: string;
      mimeType: string;
      sizeBytes: number;
    }
  | {
      kind: "empty";
      path: string;
      totalLines: 0;
      requestedOffset: number;
    }
  | {
      kind: "past_eof";
      path: string;
      totalLines: number;
      requestedOffset: number;
      suggestedOffset: number;
    };

type WriteFailureReason =
  | "invalid_input"
  | "invalid_path"
  | "network_path_blocked"
  | "read_required"
  | "partial_read"
  | "stale_write"
  | "permission_denied"
  | "not_found";

type WriteFailurePayload = {
  ok: false;
  success: false;
  tool: "write";
  code: ToolFailureCode;
  error: string;
  message: string;
  path: string;
  normalizedPath?: string;
  reason: WriteFailureReason;
  error_code?: string;
  recommendedAction?: string;
  diff?: string;
  diffOmittedReason?: string;
  firstChangedLine?: number;
  newlinePolicy: typeof WRITE_NEWLINE_POLICY;
};

type WriteSuccessPayload = {
  ok: true;
  success: true;
  tool: "write";
  path: string;
  normalizedPath: string;
  operation: "create" | "update" | "noop";
  linesWritten: number;
  newlinePolicy: typeof WRITE_NEWLINE_POLICY;
  preview?: string;
  previewOverflowLines?: number;
  diff?: string;
  diffOmittedReason?: string;
  firstChangedLine?: number;
};

type PreviewData = {
  lineCount: number;
  preview: string;
  overflowLines: number;
};

type DiffData = {
  diff?: string;
  firstChangedLine?: number;
  omittedReason?: string;
};

const EARLY_BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".class",
  ".db",
  ".doc",
  ".docx",
  ".dmg",
  ".exe",
  ".flac",
  ".gz",
  ".ico",
  ".icns",
  ".iso",
  ".jar",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".odp",
  ".ods",
  ".odt",
  ".ogg",
  ".pdf",
  ".ppt",
  ".pptx",
  ".psd",
  ".rar",
  ".so",
  ".sqlite",
  ".tar",
  ".ttf",
  ".wav",
  ".wasm",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".xz",
  ".zip",
]);

const TEXTUAL_APPLICATION_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/graphql-response+json",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-ndjson",
  "application/x-shellscript",
  "application/xml",
  "application/yaml",
]);

const PREVIEW_LINE_LIMIT = 10;
const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_BYTES = 128 * 1024;
const MAX_DIFF_OUTPUT_LINES = 120;
const WRITE_NEWLINE_POLICY = "preserve_existing_or_input";

export const CLAUDE_PARAM_GROUPS = {
  read: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  write: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  edit: [
    { keys: ["path", "file_path"], label: "path (path or file_path)" },
    {
      keys: ["oldText", "old_string"],
      label: "oldText (oldText or old_string)",
    },
    {
      keys: ["newText", "new_string"],
      allowEmpty: true,
      label: "newText (newText or new_string)",
    },
  ],
} as const;

export function normalizeToolParams(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  const normalized = { ...record };
  if ("file_path" in normalized && !("path" in normalized)) {
    normalized.path = normalized.file_path;
    delete normalized.file_path;
  }
  if ("old_string" in normalized && !("oldText" in normalized)) {
    normalized.oldText = normalized.old_string;
    delete normalized.old_string;
  }
  if ("new_string" in normalized && !("newText" in normalized)) {
    normalized.newText = normalized.new_string;
    delete normalized.new_string;
  }
  if ("replace_all" in normalized && !("replaceAll" in normalized)) {
    normalized.replaceAll = normalized.replace_all;
    delete normalized.replace_all;
  }
  return normalized;
}

export function patchToolSchemaForClaudeCompatibility(tool: AnyAgentTool): AnyAgentTool {
  const schema =
    tool.parameters && typeof tool.parameters === "object"
      ? (tool.parameters as Record<string, unknown>)
      : undefined;

  if (!schema || !schema.properties || typeof schema.properties !== "object") {
    return tool;
  }

  const properties = { ...(schema.properties as Record<string, unknown>) };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  let changed = false;

  const aliasPairs: Array<{ original: string; alias: string }> = [
    { original: "path", alias: "file_path" },
    { original: "oldText", alias: "old_string" },
    { original: "newText", alias: "new_string" },
    { original: "replaceAll", alias: "replace_all" },
  ];

  for (const { original, alias } of aliasPairs) {
    if (!(original in properties)) {
      continue;
    }
    if (!(alias in properties)) {
      properties[alias] = properties[original];
      changed = true;
    }
    const idx = required.indexOf(original);
    if (idx !== -1) {
      required.splice(idx, 1);
      changed = true;
    }
  }

  if (!changed) {
    return tool;
  }

  return {
    ...tool,
    parameters: {
      ...schema,
      properties,
      required,
    },
  };
}

export function assertRequiredParams(
  record: Record<string, unknown> | undefined,
  groups: readonly RequiredParamGroup[],
  toolName: string,
): void {
  if (!record || typeof record !== "object") {
    throw new Error(`Missing parameters for ${toolName}`);
  }

  for (const group of groups) {
    const satisfied = group.keys.some((key) => {
      if (!(key in record)) {
        return false;
      }
      const value = record[key];
      if (typeof value !== "string") {
        return false;
      }
      if (group.allowEmpty) {
        return true;
      }
      return value.trim().length > 0;
    });

    if (!satisfied) {
      const label = group.label ?? group.keys.join(" or ");
      throw new Error(`Missing required parameter: ${label}`);
    }
  }
}

export function wrapToolParamNormalization(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(tool);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      if (requiredParamGroups?.length) {
        assertRequiredParams(record, requiredParamGroups, tool.name);
      }
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}

function wrapToolFileErrors(tool: AnyAgentTool): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      try {
        return await tool.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        if (err instanceof FileToolError) {
          return fileToolErrorToResult(tool.name, err);
        }
        throw err;
      }
    },
  };
}

function wrapSandboxPathGuard(tool: AnyAgentTool, root: string): AnyAgentTool {
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const normalized = normalizeToolParams(args);
      const record =
        normalized ??
        (args && typeof args === "object" ? (args as Record<string, unknown>) : undefined);
      const filePath = record?.path;
      if (typeof filePath === "string" && filePath.trim()) {
        assertSafeToolPathInput(tool.name, filePath);
        await assertSandboxPath({ filePath, cwd: root, root });
      }
      return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
    },
  };
}

function parseReadIntegerParam(
  value: unknown,
  label: "offset" | "limit",
  minimum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new FileToolError({
      errorCode: "invalid_read_range",
      contractCode: "invalid_input",
      message: `read requires ${label} to be an integer >= ${minimum}.`,
      details: { [label]: value },
    });
  }
  if (value < minimum) {
    throw new FileToolError({
      errorCode: "invalid_read_range",
      contractCode: "invalid_input",
      message: `read requires ${label} to be >= ${minimum}.`,
      details: { [label]: value },
    });
  }
  return value;
}

function normalizeTextNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitLogicalLines(text: string): string[] {
  const lines = normalizeTextNewlines(text).split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function isTextualMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXTUAL_APPLICATION_MIME_TYPES.has(mimeType);
}

function shouldRejectByExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return false;
  }
  return EARLY_BINARY_EXTENSIONS.has(ext);
}

function formatLineNumberedText(lines: string[], startLine: number): string {
  if (lines.length === 0) {
    return "";
  }
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, " ")}\t${line}`)
    .join("\n");
}

function buildTextReadResult(params: {
  requestedPath: string;
  resolvedPath: string;
  buffer: Buffer;
  offset?: number;
  limit?: number;
}): AgentToolResult<ReadResultDetails> {
  const requestedOffset = params.offset ?? 1;
  if (params.buffer.byteLength === 0) {
    return {
      content: [
        {
          type: "text",
          text: `[File is empty. Nothing to read from ${params.requestedPath}.]`,
        },
      ],
      details: {
        kind: "empty",
        path: params.resolvedPath,
        totalLines: 0,
        requestedOffset,
      },
    };
  }

  const textContent = normalizeTextNewlines(params.buffer.toString("utf-8"));
  const allLines = textContent.split("\n");
  const totalLines = allLines.length;
  const startIndex = requestedOffset - 1;

  if (startIndex >= totalLines) {
    const suggestedOffset = Math.max(1, totalLines);
    return {
      content: [
        {
          type: "text",
          text:
            `[Offset ${requestedOffset} is beyond end of file (${totalLines} lines total). ` +
            `Use offset <= ${suggestedOffset}.]`,
        },
      ],
      details: {
        kind: "past_eof",
        path: params.resolvedPath,
        totalLines,
        requestedOffset,
        suggestedOffset,
      },
    };
  }

  const sliced =
    params.limit !== undefined
      ? allLines.slice(startIndex, Math.min(startIndex + params.limit, totalLines))
      : allLines.slice(startIndex);
  const truncation = truncateHead(sliced.join("\n"), {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (truncation.firstLineExceedsLimit) {
    const firstLineSize = formatSize(Buffer.byteLength(allLines[startIndex] ?? "", "utf-8"));
    return {
      content: [
        {
          type: "text",
          text:
            `[Line ${requestedOffset} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)}. ` +
            "Use a smaller offset/limit window or inspect the file with exec.]",
        },
      ],
      details: {
        kind: "text",
        path: params.resolvedPath,
        startLine: requestedOffset,
        endLine: requestedOffset - 1,
        numLines: 0,
        totalLines,
        requestedOffset,
        ...(params.limit !== undefined ? { requestedLimit: params.limit } : {}),
        truncated: true,
        truncatedBy: "bytes",
      },
    };
  }

  const outputLines = truncation.content ? truncation.content.split("\n") : [];
  const startLine = requestedOffset;
  const endLine = outputLines.length > 0 ? startLine + outputLines.length - 1 : startLine - 1;
  const nextOffset = endLine + 1;
  const numberedBody = formatLineNumberedText(outputLines, startLine);
  let footer = "";

  if (truncation.truncated) {
    footer =
      truncation.truncatedBy === "lines"
        ? `[Showing lines ${startLine}-${endLine} of ${totalLines}. Use offset=${nextOffset} to continue.]`
        : `[Showing lines ${startLine}-${endLine} of ${totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
  } else if (params.limit !== undefined && startIndex + outputLines.length < totalLines) {
    const remaining = totalLines - (startIndex + outputLines.length);
    footer = `[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  }

  const text =
    numberedBody && footer ? `${numberedBody}\n\n${footer}` : numberedBody || footer || "";

  return {
    content: [{ type: "text", text }],
    details: {
      kind: "text",
      path: params.resolvedPath,
      startLine,
      endLine,
      numLines: outputLines.length,
      totalLines,
      requestedOffset,
      ...(params.limit !== undefined ? { requestedLimit: params.limit } : {}),
      truncated: truncation.truncated,
      ...(truncation.truncatedBy ? { truncatedBy: truncation.truncatedBy } : {}),
      ...(footer ? { nextOffset } : {}),
    },
  };
}

async function buildImageReadResult(params: {
  requestedPath: string;
  resolvedPath: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<AgentToolResult<ReadResultDetails>> {
  return (await sanitizeToolResultImages(
    {
      content: [
        { type: "text", text: `Read image file [${params.mimeType}]` },
        {
          type: "image",
          data: params.buffer.toString("base64"),
          mimeType: params.mimeType,
        },
      ],
      details: {
        kind: "image",
        path: params.resolvedPath,
        mimeType: params.mimeType,
        sizeBytes: params.buffer.byteLength,
      },
    },
    `read:${params.requestedPath}`,
  )) as AgentToolResult<ReadResultDetails>;
}

function rejectUnsupportedReadBinary(params: {
  requestedPath: string;
  resolvedPath: string;
  mimeType?: string;
}): never {
  const ext = path.extname(params.requestedPath).toLowerCase();
  if (params.mimeType === "application/pdf" || ext === ".pdf") {
    throw new FileToolError({
      errorCode: "invalid_file_type",
      contractCode: "invalid_input",
      message:
        "read does not support PDFs in this runtime. Use image/media tooling or convert the needed pages first.",
      details: {
        path: params.resolvedPath,
        ...(params.mimeType ? { mimeType: params.mimeType } : {}),
      },
    });
  }
  throw new FileToolError({
    errorCode: "invalid_file_type",
    contractCode: "invalid_input",
    message:
      `read only supports text files and images here. ` +
      `${params.mimeType ? `This file appears to be ${params.mimeType}. ` : ""}` +
      "Use a more appropriate tool for binary content.",
    details: {
      path: params.resolvedPath,
      ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    },
  });
}

function countLogicalLines(content: string): number {
  if (!content) {
    return 0;
  }
  let newlines = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      newlines += 1;
    }
  }
  return content.endsWith("\n") ? newlines : newlines + 1;
}

function buildPreview(content: string): PreviewData {
  if (!content) {
    return { lineCount: 0, preview: "", overflowLines: 0 };
  }

  const previewLines: string[] = [];
  let lineCount = 0;
  let lineStart = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }
    const end = index > lineStart && content[index - 1] === "\r" ? index - 1 : index;
    lineCount += 1;
    if (previewLines.length < PREVIEW_LINE_LIMIT) {
      previewLines.push(content.slice(lineStart, end));
    }
    lineStart = index + 1;
  }
  if (lineStart < content.length) {
    lineCount += 1;
    if (previewLines.length < PREVIEW_LINE_LIMIT) {
      previewLines.push(content.slice(lineStart));
    }
  }

  return {
    lineCount,
    preview: previewLines.join("\n"),
    overflowLines: Math.max(0, lineCount - previewLines.length),
  };
}

function limitDiffOutputLines(lines: string[]): string[] {
  if (lines.length <= MAX_DIFF_OUTPUT_LINES) {
    return lines;
  }
  const head = Math.floor(MAX_DIFF_OUTPUT_LINES / 2);
  const tail = MAX_DIFF_OUTPUT_LINES - head - 1;
  return [...lines.slice(0, head), " ...", ...lines.slice(-tail)];
}

function buildLineDiff(params: { before?: string; after: string }): DiffData {
  if (typeof params.before !== "string") {
    return {};
  }
  if (
    Buffer.byteLength(params.before, "utf8") > MAX_DIFF_BYTES ||
    Buffer.byteLength(params.after, "utf8") > MAX_DIFF_BYTES
  ) {
    return {
      omittedReason: `file exceeded ${Math.floor(MAX_DIFF_BYTES / 1024)}KB diff cap`,
    };
  }

  const beforeLines = splitLogicalLines(params.before);
  const afterLines = splitLogicalLines(params.after);
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  if (prefix === beforeLines.length && prefix === afterLines.length) {
    return {};
  }

  const output: string[] = [];
  const maxLineNum = Math.max(beforeLines.length, afterLines.length, 1);
  const width = String(maxLineNum).length;
  const prefixStart = Math.max(0, prefix - DIFF_CONTEXT_LINES);

  if (prefixStart > 0) {
    output.push(` ${"".padStart(width, " ")} ...`);
  }
  for (let index = prefixStart; index < prefix; index += 1) {
    output.push(` ${String(index + 1).padStart(width, " ")} ${beforeLines[index]}`);
  }
  for (let index = prefix; index < beforeLines.length - suffix; index += 1) {
    output.push(`-${String(index + 1).padStart(width, " ")} ${beforeLines[index]}`);
  }
  for (let index = prefix; index < afterLines.length - suffix; index += 1) {
    output.push(`+${String(index + 1).padStart(width, " ")} ${afterLines[index]}`);
  }

  const suffixStartAfter = afterLines.length - suffix;
  const shownSuffixLines = Math.min(DIFF_CONTEXT_LINES, suffix);
  for (let offset = 0; offset < shownSuffixLines; offset += 1) {
    const afterIndex = suffixStartAfter + offset;
    output.push(` ${String(afterIndex + 1).padStart(width, " ")} ${afterLines[afterIndex]}`);
  }
  if (suffix > shownSuffixLines) {
    output.push(` ${"".padStart(width, " ")} ...`);
  }

  return {
    diff: limitDiffOutputLines(output).join("\n"),
    firstChangedLine: prefix + 1,
  };
}

function describeWriteTool(baseDescription?: string): string {
  const trimmed = baseDescription?.trim();
  const suffix =
    "Use `write` for new files or deliberate full-file rewrites. Prefer `edit` or `apply_patch` for localized changes. Read existing files first.";
  return trimmed ? `${trimmed} ${suffix}` : suffix;
}

function createWriteFailureResult(params: {
  message: string;
  path: string;
  normalizedPath?: string;
  reason: WriteFailureReason;
  code: ToolFailureCode;
  errorCode?: string;
  recommendedAction?: string;
  diff?: string;
  diffOmittedReason?: string;
  firstChangedLine?: number;
}): AgentToolResult<unknown> {
  const payload: WriteFailurePayload = {
    ok: false,
    success: false,
    tool: "write",
    code: params.code,
    error: params.message,
    message: params.message,
    path: params.path,
    normalizedPath: params.normalizedPath,
    reason: params.reason,
    error_code: params.errorCode,
    recommendedAction: params.recommendedAction,
    diff: params.diff,
    diffOmittedReason: params.diffOmittedReason,
    firstChangedLine: params.firstChangedLine,
    newlinePolicy: WRITE_NEWLINE_POLICY,
  };

  const lines = [params.message];
  if (params.recommendedAction) {
    lines.push(params.recommendedAction);
  }
  if (params.diff) {
    lines.push("", "Current vs attempted content:", params.diff);
  } else if (params.diffOmittedReason) {
    lines.push("", `Current vs attempted content diff omitted: ${params.diffOmittedReason}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    details: payload,
  };
}

function createWriteSuccessResult(params: {
  displayPath: string;
  normalizedPath: string;
  content: string;
  previousContent?: string;
  existedBefore: boolean;
}): AgentToolResult<unknown> {
  const operation =
    params.existedBefore && params.previousContent === params.content
      ? "noop"
      : params.existedBefore
        ? "update"
        : "create";
  const payload: WriteSuccessPayload = {
    ok: true,
    success: true,
    tool: "write",
    path: params.displayPath,
    normalizedPath: params.normalizedPath,
    operation,
    linesWritten: countLogicalLines(params.content),
    newlinePolicy: WRITE_NEWLINE_POLICY,
  };

  let text = "";
  if (operation === "create") {
    const preview = buildPreview(params.content);
    payload.preview = preview.preview;
    payload.previewOverflowLines = preview.overflowLines;
    text = `Created ${params.displayPath} (${preview.lineCount} lines)`;
    if (preview.preview) {
      text += `\n${preview.preview}`;
    }
    if (preview.overflowLines > 0) {
      text += `\n+${preview.overflowLines} more lines`;
    }
  } else if (operation === "update") {
    const diff = buildLineDiff({
      before: params.previousContent,
      after: params.content,
    });
    payload.diff = diff.diff;
    payload.diffOmittedReason = diff.omittedReason;
    payload.firstChangedLine = diff.firstChangedLine;
    text = `Updated ${params.displayPath}`;
    if (diff.diff) {
      text += `\n${diff.diff}`;
    } else if (diff.omittedReason) {
      text += `\n[Diff omitted: ${diff.omittedReason}]`;
    }
  } else {
    text = `No content changes for ${params.displayPath}`;
  }

  return {
    content: [{ type: "text", text }],
    details: payload,
  };
}

async function buildWriteFailureFromError(params: {
  err: FileToolError;
  displayPath: string;
  normalizedPath?: string;
  attemptedContent?: string;
}): Promise<AgentToolResult<unknown>> {
  let reason: WriteFailureReason = "invalid_input";
  let recommendedAction: string | undefined;

  switch (params.err.errorCode) {
    case "file_not_read":
      reason = "read_required";
      recommendedAction = "Read the current file first, then recompute the full rewrite.";
      break;
    case "partial_read_only":
      reason = "partial_read";
      recommendedAction = "Read the full file without offset/limit before using write.";
      break;
    case "file_changed_since_read":
      reason = "stale_write";
      recommendedAction =
        "Re-read the file and recompute the full rewrite instead of retrying stale content.";
      break;
    case "network_path_blocked":
      reason = "network_path_blocked";
      recommendedAction = "Use a local workspace path instead.";
      break;
    case "permission_denied":
      reason = "permission_denied";
      recommendedAction = "Choose a writable file path or adjust permissions first.";
      break;
    case "file_missing":
      reason = "not_found";
      break;
    default:
      reason = "invalid_path";
      break;
  }

  let diff: string | undefined;
  let diffOmittedReason: string | undefined;
  let firstChangedLine: number | undefined;
  if (params.normalizedPath && typeof params.attemptedContent === "string") {
    try {
      const currentContent = await fsReadFile(params.normalizedPath, "utf8");
      const diffResult = buildLineDiff({
        before: currentContent,
        after: params.attemptedContent,
      });
      diff = diffResult.diff;
      diffOmittedReason = diffResult.omittedReason;
      firstChangedLine = diffResult.firstChangedLine;
    } catch {
      // Best-effort diff only.
    }
  }

  return createWriteFailureResult({
    message: params.err.message,
    path: params.displayPath,
    normalizedPath: params.normalizedPath,
    reason,
    code: params.err.contractCode,
    errorCode: params.err.errorCode,
    recommendedAction,
    diff,
    diffOmittedReason,
    firstChangedLine,
  });
}

export function createWorkspaceReadTool(root: string, options: FileSafetyOptions = {}) {
  const base = createReadTool(root) as unknown as AnyAgentTool;
  return createOpenClawReadTool(base, {
    ...options,
    cwd: options.cwd ?? root,
    sandboxRoot: options.sandboxRoot,
  });
}

export function createSandboxedReadTool(root: string, options: FileSafetyOptions = {}) {
  return wrapSandboxPathGuard(
    createWorkspaceReadTool(root, {
      ...options,
      cwd: options.cwd ?? root,
      sandboxRoot: options.sandboxRoot ?? root,
    }),
    root,
  );
}

export function createWorkspaceWriteTool(root: string, options: FileSafetyOptions = {}) {
  const base = createWriteTool(root, {
    operations: createSafeWriteOperations("write", options.stateTracker),
  }) as unknown as AnyAgentTool;
  return createOpenClawWriteTool(base, {
    ...options,
    cwd: options.cwd ?? root,
    sandboxRoot: options.sandboxRoot,
  });
}

export function createSandboxedWriteTool(root: string, options: FileSafetyOptions = {}) {
  return wrapSandboxPathGuard(
    createWorkspaceWriteTool(root, {
      ...options,
      cwd: options.cwd ?? root,
      sandboxRoot: options.sandboxRoot ?? root,
    }),
    root,
  );
}

export function createWorkspaceEditTool(root: string, options: FileSafetyOptions = {}) {
  const base = options.stateTracker
    ? createTransactionalEditTool(root, {
        stateTracker: options.stateTracker,
        cwd: options.cwd ?? root,
        sandboxRoot: options.sandboxRoot,
      })
    : (createEditTool(root) as unknown as AnyAgentTool);
  return createOpenClawEditTool(base, {
    ...options,
    cwd: options.cwd ?? root,
    sandboxRoot: options.sandboxRoot,
  });
}

export function createSandboxedEditTool(root: string, options: FileSafetyOptions = {}) {
  return wrapSandboxPathGuard(
    createWorkspaceEditTool(root, {
      ...options,
      cwd: options.cwd ?? root,
      sandboxRoot: options.sandboxRoot ?? root,
    }),
    root,
  );
}

export function createOpenClawReadTool(
  base: AnyAgentTool,
  options: FileSafetyOptions = {},
): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return wrapToolFileErrors({
    ...patched,
    description: `Read a file from the workspace. Text results are line-numbered and bounded to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}, whichever is smaller. Use offset/limit for targeted reads. Images are returned as attachments. Relative paths resolve against the workspace.`,
    isReadOnly: () => true,
    execute: async (toolCallId, params, signal) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.read, base.name);
      const requestedPath = typeof record?.path === "string" ? String(record.path) : "";
      assertSafeToolPathInput(base.name, requestedPath);
      const offset = parseReadIntegerParam(record?.offset, "offset", 1);
      const limit = parseReadIntegerParam(record?.limit, "limit", 1);
      const resolvedPath = await resolveFileToolPath({
        filePath: requestedPath,
        cwd: options.cwd ?? process.cwd(),
        sandboxRoot: options.sandboxRoot,
        readMode: true,
      });

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const buffer = await fsReadFile(resolvedPath);
      const sniffedMime = await detectMime({
        buffer: buffer.subarray(0, Math.min(buffer.byteLength, 4096)),
        filePath: resolvedPath,
      });

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      if (sniffedMime?.startsWith("image/")) {
        if (options.stateTracker) {
          await options.stateTracker.recordRead({
            filePath: requestedPath,
            cwd: options.cwd ?? process.cwd(),
            sandboxRoot: options.sandboxRoot,
            result: {
              content: [{ type: "image", data: "", mimeType: sniffedMime }],
              details: {},
            },
            offset: offset ?? 1,
            limit,
          });
        }
        return await buildImageReadResult({
          requestedPath,
          resolvedPath,
          buffer,
          mimeType: sniffedMime,
        });
      }

      if (
        (sniffedMime && !isTextualMime(sniffedMime)) ||
        (!sniffedMime && shouldRejectByExtension(requestedPath))
      ) {
        rejectUnsupportedReadBinary({
          requestedPath,
          resolvedPath,
          mimeType: sniffedMime,
        });
      }

      const result = buildTextReadResult({
        requestedPath,
        resolvedPath,
        buffer,
        offset,
        limit,
      });
      if (options.stateTracker) {
        await options.stateTracker.recordRead({
          filePath: requestedPath,
          cwd: options.cwd ?? process.cwd(),
          sandboxRoot: options.sandboxRoot,
          result,
          offset: offset ?? 1,
          limit,
        });
      }
      return result;
    },
  });
}

export function createOpenClawWriteTool(
  base: AnyAgentTool,
  options: FileSafetyOptions = {},
): AnyAgentTool {
  const normalized = wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.write);
  return {
    ...normalized,
    description: describeWriteTool(normalized.description),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalizedParams = normalizeToolParams(params);
      const record =
        normalizedParams ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);

      try {
        assertRequiredParams(record, CLAUDE_PARAM_GROUPS.write, base.name);
      } catch (error) {
        return createWriteFailureResult({
          message: error instanceof Error ? error.message : String(error),
          path: typeof record?.path === "string" ? record.path : "<unknown>",
          reason: "invalid_input",
          code: "invalid_input",
        });
      }

      if (typeof record?.path !== "string" || typeof record?.content !== "string") {
        return createWriteFailureResult({
          message: "Missing required write parameters.",
          path: typeof record?.path === "string" ? record.path : "<unknown>",
          reason: "invalid_input",
          code: "invalid_input",
        });
      }

      const displayPath = record.path;
      try {
        assertSafeToolPathInput(base.name, displayPath);
      } catch (error) {
        if (error instanceof FileToolError) {
          return await buildWriteFailureFromError({
            err: error,
            displayPath,
          });
        }
        throw error;
      }

      if (!options.stateTracker) {
        try {
          return await normalized.execute(toolCallId, normalizedParams ?? params, signal, onUpdate);
        } catch (error) {
          if (error instanceof FileToolError) {
            return await buildWriteFailureFromError({
              err: error,
              displayPath,
            });
          }
          throw error;
        }
      }

      let resolvedPath: string;
      try {
        resolvedPath = await resolveFileToolPath({
          filePath: displayPath,
          cwd: options.cwd ?? process.cwd(),
          sandboxRoot: options.sandboxRoot,
        });
      } catch (error) {
        if (error instanceof FileToolError) {
          return await buildWriteFailureFromError({
            err: error,
            displayPath,
          });
        }
        throw error;
      }

      try {
        await options.stateTracker.ensureExistingFileIsFresh("write", resolvedPath);
      } catch (error) {
        if (error instanceof FileToolError) {
          return await buildWriteFailureFromError({
            err: error,
            displayPath,
            normalizedPath: resolvedPath,
            attemptedContent: record.content,
          });
        }
        throw error;
      }

      await fsMkdir(path.dirname(resolvedPath), { recursive: true });
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      try {
        const writeResult = await options.stateTracker.writeTextDetailed(
          "write",
          resolvedPath,
          record.content,
          { allowCreate: true },
        );
        return createWriteSuccessResult({
          displayPath,
          normalizedPath: writeResult.resolvedPath,
          content: record.content,
          previousContent: writeResult.previousContent,
          existedBefore: writeResult.existedBefore,
        });
      } catch (error) {
        if (error instanceof FileToolError) {
          return await buildWriteFailureFromError({
            err: error,
            displayPath,
            normalizedPath: resolvedPath,
            attemptedContent: record.content,
          });
        }
        throw error;
      }
    },
  };
}

export function createOpenClawEditTool(
  base: AnyAgentTool,
  _options: FileSafetyOptions = {},
): AnyAgentTool {
  const normalized = wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.edit);
  return wrapToolFileErrors({
    ...normalized,
    description:
      "Edit a file by replacing exact text. Read the file first in the current run. The edit is rejected if the file changed since that read.",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalizedParams = normalizeToolParams(params);
      const record =
        normalizedParams ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      if (typeof record?.path === "string") {
        assertSafeToolPathInput(base.name, record.path);
      }
      return await normalized.execute(toolCallId, normalizedParams ?? params, signal, onUpdate);
    },
  });
}

function createSafeWriteOperations(toolName: string, stateTracker?: FileEditStateTracker) {
  return {
    writeFile: async (filePath: string, content: string) => {
      if (!stateTracker) {
        await fsWriteFile(filePath, content, "utf-8");
        return;
      }
      await stateTracker.writeText(toolName, filePath, content, { allowCreate: true });
    },
    mkdir: (dir: string) => fsMkdir(dir, { recursive: true }).then(() => {}),
  };
}
