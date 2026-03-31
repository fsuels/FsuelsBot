import { CORE_TOOL_IDS, TOOL_GROUPS, normalizeToolName } from "./tool-policy.js";

export type ToolCatalogSource = "core" | "plugin";

export type ToolCatalogSection = {
  id: string;
  label: string;
  source: ToolCatalogSource;
  pluginId?: string;
};

export type ToolCatalogTool = {
  id: string;
  label: string;
  description: string;
  sectionId: string;
  source: ToolCatalogSource;
  pluginId?: string;
};

export type ToolCatalog = {
  sections: ToolCatalogSection[];
  tools: ToolCatalogTool[];
  selectors: {
    toolIds: string[];
    groupIds: string[];
    pluginIds: string[];
  };
};

export type PluginToolCatalogInput = {
  pluginId: string;
  pluginName?: string;
  toolNames?: string[];
};

export type ToolSelectorIssue = {
  entry: string;
  reason: "empty" | "unknown" | "no_match";
};

type CoreToolMeta = {
  sectionId: string;
  description: string;
};

const CORE_SECTIONS: ToolCatalogSection[] = [
  { id: "files", label: "Files", source: "core" },
  { id: "runtime", label: "Runtime", source: "core" },
  { id: "web", label: "Web", source: "core" },
  { id: "memory", label: "Memory", source: "core" },
  { id: "tasks", label: "Tasks", source: "core" },
  { id: "sessions", label: "Sessions", source: "core" },
  { id: "ui", label: "UI", source: "core" },
  { id: "messaging", label: "Messaging", source: "core" },
  { id: "automation", label: "Automation", source: "core" },
  { id: "nodes", label: "Nodes", source: "core" },
  { id: "auth", label: "Auth", source: "core" },
] as const;

const CORE_TOOL_METADATA = {
  read: { sectionId: "files", description: "Read file contents" },
  write: { sectionId: "files", description: "Create or overwrite files" },
  edit: { sectionId: "files", description: "Make precise edits" },
  apply_patch: { sectionId: "files", description: "Patch files atomically" },
  grep: { sectionId: "files", description: "Search file contents" },
  find: { sectionId: "files", description: "Find files by name or path" },
  ls: { sectionId: "files", description: "List directory contents" },
  exec: { sectionId: "runtime", description: "Run shell commands" },
  process: { sectionId: "runtime", description: "Manage background processes" },
  get_task_output: { sectionId: "tasks", description: "Fetch a task worker's recorded output" },
  sleep: { sectionId: "runtime", description: "Pause before retrying or polling" },
  ask_user_question: { sectionId: "sessions", description: "Pause for explicit user input" },
  browser: { sectionId: "ui", description: "Control a web browser" },
  canvas: { sectionId: "ui", description: "Control canvases" },
  nodes: { sectionId: "nodes", description: "Inspect and manage nodes or devices" },
  cron: { sectionId: "automation", description: "Schedule or inspect cron work" },
  message: { sectionId: "messaging", description: "Send messages" },
  tts: { sectionId: "messaging", description: "Convert text to speech" },
  gateway: { sectionId: "automation", description: "Inspect or control the gateway" },
  tasks_list: { sectionId: "tasks", description: "List task tracker items" },
  task_get: { sectionId: "tasks", description: "Read a specific tracked task" },
  task_plan: { sectionId: "tasks", description: "Create or update a task plan" },
  agents_list: { sectionId: "sessions", description: "List configured agents" },
  sessions_list: { sectionId: "sessions", description: "List sessions" },
  sessions_history: { sectionId: "sessions", description: "Read session history" },
  sessions_send: { sectionId: "sessions", description: "Send work to another session" },
  sessions_spawn: { sectionId: "sessions", description: "Spawn a sub-agent worker" },
  session_status: { sectionId: "sessions", description: "Inspect session status" },
  verification_gate: {
    sectionId: "sessions",
    description: "Run an independent verification pass",
  },
  task_tracker: { sectionId: "tasks", description: "Track progress across multi-step work" },
  delegate: { sectionId: "sessions", description: "Delegate work to another agent" },
  memory_search: { sectionId: "memory", description: "Semantic search over memory" },
  memory_get: { sectionId: "memory", description: "Read memory files" },
  web_search: { sectionId: "web", description: "Search the web" },
  web_fetch: { sectionId: "web", description: "Fetch web content" },
  image: { sectionId: "ui", description: "Inspect or generate images" },
  whatsapp_login: { sectionId: "auth", description: "Handle WhatsApp login flows" },
} as const satisfies Record<(typeof CORE_TOOL_IDS)[number], CoreToolMeta>;

const CORE_SECTION_BY_ID = new Map(CORE_SECTIONS.map((section) => [section.id, section]));
const GROUP_IDS = Object.keys(TOOL_GROUPS).map((groupId) => normalizeToolName(groupId));

