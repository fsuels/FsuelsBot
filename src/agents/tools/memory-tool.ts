import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import type { MemorySearchResult } from "../../memory/types.js";
import type { AnyAgentTool } from "./common.js";
import { emitDiagnosticEvent, isDiagnosticsEnabled } from "../../infra/diagnostic-events.js";
import { resolveMemoryBackendConfig } from "../../memory/backend-config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import { normalizeMemoryTaskId } from "../../memory/namespaces.js";
import { getTaskRegistryTask } from "../../memory/task-memory-system.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveAgentWorkspaceDir } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
  taskId: Type.Optional(Type.String()),
  namespace: Type.Optional(Type.String()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
  taskId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  const memorySearchConfig = resolveMemorySearchConfig(cfg, agentId);
  if (!memorySearchConfig) {
    return null;
  }
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: deterministic memory retrieval (filter -> rank -> stitch). If taskId is set, searches task namespace first (memory/tasks/<taskId>.md + directory), then global memory fallback and read-only linked tasks; returns top snippets with path + lines.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const taskId = normalizeMemoryTaskId(readStringParam(params, "taskId"));
      const taskNamespace = (() => {
        const raw = readStringParam(params, "namespace")?.trim().toLowerCase();
        if (!raw) {
          return undefined;
        }
        if (raw === "auto" || raw === "any" || raw === "task" || raw === "global") {
          return raw;
        }
        return undefined;
      })();
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ results: [], disabled: true, error });
      }
      try {
        const requestedTaskId = taskId ?? normalizeMemoryTaskId(options.taskId);
        const resolvedNamespace = taskNamespace ?? "auto";
        const max = maxResults ?? 6;
        const citationsMode = resolveMemoryCitationsMode(cfg);
        const includeCitations = shouldIncludeCitations({
          mode: citationsMode,
          sessionKey: options.agentSessionKey,
        });
        const primary = await manager.search(query, {
          maxResults,
          minScore,
          sessionKey: options.agentSessionKey,
          taskId: requestedTaskId,
          namespace: taskNamespace,
        });
        let results = primary;
        if (
          requestedTaskId &&
          (resolvedNamespace === "auto" || resolvedNamespace === "task") &&
          primary.length < max
        ) {
          const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
          const registryTask = await getTaskRegistryTask({
            workspaceDir,
            taskId: requestedTaskId,
          });
          const linkedTaskIds = registryTask?.links ?? [];
          const linkedTaskBudget = Math.max(
            0,
            Math.min(memorySearchConfig.query.linkedTaskSnippetCap, max - primary.length),
          );
          if (linkedTaskBudget > 0 && linkedTaskIds.length > 0) {
            const linkedResults = await Promise.all(
              linkedTaskIds.slice(0, 5).map(async (linkedTaskId) => {
                const scoped = await manager.search(query, {
                  maxResults: Math.max(1, Math.min(2, linkedTaskBudget)),
                  minScore,
                  sessionKey: options.agentSessionKey,
                  taskId: linkedTaskId,
                  namespace: "task",
                  globalFallback: false,
                });
                return scoped.map(
                  (entry): MemorySearchResult => ({
                    ...entry,
                    snippet: `[related task: ${linkedTaskId}] ${entry.snippet}`,
                    provenance: entry.provenance
                      ? {
                          ...entry.provenance,
                          inferred: true,
                          explicit: false,
                          taskId: linkedTaskId,
                        }
                      : {
                          source: "task-file",
                          sourcePath: entry.path,
                          explicit: false,
                          inferred: true,
                          taskId: linkedTaskId,
                        },
                  }),
                );
              }),
            );
            const linkedCapped = linkedResults.flat().slice(0, linkedTaskBudget);
            const deduped: typeof results = [];
            const seen = new Set<string>();
            for (const entry of [...primary, ...linkedCapped]) {
              const key = `${entry.path}:${entry.startLine}:${entry.endLine}`;
              if (seen.has(key)) {
                continue;
              }
              seen.add(key);
              deduped.push(entry);
              if (deduped.length >= max) {
                break;
              }
            }
            results = deduped;
          }
        }
        const status = manager.status();
        const decorated = decorateCitations(results, includeCitations);
        const resolvedBackend = resolveMemoryBackendConfig({ cfg, agentId });
        const finalResults =
          status.backend === "qmd"
            ? clampResultsByInjectedChars(decorated, resolvedBackend.qmd?.limits.maxInjectedChars)
            : decorated;
        if (isDiagnosticsEnabled(cfg)) {
          emitDiagnosticEvent({
            type: "memory.retrieval",
            sessionKey: options.agentSessionKey,
            taskId: requestedTaskId,
            namespace: resolvedNamespace,
            resultCount: finalResults.length,
            configHash: status.retrievalVersion?.configHash,
            embeddingModel: status.retrievalVersion?.embeddingModel,
            bm25ConfigVersion: status.retrievalVersion?.bm25ConfigVersion,
          });
        }
        return jsonResult({
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
          results: finalResults,
          retrievalVersion: status.retrievalVersion,
          citations: citationsMode,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ results: [], disabled: true, error: message });
      }
    },
  };
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      try {
        const result = await manager.readFile({
          relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, text: "", disabled: true, error: message });
      }
    },
  };
}

function resolveMemoryCitationsMode(cfg: OpenClawConfig): MemoryCitationsMode {
  const mode = cfg.memory?.citations;
  if (mode === "on" || mode === "off" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function decorateCitations(results: MemorySearchResult[], include: boolean): MemorySearchResult[] {
  if (!include) {
    return results.map((entry) => ({ ...entry, citation: undefined }));
  }
  return results.map((entry) => {
    const citation = formatCitation(entry);
    const snippet = `${entry.snippet.trim()}\n\nSource: ${citation}`;
    return { ...entry, citation, snippet };
  });
}

function formatCitation(entry: MemorySearchResult): string {
  const lineRange =
    entry.startLine === entry.endLine
      ? `#L${entry.startLine}`
      : `#L${entry.startLine}-L${entry.endLine}`;
  return `${entry.path}${lineRange}`;
}

function clampResultsByInjectedChars(
  results: MemorySearchResult[],
  budget?: number,
): MemorySearchResult[] {
  if (!budget || budget <= 0) {
    return results;
  }
  let remaining = budget;
  const clamped: MemorySearchResult[] = [];
  for (const entry of results) {
    if (remaining <= 0) {
      break;
    }
    const snippet = entry.snippet ?? "";
    if (snippet.length <= remaining) {
      clamped.push(entry);
      remaining -= snippet.length;
    } else {
      const trimmed = snippet.slice(0, Math.max(0, remaining));
      clamped.push({ ...entry, snippet: trimmed });
      break;
    }
  }
  return clamped;
}

function shouldIncludeCitations(params: {
  mode: MemoryCitationsMode;
  sessionKey?: string;
}): boolean {
  if (params.mode === "on") {
    return true;
  }
  if (params.mode === "off") {
    return false;
  }
  // auto: show citations in direct chats; suppress in groups/channels by default.
  const chatType = deriveChatTypeFromSessionKey(params.sessionKey);
  return chatType === "direct";
}

function deriveChatTypeFromSessionKey(sessionKey?: string): "direct" | "group" | "channel" {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed?.rest) {
    return "direct";
  }
  const tokens = new Set(parsed.rest.toLowerCase().split(":").filter(Boolean));
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("group")) {
    return "group";
  }
  return "direct";
}
