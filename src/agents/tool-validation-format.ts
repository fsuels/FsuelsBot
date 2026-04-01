import type { ErrorObject } from "ajv";

export type ToolValidationIssue = {
  path: string;
  message: string;
  keyword?: string;
};

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function splitJsonPointer(path: string): string[] {
  if (!path || path === "/") {
    return [];
  }
  return path
    .split("/")
    .slice(1)
    .map((segment) => decodeJsonPointerSegment(segment))
    .filter((segment) => segment.length > 0);
}

function isArrayIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

function formatPathSegments(segments: string[]): string {
  if (segments.length === 0) {
    return "root";
  }
  let path = "";
  for (const segment of segments) {
    if (isArrayIndex(segment)) {
      path += `[${segment}]`;
      continue;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      path += path ? `.${segment}` : segment;
      continue;
    }
    const escaped = JSON.stringify(segment);
    path += path ? `[${escaped}]` : escaped;
  }
  return path || "root";
}

function extractParamString(
  params: ErrorObject["params"],
  key: "missingProperty" | "additionalProperty" | "type",
): string | undefined {
  if (!params || typeof params !== "object" || !(key in params)) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatExpectedType(type: string | undefined): string {
  return type && type.trim() ? type.trim() : "the expected type";
}

export function normalizeValidationPath(path: string | undefined): string {
  const trimmed = path?.trim();
  if (!trimmed) {
    return "root";
  }
  if (trimmed.startsWith("/")) {
    return formatPathSegments(splitJsonPointer(trimmed));
  }
  return trimmed;
}

export function formatValidationPath(err: ErrorObject): string {
  const segments = splitJsonPointer(err.instancePath ?? "");
  if (err.keyword === "required") {
    const missing = extractParamString(err.params, "missingProperty");
    if (missing) {
      segments.push(missing);
    }
  } else if (err.keyword === "additionalProperties") {
    const extra = extractParamString(err.params, "additionalProperty");
    if (extra) {
      segments.push(extra);
    }
  }
  return formatPathSegments(segments);
}

export function formatValidationMessage(err: ErrorObject): string {
  switch (err.keyword) {
    case "required":
      return "missing required parameter";
    case "additionalProperties":
      return "unexpected parameter";
    case "type":
      return `type mismatch (expected ${formatExpectedType(extractParamString(err.params, "type"))})`;
    default:
      return err.message?.trim() || "invalid value";
  }
}

export function buildValidationIssues(
  errors: ErrorObject[] | null | undefined,
): ToolValidationIssue[] {
  return (errors ?? []).map((err) => ({
    path: formatValidationPath(err),
    message: formatValidationMessage(err),
    keyword: err.keyword,
  }));
}

export function renderValidationIssueText(
  issue: Pick<ToolValidationIssue, "path" | "message">,
): string {
  const path = normalizeValidationPath(issue.path);
  const message = issue.message.trim() || "invalid value";
  return path === "root" ? message : `${path}: ${message}`;
}

export function formatValidationErrorsSummary(
  toolName: string,
  errors: ErrorObject[] | null | undefined,
): string {
  const issues = buildValidationIssues(errors);
  if (issues.length === 0) {
    return `Validation failed for tool "${toolName}".`;
  }
  const details = issues.map((issue) => `- ${renderValidationIssueText(issue)}`).join("\n");
  return `Validation failed for tool "${toolName}":\n${details}`;
}