function titleCaseToolName(toolId: string): string {
  const spaced = toolId.replace(/_/g, " ").trim();
  if (!spaced) {
    return "Tool";
  }
  return spaced
    .split(/\s+/)
    .map((part) => `${part.at(0)?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function assertCoreToolCoverage() {
  for (const toolId of CORE_TOOL_IDS) {
    if (!CORE_TOOL_METADATA[toolId]) {
      throw new Error(`Missing tool catalog metadata for core tool "${toolId}".`);
    }
    const sectionId = CORE_TOOL_METADATA[toolId].sectionId;
    if (!CORE_SECTION_BY_ID.has(sectionId)) {
      throw new Error(`Unknown tool catalog section "${sectionId}" for core tool "${toolId}".`);
    }
  }
}

assertCoreToolCoverage();

function dedupeSorted(list: string[]) {
  return Array.from(new Set(list.map((entry) => entry.trim()).filter(Boolean))).toSorted((a, b) =>
    a.localeCompare(b),
  );
}

function buildPluginSections(
  plugins: PluginToolCatalogInput[],
): Array<{ section: ToolCatalogSection; tools: ToolCatalogTool[] }> {
  const sections: Array<{ section: ToolCatalogSection; tools: ToolCatalogTool[] }> = [];
  for (const plugin of plugins) {
    const pluginId = normalizeToolName(plugin.pluginId);
    if (!pluginId) {
      continue;
    }
    const declaredToolIds = dedupeSorted(
      (plugin.toolNames ?? []).map((toolName) => normalizeToolName(toolName)),
    );
    const sectionId = `plugin:${pluginId}`;
    const label = plugin.pluginName?.trim() || pluginId;
    const toolIds = declaredToolIds.length > 0 ? declaredToolIds : [pluginId];
    sections.push({
      section: { id: sectionId, label, source: "plugin", pluginId },
      tools: toolIds.map((toolId) => ({
        id: toolId,
        label: toolId,
        description:
          toolId === pluginId && declaredToolIds.length === 0
            ? `Enable tool access provided by ${label}`
            : `Plugin tool from ${label}`,
        sectionId,
        source: "plugin",
        pluginId,
      })),
    });
  }
  return sections.toSorted((left, right) => left.section.label.localeCompare(right.section.label));
}

export function buildToolCatalog(params?: { pluginTools?: PluginToolCatalogInput[] }): ToolCatalog {
  const coreTools = CORE_TOOL_IDS.map((toolId) => {
    const meta = CORE_TOOL_METADATA[toolId];
    return {
      id: toolId,
      label: toolId,
      description: meta.description,
      sectionId: meta.sectionId,
      source: "core" as const,
    };
  });
  const pluginSections = buildPluginSections(params?.pluginTools ?? []);
  const pluginTools = pluginSections.flatMap((entry) => entry.tools);
  return {
    sections: [...CORE_SECTIONS, ...pluginSections.map((entry) => entry.section)],
    tools: [...coreTools, ...pluginTools],
    selectors: {
      toolIds: [...coreTools.map((tool) => tool.id), ...pluginTools.map((tool) => tool.id)],
      groupIds: GROUP_IDS,
      pluginIds: pluginSections.map((entry) => entry.section.pluginId!).filter(Boolean),
    },
  };
}

function wildcardMatchesAny(entry: string, candidates: Iterable<string>): boolean {
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replaceAll("*", ".*")}$`);
  for (const candidate of candidates) {
    if (regex.test(candidate)) {
      return true;
    }
  }
  return false;
}

export function findToolSelectorIssues(entries: string[] | undefined, catalog: ToolCatalog) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [] as ToolSelectorIssue[];
  }
  const exact = new Set<string>([
    ...catalog.selectors.toolIds,
    ...catalog.selectors.groupIds,
    ...catalog.selectors.pluginIds,
    "group:plugins",
  ]);
  const matchable = new Set<string>([...catalog.selectors.toolIds, ...catalog.selectors.pluginIds]);
  const issues: ToolSelectorIssue[] = [];
  for (const rawEntry of entries) {
    const normalized = normalizeToolName(rawEntry);
    if (!normalized) {
      issues.push({ entry: String(rawEntry ?? ""), reason: "empty" });
      continue;
    }
    if (normalized === "*" || exact.has(normalized)) {
      continue;
    }
    if (normalized.includes("*")) {
      if (wildcardMatchesAny(normalized, matchable)) {
        continue;
      }
      issues.push({ entry: rawEntry, reason: "no_match" });
      continue;
    }
    issues.push({ entry: rawEntry, reason: "unknown" });
  }
  return issues;
}

export function describeToolSelectorIssue(issue: ToolSelectorIssue): string {
  const entry = issue.entry.trim() || "(empty)";
  switch (issue.reason) {
    case "empty":
      return "tool selector must not be empty";
    case "no_match":
      return `tool selector "${entry}" does not match any currently available tools`;
    case "unknown":
    default:
      return `unknown tool selector "${entry}"`;
  }
}

export function getToolCatalogSectionLabel(catalog: ToolCatalog, sectionId: string): string {
  const section = catalog.sections.find((entry) => entry.id === sectionId);
  return section?.label ?? titleCaseToolName(sectionId);
}
