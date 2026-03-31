import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "./pi-tools.types.js";
import {
  createFileEditStateTracker,
  FileToolError,
  resolveFileToolPath,
} from "./file-edit-safety.js";
import { assertTextEditRangeIsSafe } from "./text-edit-guards.js";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const CONTEXT_LINES = 2;
const MAX_CONTEXT_LINES = 8;
const MAX_CONTEXT_BYTES = 1200;

export type TransactionalEditToolOptions = {
  stateTracker: ReturnType<typeof createFileEditStateTracker>;
  cwd?: string;
  sandboxRoot?: string;
};

const transactionalEditSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace" }),
  newText: Type.String({ description: "Replacement text. Can be empty to delete the match." }),
  replaceAll: Type.Optional(
    Type.Boolean({
      description:
        "Replace every exact occurrence. Use this only for intentional multi-occurrence edits like renames.",
    }),
  ),
});

type DiffPreview = {
  diff: string;
  firstChangedLine: number;
};

type NormalizedFuzzyProjection = {
  normalized: string;
  boundaryMap: number[];
};

function normalizeUnicodeSpaces(value: string): string {
  return value.replace(UNICODE_SPACES, " ");
}

function expandPath(filePath: string): string {
  const normalized = normalizeUnicodeSpaces(filePath.trim());
  if (normalized === "~") {
    return os.homedir();
  }
  if (normalized.startsWith("~/")) {
    return os.homedir() + normalized.slice(1);
  }
  return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

function resolveToCwd(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(cwd, expanded);
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeForFuzzyMatch(text: string): string {
  return normalizeToLF(text)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function normalizeFuzzyChar(char: string): string {
  switch (char) {
    case "\u2018":
    case "\u2019":
    case "\u201A":
    case "\u201B":
      return "'";
    case "\u201C":
    case "\u201D":
    case "\u201E":
    case "\u201F":
      return '"';
    case "\u2010":
    case "\u2011":
    case "\u2012":
    case "\u2013":
    case "\u2014":
    case "\u2015":
    case "\u2212":
      return "-";
    case "\u00A0":
    case "\u2002":
    case "\u2003":
    case "\u2004":
    case "\u2005":
    case "\u2006":
    case "\u2007":
    case "\u2008":
    case "\u2009":
    case "\u200A":
    case "\u202F":
    case "\u205F":
    case "\u3000":
      return " ";
    default:
      return char;
  }
}

function projectFuzzyText(text: string): NormalizedFuzzyProjection {
  const normalizedText = normalizeToLF(text);
  const lines = normalizedText.split("\n");
  const boundaryMap: number[] = [0];
  let normalized = "";
  let originalOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const trimmedLine = line.trimEnd();
    for (let charIndex = 0; charIndex < trimmedLine.length; charIndex += 1) {
      normalized += normalizeFuzzyChar(trimmedLine[charIndex] ?? "");
      boundaryMap.push(originalOffset + charIndex + 1);
    }
    if (lineIndex < lines.length - 1) {
      normalized += "\n";
      boundaryMap.push(originalOffset + line.length + 1);
    }
    originalOffset += line.length + 1;
  }

  return { normalized, boundaryMap };
}

function findAllLiteralIndices(haystack: string, needle: string): number[] {
  if (!needle) {
    return [];
  }
  const indices: number[] = [];
  let searchFrom = 0;
  while (searchFrom <= haystack.length - needle.length) {
    const nextIndex = haystack.indexOf(needle, searchFrom);
    if (nextIndex === -1) {
      break;
    }
    indices.push(nextIndex);
    searchFrom = nextIndex + needle.length;
  }
  return indices;
}

function replaceAt(text: string, index: number, matchLength: number, replacement: string): string {
  return text.slice(0, index) + replacement + text.slice(index + matchLength);
}

function replaceAllExact(text: string, needle: string, replacement: string): string {
  if (!needle) {
    return text;
  }
  return findAllLiteralIndices(text, needle).reduceRight(
    (current, index) => replaceAt(current, index, needle.length, replacement),
    text,
  );
}

function lineForIndex(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function numberedContext(text: string, index: number): string | undefined {
  if (index < 0) {
    return undefined;
  }
  const lines = text.split("\n");
  const targetLine = Math.max(1, lineForIndex(text, index));
  const startLine = Math.max(1, targetLine - CONTEXT_LINES);
  const endLine = Math.min(lines.length, targetLine + CONTEXT_LINES);
  const selected: string[] = [];
  if (startLine > 1) {
    selected.push("...");
  }
  for (let line = startLine; line <= endLine; line += 1) {
    selected.push(`${line} | ${lines[line - 1] ?? ""}`);
    if (
      selected.length >= MAX_CONTEXT_LINES ||
      Buffer.byteLength(selected.join("\n"), "utf8") >= MAX_CONTEXT_BYTES
    ) {
      break;
    }
  }
  if (endLine < lines.length) {
    selected.push("...");
  }
  return selected.join("\n");
}

function findRelevantIndex(content: string, oldText: string): number {
  const candidates = normalizeForFuzzyMatch(oldText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .toSorted((left, right) => right.length - left.length);
  const normalizedContent = normalizeForFuzzyMatch(content);
  for (const candidate of candidates) {
    const index = normalizedContent.indexOf(candidate);
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

function buildRequestedDiffPreview(oldText: string, newText: string): string {
  const oldLines = normalizeToLF(oldText).split("\n");
  const newLines = normalizeToLF(newText).split("\n");
  return [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)].join("\n");
}

function buildSyntheticDiffPreview(params: {
  content: string;
  index: number;
  matchLength: number;
  oldText: string;
  newText: string;
}): DiffPreview {
  const content = normalizeToLF(params.content);
  const firstChangedLine = lineForIndex(content, params.index);
  const beforeContext = content.slice(0, params.index).split("\n").slice(-CONTEXT_LINES);
  const afterContext = content
    .slice(params.index + params.matchLength)
    .split("\n")
    .slice(0, CONTEXT_LINES);
  const oldLines = normalizeToLF(params.oldText).split("\n");
  const newLines = normalizeToLF(params.newText).split("\n");
  const width = String(
    firstChangedLine + Math.max(oldLines.length, newLines.length) + CONTEXT_LINES,
  ).length;
  const lines: string[] = [];

  for (let index = 0; index < beforeContext.length; index += 1) {
    const lineNumber = String(firstChangedLine - beforeContext.length + index).padStart(width, " ");
    lines.push(` ${lineNumber} ${beforeContext[index] ?? ""}`);
  }

  for (let index = 0; index < oldLines.length; index += 1) {
    const lineNumber = String(firstChangedLine + index).padStart(width, " ");
    lines.push(`-${lineNumber} ${oldLines[index] ?? ""}`);
  }

  for (let index = 0; index < newLines.length; index += 1) {
    const lineNumber = String(firstChangedLine + index).padStart(width, " ");
    lines.push(`+${lineNumber} ${newLines[index] ?? ""}`);
  }

  for (let index = 0; index < afterContext.length; index += 1) {
    const lineNumber = String(firstChangedLine + oldLines.length + index).padStart(width, " ");
    lines.push(` ${lineNumber} ${afterContext[index] ?? ""}`);
  }

  return {
    diff: lines.join("\n"),
    firstChangedLine,
  };
}

function throwEditFailure(params: {
  code:
    | "invalid_edit_request"
    | "string_not_found"
    | "multiple_matches"
    | "file_changed_since_read";
  message: string;
  path: string;
  contractCode?: "invalid_input" | "precondition_failed";
  matchCount?: number;
  context?: string;
  diffPreview?: string;
  firstChangedLine?: number;
  recommendedAction?: string;
  replaceAll?: boolean;
}) {
  throw new FileToolError({
    errorCode: params.code,
    contractCode: params.contractCode,
    message: params.message,
    details: {
      path: params.path,
      ...(typeof params.matchCount === "number" ? { match_count: params.matchCount } : {}),
      ...(params.context ? { context: params.context } : {}),
      ...(params.diffPreview ? { diff_preview: params.diffPreview } : {}),
      ...(typeof params.firstChangedLine === "number"
        ? { first_changed_line: params.firstChangedLine }
        : {}),
      ...(params.recommendedAction ? { recommended_action: params.recommendedAction } : {}),
      ...(typeof params.replaceAll === "boolean" ? { replace_all: params.replaceAll } : {}),
    },
  });
}

function buildEditOperatorManual(): string {
  return [
    "Read the file before editing, and re-read if the tool reports the file changed since your last read.",
    "Use the smallest clearly unique oldText you can, usually 2-4 adjacent lines. Do not include line-number prefixes from prior reads.",
    "Preserve exact indentation and spacing from the file.",
    "Use replaceAll only for intentional multi-occurrence edits such as renames or repeated literals.",
    "If you get multiple_matches, retry once with slightly more surrounding context instead of pasting a huge block.",
    "If you get string_not_found, use the returned local context to repair the match instead of retrying the same payload.",
  ].join(" ");
}

export function createTransactionalEditTool(
  root: string,
  options: TransactionalEditToolOptions,
): AnyAgentTool {
  return {
    name: "edit",
    label: "edit",
    description:
      "Edit a file by replacing exact text. Read the file first in the current run. The edit is rejected if the file changed since that read.",
    operatorManual: buildEditOperatorManual,
    parameters: transactionalEditSchema,
    execute: async (_toolCallId, args) => {
      const input = args as {
        path: string;
        oldText: string;
        newText: string;
        replaceAll?: boolean;
      };
      const absolutePath = resolveToCwd(input.path, options.cwd ?? root);
      const readBuffer = await options.stateTracker.readBufferForEdit("edit", absolutePath);
      const baseContent = readBuffer.toString("utf8");
      const normalizedContent = normalizeToLF(baseContent);
      const normalizedOldText = normalizeToLF(input.oldText);
      const normalizedNewText = normalizeToLF(input.newText);
      const replaceAll = input.replaceAll === true;

      if (!normalizedOldText) {
        throwEditFailure({
          code: "invalid_edit_request",
          contractCode: "invalid_input",
          message: "Edit rejected: oldText must be non-empty. Use write for new files.",
          path: input.path,
          replaceAll,
        });
      }

      if (normalizedOldText === normalizedNewText) {
        throwEditFailure({
          code: "invalid_edit_request",
          contractCode: "invalid_input",
          message: "Edit rejected: oldText and newText are identical.",
          path: input.path,
          replaceAll,
        });
      }

      const exactIndices = findAllLiteralIndices(normalizedContent, normalizedOldText);
      const exactMatchCount = exactIndices.length;
      if (exactMatchCount > 1 && !replaceAll) {
        const preview = buildSyntheticDiffPreview({
          content: normalizedContent,
          index: exactIndices[0] ?? 0,
          matchLength: normalizedOldText.length,
          oldText: normalizedOldText,
          newText: normalizedNewText,
        });
        throwEditFailure({
          code: "multiple_matches",
          message: `Edit rejected: found ${exactMatchCount} matches. Add a little more surrounding context or set replaceAll when the multi-edit is intentional.`,
          path: input.path,
          matchCount: exactMatchCount,
          context: numberedContext(normalizedContent, exactIndices[0] ?? 0),
          diffPreview: preview.diff,
          firstChangedLine: preview.firstChangedLine,
          recommendedAction:
            "Retry once with a slightly larger unique oldText, or use replaceAll only if every match should change.",
          replaceAll,
        });
      }

      let contentForWrite = normalizedContent;
      let matchIndex = exactIndices[0] ?? -1;
      let matchLength = normalizedOldText.length;
      let replacements = exactMatchCount;
      let usedFuzzyMatch = false;

      if (exactMatchCount > 0) {
        for (const exactIndex of replaceAll ? exactIndices : [matchIndex]) {
          assertTextEditRangeIsSafe({
            toolName: "edit",
            filePath: input.path,
            text: normalizedContent,
            start: exactIndex,
            end: exactIndex + normalizedOldText.length,
          });
        }
        contentForWrite = replaceAll
          ? replaceAllExact(normalizedContent, normalizedOldText, normalizedNewText)
          : replaceAt(normalizedContent, matchIndex, normalizedOldText.length, normalizedNewText);
      } else {
        const fuzzyProjection = projectFuzzyText(normalizedContent);
        const fuzzyContent = fuzzyProjection.normalized;
        const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
        const fuzzyIndices = findAllLiteralIndices(fuzzyContent, fuzzyOldText);
        const fuzzyMatchCount = fuzzyIndices.length;

        if (fuzzyMatchCount === 0) {
          const relevantIndex = findRelevantIndex(normalizedContent, normalizedOldText);
          throwEditFailure({
            code: "string_not_found",
            message: "Edit rejected: oldText was not found in the current file snapshot.",
            path: input.path,
            context:
              relevantIndex >= 0 ? numberedContext(normalizedContent, relevantIndex) : undefined,
            diffPreview: buildRequestedDiffPreview(normalizedOldText, normalizedNewText),
            recommendedAction:
              "Use the returned context to repair the match, or re-read the file if it may have changed.",
            replaceAll,
          });
        }

        if (fuzzyMatchCount > 1 || replaceAll) {
          const preview = buildRequestedDiffPreview(normalizedOldText, normalizedNewText);
          throwEditFailure({
            code: "multiple_matches",
            message:
              "Edit rejected: the exact text was not unique, and replaceAll only supports intentional exact multi-match edits.",
            path: input.path,
            matchCount: fuzzyMatchCount,
            context: numberedContext(fuzzyContent, fuzzyIndices[0] ?? 0),
            diffPreview: preview,
            recommendedAction:
              "Re-read the file and retry with an exact unique oldText. Do not use replaceAll unless the exact text repeats intentionally.",
            replaceAll,
          });
        }

        usedFuzzyMatch = true;
        const fuzzyMatchIndex = fuzzyIndices[0] ?? -1;
        const originalStart = fuzzyProjection.boundaryMap[fuzzyMatchIndex] ?? -1;
        const originalEnd =
          fuzzyProjection.boundaryMap[fuzzyMatchIndex + fuzzyOldText.length] ??
          normalizedContent.length;
        matchIndex = originalStart;
        matchLength = Math.max(0, originalEnd - originalStart);
        replacements = 1;
        assertTextEditRangeIsSafe({
          toolName: "edit",
          filePath: input.path,
          text: normalizedContent,
          start: matchIndex,
          end: matchIndex + matchLength,
        });
        contentForWrite = replaceAt(normalizedContent, matchIndex, matchLength, normalizedNewText);
      }

      if (contentForWrite === normalizedContent) {
        throwEditFailure({
          code: "invalid_edit_request",
          contractCode: "invalid_input",
          message: "Edit rejected: the replacement would not change the file.",
          path: input.path,
          replaceAll,
        });
      }

      const previewOldText = usedFuzzyMatch
        ? normalizedContent.slice(matchIndex, matchIndex + matchLength)
        : normalizedOldText;
      const preview = buildSyntheticDiffPreview({
        content: normalizedContent,
        index: matchIndex,
        matchLength,
        oldText: previewOldText,
        newText: normalizedNewText,
      });

      try {
        const writeResult = await options.stateTracker.writeTextDetailed(
          "edit",
          absolutePath,
          contentForWrite,
          {
            allowCreate: false,
          },
        );
        const normalizedPath = await resolveFileToolPath({
          filePath: absolutePath,
          cwd: options.cwd ?? root,
          sandboxRoot: options.sandboxRoot,
          readMode: true,
        }).catch(() => absolutePath);
        const message =
          replacements > 1
            ? `Successfully replaced ${replacements} occurrences in ${input.path}.`
            : `Successfully replaced text in ${input.path}.`;
        return {
          content: [{ type: "text", text: message }],
          details: {
            path: input.path,
            normalizedPath,
            resolvedPath: writeResult.resolvedPath,
            diff: preview.diff,
            firstChangedLine: preview.firstChangedLine,
            replacements,
            replaceAll,
            usedFuzzyMatch,
          },
        };
      } catch (error) {
        if (error instanceof FileToolError && error.errorCode === "file_changed_since_read") {
          const currentPath = await resolveFileToolPath({
            filePath: input.path,
            cwd: options.cwd ?? root,
            sandboxRoot: options.sandboxRoot,
            readMode: true,
          }).catch(() => resolveToCwd(input.path, options.cwd ?? root));
          const currentContent = await fs.readFile(currentPath, "utf8").catch(() => undefined);
          if (typeof currentContent === "string") {
            const relevantIndex = findRelevantIndex(currentContent, normalizedOldText);
            throw new FileToolError({
              errorCode: error.errorCode,
              contractCode: error.contractCode,
              message: error.message,
              details: {
                ...error.details,
                ...(relevantIndex >= 0
                  ? { context: numberedContext(normalizeToLF(currentContent), relevantIndex) }
                  : {}),
                diff_preview: buildRequestedDiffPreview(normalizedOldText, normalizedNewText),
                recommended_action:
                  "Re-read the latest file contents before retrying. Do not retry the stale edit payload unchanged.",
              },
            });
          }
        }
        throw error;
      }
    },
  };
}
