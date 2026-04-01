import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import type { PromptAssemblyArtifact } from "./system-prompt-sections.js";
import type { DynamicToolDelta } from "./system-prompt.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";
import { resolveSkillSourceCategory } from "./skills/registry.js";
import { estimateJsonTokens, estimateTextTokens } from "./token-estimate.js";

function extractBetween(
  input: string,
  startMarker: string,
  endMarker: string,
): { text: string; found: boolean } {
  const start = input.indexOf(startMarker);
  if (start === -1) {
    return { text: "", found: false };
  }
  const end = input.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    return { text: input.slice(start), found: true };
  }
  return { text: input.slice(start, end), found: true };
}

function parseSkillBlocks(
  skillsPrompt: string,
  resolvedSkills?: Array<{ name?: string; source?: string }>,
): SessionSystemPromptReport["skills"]["entries"] {
  const prompt = skillsPrompt.trim();
  if (!prompt) {
    return [];
  }
  const sourceCategoryByName = new Map<string, ReturnType<typeof resolveSkillSourceCategory>>();
  for (const skill of resolvedSkills ?? []) {
    const name = typeof skill.name === "string" ? skill.name.trim() : "";
    const source = typeof skill.source === "string" ? skill.source.trim() : "";
    if (!name || !source || sourceCategoryByName.has(name)) {
      continue;
    }
    sourceCategoryByName.set(name, resolveSkillSourceCategory(source));
  }
  const blocks = Array.from(prompt.matchAll(/<skill>[\s\S]*?<\/skill>/gi)).map(
    (match) => match[0] ?? "",
  );
  return blocks
    .map((block) => {
      const name = block.match(/<name>\s*([^<]+?)\s*<\/name>/i)?.[1]?.trim() || "(unknown)";
      return {
        name,
        blockChars: block.length,
        blockTokens: estimateTextTokens(block),
        sourceCategory: sourceCategoryByName.get(name) ?? "unknown",
      };
    })
    .filter((b) => b.blockChars > 0);
}

function resolveContextFileSourceGroup(
  name: string,
): NonNullable<SessionSystemPromptReport["injectedWorkspaceFiles"][number]["sourceGroup"]> {
  const normalized = name.trim().toUpperCase();
  if (normalized === "IDENTITY.MD" || normalized === "USER.MD") {
    return "user";
  }
  if (
    normalized === "HEARTBEAT.MD" ||
    normalized === "ACTIVE_TASK" ||
    normalized === "TASK_TRACKER"
  ) {
    return "managed";
  }
  if (!normalized) {
    return "unknown";
  }
  return "project";
}

function buildInjectedWorkspaceFiles(params: {
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  bootstrapMaxChars: number;
}): SessionSystemPromptReport["injectedWorkspaceFiles"] {
  const injectedByName = new Map(params.injectedFiles.map((f) => [f.path, f.content]));
  const bootstrapEntries = params.bootstrapFiles.map((file) => {
    const rawText = file.missing ? "" : (file.rawContent ?? file.content ?? "").trimEnd();
    const rawChars = rawText.length;
    const injected = injectedByName.get(file.name);
    const injectedChars = injected ? injected.length : 0;
    const truncated = !file.missing && rawChars > params.bootstrapMaxChars;
    return {
      name: file.name,
      path: file.path,
      missing: file.missing,
      rawChars,
      rawTokens: estimateTextTokens(rawText),
      injectedChars,
      injectedTokens: estimateTextTokens(injected ?? ""),
      truncated,
      synthetic: false,
      sourceGroup: file.sourceGroup ?? resolveContextFileSourceGroup(file.name),
      provenance: (file.provenance ?? []).map((entry) => ({
        path: entry.path,
        sourceGroup: entry.sourceGroup,
        parentInclude: entry.parentInclude,
        rawChars: entry.rawChars,
        transformedChars: entry.transformedChars,
      })),
    };
  });
  const seenNames = new Set<string>(bootstrapEntries.map((entry) => entry.name));
  const syntheticEntries = params.injectedFiles
    .filter((file) => !seenNames.has(file.path))
    .map((file) => {
      const injectedChars = file.content.length;
      return {
        name: file.path,
        path: file.path,
        missing: false,
        rawChars: injectedChars,
        rawTokens: estimateTextTokens(file.content),
        injectedChars,
        injectedTokens: estimateTextTokens(file.content),
        truncated: false,
        synthetic: true,
        sourceGroup: resolveContextFileSourceGroup(file.path),
      };
    });
  return [...bootstrapEntries, ...syntheticEntries];
}

function buildToolsEntries(tools: AgentTool[]): SessionSystemPromptReport["tools"]["entries"] {
  return tools.map((tool) => {
    const name = tool.name;
    const summary = tool.description?.trim() || tool.label?.trim() || "";
    const summaryChars = summary.length;
    const summaryTokens = estimateTextTokens(summary);
    const schemaChars = (() => {
      if (!tool.parameters || typeof tool.parameters !== "object") {
        return 0;
      }
      try {
        return JSON.stringify(tool.parameters).length;
      } catch {
        return 0;
      }
    })();
    const schemaTokens = estimateJsonTokens(tool.parameters);
    const propertiesCount = (() => {
      const schema =
        tool.parameters && typeof tool.parameters === "object"
          ? (tool.parameters as Record<string, unknown>)
          : null;
      const props = schema && typeof schema.properties === "object" ? schema.properties : null;
      if (!props || typeof props !== "object") {
        return null;
      }
      return Object.keys(props as Record<string, unknown>).length;
    })();
    return { name, summaryChars, summaryTokens, schemaChars, schemaTokens, propertiesCount };
  });
}

