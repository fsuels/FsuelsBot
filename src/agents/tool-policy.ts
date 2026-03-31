import type { AnyAgentTool } from "./tools/common.js";

export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "exec",
  "apply-patch": "apply_patch",
  task_output: "get_task_output",
};

const EXPLICIT_TOOL_ALIAS_IDS: Record<string, readonly string[]> = {
  get_task_output: ["task_output"],
};

export const CORE_TOOL_IDS = [
  "read",
  "write",
  "edit",
  "apply_patch",
  "grep",
  "find",
  "ls",
  "exec",
  "process",
  "get_task_output",
  "browser",
  "canvas",
  "nodes",
  "cron",
  "message",
  "tts",
  "gateway",
  "tasks_list",
  "task_get",
  "agents_list",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "session_status",
  "task_tracker",
  "delegate",
  "memory_search",
  "memory_get",
  "web_search",
  "web_fetch",
  "image",
  "whatsapp_login",
] as const;

export type CoreToolId = (typeof CORE_TOOL_IDS)[number];

export const TOOL_GROUPS = {
  // NOTE: Keep canonical (lowercase) tool names here.
  "group:memory": ["memory_search", "memory_get"],
  "group:web": ["web_search", "web_fetch"],
  // Basic workspace/file tools
  "group:fs": ["read", "write", "edit", "apply_patch"],
  // Host/runtime execution tools
  "group:runtime": ["exec", "process", "get_task_output"],
  // Session management tools
  "group:sessions": [
    "tasks_list",
    "task_get",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "get_task_output",
    "session_status",
    "task_tracker",
  ],
  // UI helpers
  "group:ui": ["browser", "canvas"],
  // Automation + infra
  "group:automation": ["cron", "gateway"],
  // Messaging surface
  "group:messaging": ["message"],
  // Nodes + device tools
  "group:nodes": ["nodes"],
  // All OpenClaw native tools (excludes provider plugins).
  "group:openclaw": [
    "browser",
    "canvas",
    "nodes",
    "cron",
    "message",
    "tts",
    "gateway",
    "tasks_list",
    "task_get",
    "agents_list",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "get_task_output",
    "session_status",
    "task_tracker",
    "delegate",
    "memory_search",
    "memory_get",
    "web_search",
    "web_fetch",
    "image",
  ],
} as const satisfies Record<string, readonly CoreToolId[]>;

export type ToolGroupId = keyof typeof TOOL_GROUPS;

type ToolPolicyEntry = CoreToolId | ToolGroupId | "*";

type ToolProfilePolicy = {
  allow?: ToolPolicyEntry[];
  deny?: ToolPolicyEntry[];
};

const OWNER_ONLY_TOOL_NAMES = new Set<string>(["whatsapp_login"]);

const TOOL_PROFILES: Record<ToolProfileId, ToolProfilePolicy> = {
  minimal: {
    allow: ["session_status"],
  },
  coding: {
    allow: ["group:fs", "group:runtime", "group:sessions", "group:memory", "image"],
  },
  messaging: {
    allow: [
      "group:messaging",
      "sessions_list",
      "sessions_history",
      "sessions_send",
      "session_status",
    ],
  },
  full: {},
};

export function normalizeToolName(name: string) {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

type StaticToolPolicyConfig = {
  toolIds: readonly string[];
  toolGroups: Record<string, readonly string[]>;
  toolProfiles: Record<string, { allow?: readonly string[]; deny?: readonly string[] }>;
  ownerOnlyToolNames?: Iterable<string>;
};

function validateStaticToolPolicyConfig(config: StaticToolPolicyConfig): void {
  const seenToolIds = new Map<string, string>();
  for (const rawToolId of config.toolIds) {
    const normalizedToolId = normalizeToolName(rawToolId);
    if (!normalizedToolId) {
      throw new Error("Tool registry contains an empty tool id.");
    }
    const existing = seenToolIds.get(normalizedToolId);
    if (existing) {
      throw new Error(
        `Tool registry contains duplicate tool id "${normalizedToolId}" via "${existing}" and "${rawToolId}".`,
      );
    }
    seenToolIds.set(normalizedToolId, rawToolId);
  }

  const knownToolIds = new Set(seenToolIds.keys());
  const knownGroups = new Set(Object.keys(config.toolGroups).map(normalizeToolName));
  const validateEntries = (entries: readonly string[] | undefined, label: string) => {
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      const normalizedEntry = normalizeToolName(entry);
      if (!normalizedEntry) {
        throw new Error(`${label} contains an empty tool policy entry.`);
      }
      if (normalizedEntry === "*") {
        continue;
      }
      if (normalizedEntry.startsWith("group:")) {
        if (!knownGroups.has(normalizedEntry)) {
          throw new Error(`${label} references unknown tool group "${normalizedEntry}".`);
        }
        continue;
      }
      if (!knownToolIds.has(normalizedEntry)) {
        throw new Error(`${label} references unknown tool id "${normalizedEntry}".`);
      }
    }
  };

  for (const [groupName, entries] of Object.entries(config.toolGroups)) {
    validateEntries(entries, `Tool group ${groupName}`);
  }
  for (const [profileName, policy] of Object.entries(config.toolProfiles)) {
    validateEntries(policy.allow, `Tool profile ${profileName}.allow`);
    validateEntries(policy.deny, `Tool profile ${profileName}.deny`);
  }
  validateEntries(
    config.ownerOnlyToolNames ? Array.from(config.ownerOnlyToolNames) : undefined,
    "Owner-only tool policy",
  );
}

