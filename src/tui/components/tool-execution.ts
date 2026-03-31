import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { formatToolDetail, resolveToolDisplay } from "../../agents/tool-display.js";
import { formatDurationCompact } from "../../infra/format-time/format-duration.ts";
import { markdownTheme, theme } from "../theme/theme.js";

type ToolResultContent = {
  type?: string;
  text?: string;
  mimeType?: string;
  bytes?: number;
  omitted?: boolean;
};

type ToolResult = {
  content?: ToolResultContent[];
  details?: unknown;
};

export type ToolExecutionTone = "pending" | "success" | "error";

export type ToolExecutionState = {
  tone: ToolExecutionTone;
  titleSuffix?: string;
  statusLabel?: string;
};

type ToolResultStateOptions = {
  isPartial: boolean;
  isError: boolean;
  status?: string;
};

type ToolResultDisplayOptions = {
  statusLabel?: string;
  elapsedMs?: number;
  errorSummary?: string;
};

export type ToolExecutionResultOptions = {
  isError?: boolean;
  status?: string;
  errorSummary?: string;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
};

const PREVIEW_LINES = 12;
const ERROR_STATUSES = new Set([
  "cancelled",
  "canceled",
  "error",
  "failed",
  "timed_out",
  "timeout",
]);
const BACKGROUND_STATUSES = new Set([
  "awaiting_input",
  "backgrounded",
  "pending",
  "queued",
  "running",
]);
const SUCCESS_STATUSES = new Set(["completed", "done", "ok", "success", "succeeded"]);

function normalizeStatus(status?: string): string | undefined {
  const trimmed = status?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.toLowerCase().replace(/[\s-]+/g, "_");
}

function humanizeStatus(status?: string): string | undefined {
  const normalized = normalizeStatus(status);
  if (!normalized) {
    return undefined;
  }
  switch (normalized) {
    case "awaiting_input":
      return "awaiting input";
    case "timed_out":
    case "timeout":
      return "timeout";
    default:
      return normalized.replace(/_/g, " ");
  }
}

function trimMetaText(text?: string, maxChars = 120): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }
  const singleLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!singleLine) {
    return undefined;
  }
  return singleLine.length > maxChars ? `${singleLine.slice(0, maxChars - 1)}…` : singleLine;
}

export function resolveToolExecutionState(opts: ToolResultStateOptions): ToolExecutionState {
  const normalizedStatus = normalizeStatus(opts.status);
  if (opts.isPartial) {
    return { tone: "pending", titleSuffix: "running" };
  }
  if (normalizedStatus && ERROR_STATUSES.has(normalizedStatus)) {
    return {
      tone: "error",
      titleSuffix:
        normalizedStatus === "timeout" || normalizedStatus === "timed_out"
          ? "timed out"
          : normalizedStatus === "canceled" || normalizedStatus === "cancelled"
            ? "cancelled"
            : "failed",
      statusLabel: humanizeStatus(normalizedStatus),
    };
  }
  if (opts.isError) {
    return {
      tone: "error",
      titleSuffix: "failed",
      statusLabel: humanizeStatus(normalizedStatus),
    };
  }
  if (normalizedStatus && BACKGROUND_STATUSES.has(normalizedStatus)) {
    return {
      tone: "pending",
      titleSuffix: "backgrounded",
      statusLabel: humanizeStatus(normalizedStatus),
    };
  }
  if (normalizedStatus && SUCCESS_STATUSES.has(normalizedStatus)) {
    return { tone: "success" };
  }
  return {
    tone: "success",
    statusLabel: humanizeStatus(normalizedStatus),
  };
}

export function formatToolExecutionMeta(opts: ToolResultDisplayOptions): string {
  const parts: string[] = [];
  if (opts.statusLabel) {
    parts.push(opts.statusLabel);
  }
  const elapsed = formatDurationCompact(opts.elapsedMs, { spaced: true });
  if (elapsed) {
    parts.push(elapsed);
  }
  const errorSummary = trimMetaText(opts.errorSummary);
  if (errorSummary) {
    parts.push(errorSummary);
  }
  return parts.join(" · ");
}

function formatArgs(toolName: string, args: unknown): string {
  const display = resolveToolDisplay({ name: toolName, args });
  const detail = formatToolDetail(display);
  if (detail) {
    return detail;
  }
  if (!args || typeof args !== "object") {
    return "";
  }
  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}

function extractText(result?: ToolResult): string {
  if (!result?.content) {
    return formatStructuredDetails(result?.details) ?? "";
  }
  const lines: string[] = [];
  for (const entry of result.content) {
    if (entry.type === "text" && entry.text) {
      lines.push(entry.text);
    } else if (entry.type === "image") {
      const mime = entry.mimeType ?? "image";
      const size = entry.bytes ? ` ${Math.round(entry.bytes / 1024)}kb` : "";
      const omitted = entry.omitted ? " (omitted)" : "";
      lines.push(`[${mime}${size}${omitted}]`);
    }
  }
  const raw = lines.join("\n").trim();
  return formatStructuredDetails(result.details, raw) ?? raw;
}