function buildDynamicToolingSummary(
  delta?: DynamicToolDelta,
): SessionSystemPromptReport["dynamicTooling"] | undefined {
  const loadedTools = (delta?.loadedTools ?? [])
    .map((tool) => {
      const name = tool.name.trim();
      const summary = tool.summary?.trim() ?? "";
      return {
        name,
        summaryChars: summary.length,
        summaryTokens: estimateTextTokens(summary),
      };
    })
    .filter((tool) => tool.name)
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const pendingProviders = (delta?.pendingProviders ?? [])
    .map((provider) => provider.trim())
    .filter(Boolean);
  if (loadedTools.length === 0 && pendingProviders.length === 0) {
    return undefined;
  }
  return {
    loadedCount: loadedTools.length,
    ...(pendingProviders.length > 0 ? { pendingProviders } : {}),
    entries: loadedTools,
  };
}

function extractToolListText(systemPrompt: string): string {
  const markerA = "Tool names are case-sensitive. Call tools exactly as listed.\n";
  const markerB =
    "\nTOOLS.md does not control tool availability; it is user guidance for how to use external tools.";
  const extracted = extractBetween(systemPrompt, markerA, markerB);
  if (!extracted.found) {
    return "";
  }
  return extracted.text.replace(markerA, "").trim();
}

export function buildSystemPromptReport(params: {
  source: SessionSystemPromptReport["source"];
  generatedAt: number;
  sessionId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  workspaceDir?: string;
  bootstrapMaxChars: number;
  sandbox?: SessionSystemPromptReport["sandbox"];
  systemPrompt: string;
  promptAssembly?: PromptAssemblyArtifact;
  bootstrapFiles: WorkspaceBootstrapFile[];
  injectedFiles: EmbeddedContextFile[];
  skillsPrompt: string;
  dynamicToolDelta?: DynamicToolDelta;
  resolvedSkills?: Array<{ name?: string; source?: string }>;
  availableSkillsCount?: number;
  loadedSkillsCount?: number;
  tools: AgentTool[];
}): SessionSystemPromptReport {
  const systemPrompt = params.systemPrompt.trim();
  const projectContext = extractBetween(systemPrompt, "\n# Project Context\n", "\n## Runtime\n");
  const projectContextChars = projectContext.text.length;
  const projectContextTokens = estimateTextTokens(projectContext.text);
  const toolListText = extractToolListText(systemPrompt);
  const toolListChars = toolListText.length;
  const toolListTokens = estimateTextTokens(toolListText);
  const toolsEntries = buildToolsEntries(params.tools);
  const toolsSchemaChars = toolsEntries.reduce((sum, t) => sum + (t.schemaChars ?? 0), 0);
  const toolsSchemaTokens = toolsEntries.reduce((sum, t) => sum + (t.schemaTokens ?? 0), 0);
  const skillsEntries = parseSkillBlocks(params.skillsPrompt, params.resolvedSkills);
  const systemPromptTokens = estimateTextTokens(systemPrompt);
  const skillsPromptTokens = estimateTextTokens(params.skillsPrompt);

  return {
    source: params.source,
    generatedAt: params.generatedAt,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.model,
    workspaceDir: params.workspaceDir,
    bootstrapMaxChars: params.bootstrapMaxChars,
    sandbox: params.sandbox,
    systemPrompt: {
      chars: systemPrompt.length,
      tokens: systemPromptTokens,
      projectContextChars,
      projectContextTokens,
      nonProjectContextChars: Math.max(0, systemPrompt.length - projectContextChars),
      nonProjectContextTokens: Math.max(0, systemPromptTokens - projectContextTokens),
    },
    cache: params.promptAssembly
      ? {
          boundaryMarker: params.promptAssembly.boundaryMarker,
          staticPrefixHash: params.promptAssembly.staticPrefixHash,
          staticPrefixChars: params.promptAssembly.staticPrefix.length,
          dynamicTailChars: params.promptAssembly.dynamicTail.length,
          staticPrefixCacheStatus: params.promptAssembly.staticPrefixCacheStatus,
          staticPrefixSeenCount: params.promptAssembly.staticPrefixSeenCount,
          recomputedSectionCount: params.promptAssembly.recomputedSectionCount,
          staticSectionNames: params.promptAssembly.staticSectionNames,
          dynamicSectionNames: params.promptAssembly.dynamicSectionNames,
        }
      : undefined,
    injectedWorkspaceFiles: buildInjectedWorkspaceFiles({
      bootstrapFiles: params.bootstrapFiles,
      injectedFiles: params.injectedFiles,
      bootstrapMaxChars: params.bootstrapMaxChars,
    }),
    skills: {
      promptChars: params.skillsPrompt.length,
      promptTokens: skillsPromptTokens,
      availableCount: params.availableSkillsCount,
      loadedCount: params.loadedSkillsCount,
      entries: skillsEntries,
    },
    tools: {
      listChars: toolListChars,
      listTokens: toolListTokens,
      schemaChars: toolsSchemaChars,
      schemaTokens: toolsSchemaTokens,
      entries: toolsEntries,
    },
    dynamicTooling: buildDynamicToolingSummary(params.dynamicToolDelta),
  };
}