export function assertUniqueToolNames<T extends { name: string }>(
  tools: readonly T[],
  label = "tools",
): void {
  const seen = new Map<string, Set<string>>();
  for (const tool of tools) {
    const rawName = typeof tool.name === "string" ? tool.name : "";
    const normalizedName = normalizeToolName(rawName);
    if (!normalizedName) {
      throw new Error(`${label} contains a tool with an empty name.`);
    }
    const rawKey = rawName.trim().toLowerCase();
    const existing = seen.get(normalizedName);
    if (existing) {
      const allowedAliases = new Set(EXPLICIT_TOOL_ALIAS_IDS[normalizedName] ?? []);
      const allowedRawNames = new Set([normalizedName, ...allowedAliases]);
      const canCoexist =
        allowedAliases.size > 0 &&
        Array.from(existing).every((name) => allowedRawNames.has(name)) &&
        allowedRawNames.has(rawKey);
      if (canCoexist) {
        existing.add(rawKey);
        continue;
      }
      const prior = Array.from(existing)[0] ?? normalizedName;
      throw new Error(
        `${label} contains duplicate tool id "${normalizedName}" via "${prior}" and "${rawName}".`,
      );
    }
    seen.set(normalizedName, new Set([rawKey]));
  }
}

validateStaticToolPolicyConfig({
  toolIds: CORE_TOOL_IDS,
  toolGroups: TOOL_GROUPS,
  toolProfiles: TOOL_PROFILES,
  ownerOnlyToolNames: OWNER_ONLY_TOOL_NAMES,
});

export function isOwnerOnlyToolName(name: string) {
  return OWNER_ONLY_TOOL_NAMES.has(normalizeToolName(name));
}

export function applyOwnerOnlyToolPolicy(tools: AnyAgentTool[], senderIsOwner: boolean) {
  const withGuard = tools.map((tool) => {
    if (!isOwnerOnlyToolName(tool.name)) {
      return tool;
    }
    if (senderIsOwner || !tool.execute) {
      return tool;
    }
    return {
      ...tool,
      execute: async () => {
        throw new Error("Tool restricted to owner senders.");
      },
    };
  });
  if (senderIsOwner) {
    return withGuard;
  }
  return withGuard.filter((tool) => !isOwnerOnlyToolName(tool.name));
}

export function normalizeToolList(list?: string[]) {
  if (!list) {
    return [];
  }
  return list.map(normalizeToolName).filter(Boolean);
}

export type ToolPolicyLike = {
  allow?: string[];
  deny?: string[];
};

export type PluginToolGroups = {
  all: string[];
  byPlugin: Map<string, string[]>;
};

export type AllowlistResolution = {
  policy: ToolPolicyLike | undefined;
  unknownAllowlist: string[];
  strippedAllowlist: boolean;
};

export function expandToolGroups(list?: string[]) {
  const normalized = normalizeToolList(list);
  const expanded: string[] = [];
  for (const value of normalized) {
    const group = TOOL_GROUPS[value as keyof typeof TOOL_GROUPS];
    if (group) {
      expanded.push(...group);
      continue;
    }
    expanded.push(value);
  }
  return Array.from(new Set(expanded));
}