function formatStructuredDetails(details: unknown, rawText?: string): string | undefined {
  if (details === undefined) {
    return undefined;
  }
  const trimmed = rawText?.trim() ?? "";
  if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    const pretty = JSON.stringify(details, null, 2);
    return typeof pretty === "string" ? pretty : undefined;
  } catch {
    return undefined;
  }
}

export class ToolExecutionComponent extends Container {
  private box: Box;
  private header: Text;
  private argsLine: Text;
  private metaLine: Text;
  private output: Markdown;
  private toolName: string;
  private args: unknown;
  private result?: ToolResult;
  private expanded = false;
  private isError = false;
  private isPartial = true;
  private status?: string;
  private errorSummary?: string;
  private startedAt?: number;
  private completedAt?: number;
  private elapsedMs?: number;

  constructor(toolName: string, args: unknown) {
    super();
    this.toolName = toolName;
    this.args = args;
    this.box = new Box(1, 1, (line) => theme.toolPendingBg(line));
    this.header = new Text("", 0, 0);
    this.argsLine = new Text("", 0, 0);
    this.metaLine = new Text("", 0, 0);
    this.output = new Markdown("", 0, 0, markdownTheme, {
      color: (line) => theme.toolOutput(line),
    });
    this.addChild(new Spacer(1));
    this.addChild(this.box);
    this.box.addChild(this.header);
    this.box.addChild(this.argsLine);
    this.box.addChild(this.metaLine);
    this.box.addChild(this.output);
    this.refresh();
  }

  setArgs(args: unknown) {
    this.args = args;
    this.refresh();
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.refresh();
  }

  setStartedAt(startedAt?: number) {
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) {
      return;
    }
    if (this.startedAt === undefined || startedAt < this.startedAt) {
      this.startedAt = startedAt;
    }
    this.refresh();
  }

  setResult(result: ToolResult | undefined, opts?: ToolExecutionResultOptions) {
    this.result = result;
    this.isPartial = false;
    this.isError = Boolean(opts?.isError);
    this.applyResultOptions(opts);
    this.refresh();
  }

  setPartialResult(result: ToolResult | undefined, opts?: ToolExecutionResultOptions) {
    this.result = result;
    this.isPartial = true;
    this.applyResultOptions(opts);
    this.refresh();
  }

  private applyResultOptions(opts?: ToolExecutionResultOptions) {
    if (!opts) {
      return;
    }
    if (typeof opts.status === "string" && opts.status.trim()) {
      this.status = opts.status.trim();
    }
    if (typeof opts.errorSummary === "string" && opts.errorSummary.trim()) {
      this.errorSummary = opts.errorSummary.trim();
    }
    if (typeof opts.startedAt === "number" && Number.isFinite(opts.startedAt)) {
      this.startedAt = opts.startedAt;
    }
    if (typeof opts.completedAt === "number" && Number.isFinite(opts.completedAt)) {
      this.completedAt = opts.completedAt;
    }
    if (typeof opts.elapsedMs === "number" && Number.isFinite(opts.elapsedMs)) {
      this.elapsedMs = Math.max(0, opts.elapsedMs);
      return;
    }
    if (
      typeof this.startedAt === "number" &&
      typeof this.completedAt === "number" &&
      Number.isFinite(this.startedAt) &&
      Number.isFinite(this.completedAt)
    ) {
      this.elapsedMs = Math.max(0, this.completedAt - this.startedAt);
    }
  }

  private refresh() {
    const state = resolveToolExecutionState({
      isPartial: this.isPartial,
      isError: this.isError,
      status: this.status,
    });
    const bg =
      state.tone === "pending"
        ? theme.toolPendingBg
        : state.tone === "error"
          ? theme.toolErrorBg
          : theme.toolSuccessBg;
    this.box.setBgFn((line) => bg(line));

    const display = resolveToolDisplay({
      name: this.toolName,
      args: this.args,
    });
    const title = `${display.emoji} ${display.label}${state.titleSuffix ? ` (${state.titleSuffix})` : ""}`;
    this.header.setText(theme.toolTitle(theme.bold(title)));

    const argLine = formatArgs(this.toolName, this.args);
    this.argsLine.setText(argLine ? theme.dim(argLine) : theme.dim(" "));
    const meta = formatToolExecutionMeta({
      statusLabel: state.statusLabel,
      elapsedMs: this.elapsedMs,
      errorSummary: this.errorSummary,
    });
    const styledMeta = !meta
      ? ""
      : state.tone === "error"
        ? theme.error(meta)
        : state.tone === "pending"
          ? theme.accentSoft(meta)
          : theme.success(meta);
    this.metaLine.setText(styledMeta);

    const raw = extractText(this.result);
    const text = raw || (this.isPartial ? "…" : "");
    if (!this.expanded && text) {
      const lines = text.split("\n");
      const preview =
        lines.length > PREVIEW_LINES ? `${lines.slice(0, PREVIEW_LINES).join("\n")}\n…` : text;
      this.output.setText(preview);
    } else {
      this.output.setText(text);
    }
  }
}