export function collectExplicitAllowlist(policies: Array<ToolPolicyLike | undefined>): string[] {
  const entries: string[] = [];
  for (const policy of policies) {
    if (!policy?.allow) {
      continue;
    }
    for (const value of policy.allow) {
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) {
        entries.push(trimmed);
      }
    }
  }
  return entries;
}

export function buildPluginToolGroups<T extends { name: string }>(params: {
  tools: T[];
  toolMeta: (tool: T) => { pluginId: string } | undefined;
}): PluginToolGroups {
  const all: string[] = [];
  const byPlugin = new Map<string, string[]>();
  for (const tool of params.tools) {
    const meta = params.toolMeta(tool);
    if (!meta) {
      continue;
    }
    const name = normalizeToolName(tool.name);
    all.push(name);
    const pluginId = meta.pluginId.toLowerCase();
    const list = byPlugin.get(pluginId) ?? [];
    list.push(name);
    byPlugin.set(pluginId, list);
  }
  return { all, byPlugin };
}

export function expandPluginGroups(
  list: string[] | undefined,
  groups: PluginToolGroups,
): string[] | undefined {
  if (!list || list.length === 0) {
    return list;
  }
  const expanded: string[] = [];
  for (const entry of list) {
    const normalized = normalizeToolName(entry);
    if (normalized === "group:plugins") {
      if (groups.all.length > 0) {
        expanded.push(...groups.all);
      } else {
        expanded.push(normalized);
      }
      continue;
    }
    const tools = groups.byPlugin.get(normalized);
    if (tools && tools.length > 0) {
      expanded.push(...tools);
      continue;
    }
    expanded.push(normalized);
  }
  return Array.from(new Set(expanded));
}

export function expandPolicyWithPluginGroups(
  policy: ToolPolicyLike | undefined,
  groups: PluginToolGroups,
): ToolPolicyLike | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    allow: expandPluginGroups(policy.allow, groups),
    deny: expandPluginGroups(policy.deny, groups),
  };
}

export function stripPluginOnlyAllowlist(
  policy: ToolPolicyLike | undefined,
  groups: PluginToolGroups,
  coreTools: Set<string>,
): AllowlistResolution {
  if (!policy?.allow || policy.allow.length === 0) {
    return { policy, unknownAllowlist: [], strippedAllowlist: false };
  }
  const normalized = normalizeToolList(policy.allow);
  if (normalized.length === 0) {
    return { policy, unknownAllowlist: [], strippedAllowlist: false };
  }
  const pluginIds = new Set(groups.byPlugin.keys());
  const pluginTools = new Set(groups.all);
  const unknownAllowlist: string[] = [];
  let hasCoreEntry = false;
  for (const entry of normalized) {
    if (entry === "*") {
      hasCoreEntry = true;
      continue;
    }
    const isPluginEntry =
      entry === "group:plugins" || pluginIds.has(entry) || pluginTools.has(entry);
    const expanded = expandToolGroups([entry]);
    const isCoreEntry = expanded.some((tool) => coreTools.has(tool));
    if (isCoreEntry) {
      hasCoreEntry = true;
    }
    if (!isCoreEntry && !isPluginEntry) {
      unknownAllowlist.push(entry);
    }
  }
  const strippedAllowlist = !hasCoreEntry;
  // When an allowlist contains only plugin tools, we strip it to avoid accidentally
  // disabling core tools. Users who want additive behavior should prefer `tools.alsoAllow`.
  if (strippedAllowlist) {
    // Note: logging happens in the caller (pi-tools/tools-invoke) after this function returns.
    // We keep this note here for future maintainers.
  }
  return {
    policy: strippedAllowlist ? { ...policy, allow: undefined } : policy,
    unknownAllowlist: Array.from(new Set(unknownAllowlist)),
    strippedAllowlist,
  };
}

export function resolveToolProfilePolicy(profile?: string): ToolProfilePolicy | undefined {
  if (!profile) {
    return undefined;
  }
  const resolved = TOOL_PROFILES[profile as ToolProfileId];
  if (!resolved) {
    return undefined;
  }
  if (!resolved.allow && !resolved.deny) {
    return undefined;
  }
  return {
    allow: resolved.allow ? [...resolved.allow] : undefined,
    deny: resolved.deny ? [...resolved.deny] : undefined,
  };
}

export const __testing = {
  validateStaticToolPolicyConfig,
  assertUniqueToolNames,
} as const;
