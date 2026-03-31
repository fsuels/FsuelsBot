import type { SandboxToolPolicy } from "./sandbox.js";
import { expandToolGroups, normalizeToolName } from "./tool-policy.js";

export type SubagentCapabilityProfileId =
  | "research"
  | "implementation"
  | "test-runner"
  | "planner"
  | "custom";

type SubagentCapabilityProfileDefinition = {
  label: string;
  summary: string;
  allow?: string[];
};

const PROFILE_ORDER: SubagentCapabilityProfileId[] = new Set([
  "research",
  "planner",
  "implementation",
  "test-runner",
  "custom",
]);

const PROFILE_ALIASES: Record<string, SubagentCapabilityProfileId> = {
  "read-only": "research",
  readonly: "research",
  editor: "implementation",
  test_runner: "test-runner",
  testrunner: "test-runner",
};

const SUBAGENT_CAPABILITY_PROFILES: Record<
  Exclude<SubagentCapabilityProfileId, "custom">,
  SubagentCapabilityProfileDefinition
> = {
  research: {
    label: "Research",
    summary: "Read-only investigation and evidence gathering.",
    allow: ["read", "grep", "find", "ls", "group:web", "image"],
  },
  planner: {
    label: "Planner",
    summary: "Task decomposition, synthesis, and next-step planning without code changes.",
    allow: ["read", "grep", "find", "ls", "group:web", "image"],
  },
  implementation: {
    label: "Implementation",
    summary: "Editing, building, and fixing with code/tool execution.",
    allow: ["group:fs", "group:runtime", "group:web", "image"],
  },
  "test-runner": {
    label: "Test Runner",
    summary: "Verification, reproduction, and command execution without source edits.",
    allow: ["read", "grep", "find", "ls", "group:runtime", "group:web", "image"],
  },
};

function normalizeToolEntries(list?: string[]): string[] | undefined {
  if (!Array.isArray(list)) {
    return undefined;
  }
  const normalized = expandToolGroups(list)
    .map((entry) => normalizeToolName(entry))
    .filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

export function normalizeSubagentCapabilityProfile(
  value: unknown,
): SubagentCapabilityProfileId | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  const alias = PROFILE_ALIASES[trimmed];
  if (alias) {
    return alias;
  }
  return PROFILE_ORDER.has(trimmed as SubagentCapabilityProfileId)
    ? (trimmed as SubagentCapabilityProfileId)
    : undefined;
}

export function buildSubagentSessionToolPolicy(params: {
  profile?: SubagentCapabilityProfileId;
  toolAllow?: string[];
  toolDeny?: string[];
}): SandboxToolPolicy | undefined {
  const profileDefinition =
    params.profile && params.profile !== "custom"
      ? SUBAGENT_CAPABILITY_PROFILES[params.profile]
      : undefined;
  const allow = normalizeToolEntries([
    ...(profileDefinition?.allow ?? []),
    ...(params.toolAllow ?? []),
  ]);
  const deny = normalizeToolEntries(params.toolDeny);
  if (!allow && !deny) {
    return undefined;
  }
  return { allow, deny };
}

export function normalizeSubagentSessionToolPolicy(
  value: SandboxToolPolicy | undefined,
): SandboxToolPolicy | undefined {
  if (!value) {
    return undefined;
  }
  const allow = normalizeToolEntries(value.allow);
  const deny = normalizeToolEntries(value.deny);
  if (!allow && !deny) {
    return undefined;
  }
  return { allow, deny };
}

export function normalizeSubagentRequiredTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = normalizeToolEntries(
    value.filter((entry): entry is string => typeof entry === "string"),
  );
  return out && out.length > 0 ? out : undefined;
}

export function buildSubagentOrchestrationSection(params: {
  hasDelegate: boolean;
  hasSessionsSpawn: boolean;
  hasSessionsSend: boolean;
  hasSessionsHistory: boolean;
}): string[] {
  if (!params.hasSessionsSpawn) {
    return [];
  }
  return [
    "## Subagent Orchestration",
    params.hasDelegate
      ? "- Use `delegate` for one-shot tasks that need no tools or durable context; use `sessions_spawn` for longer, tool-using, or parallel work."
      : "- Use `sessions_spawn` for longer, tool-using, or parallel work.",
    "- Keep user-facing conversation ownership in the parent session. Subagents are workers, not spokespeople.",
    "- Communication contract: normal text you emit stays in your own session. To contact another worker, use `sessions_send`; to create one, use `sessions_spawn`.",
    "- Delivery is push-based: spawned workers announce completion automatically. Use `sessions_history` only when you need raw output or missing context, not as an inbox poll.",
    "- Workflow: choose a capability profile -> spawn with `label` + focused task -> pass `requiredTools` when tool needs are obvious -> continue your own work -> use the completion announcement when it arrives.",
    "- Capability profiles: `research` (read-only investigation), `planner` (decompose/analyze), `implementation` (edit/build/fix), `test-runner` (verification without edits), `custom` (bespoke tool allow/deny).",
    "- Preferred phase split: research worker gathers evidence -> planner/synthesis worker distills it into a self-contained spec -> implementation worker edits -> fresh verification worker proves it.",
    "- For synthesis, implementation, correction, and verification work, make worker prompts self-contained: include a purpose statement, concrete facts, and explicit done criteria.",
    "- Do not hand off with hidden-context phrases like `based on your findings` or `the bug we found` unless the facts are restated in the same prompt.",
    "- Capability guard: when tool needs are obvious, pass `requiredTools` so impossible assignments fail fast instead of failing mid-run.",
    params.hasSessionsSend
      ? "- Follow-up work: use `sessions_send` to continue an existing worker instead of spawning duplicates."
      : "",
    params.hasSessionsSpawn
      ? "- Fresh-verifier rule: after an implementation worker finishes, use `sessions_spawn` for verification. Do not ask the same worker to verify its own code."
      : "",
    params.hasSessionsSend
      ? "- Reuse rule: continue the same worker for corrections on the same slice; use a fresh worker when the approach changes, the next task is unrelated, or you need an independent verifier."
      : "",
    params.hasSessionsHistory
      ? "- Inspect before reassigning: use `sessions_history` if you need the worker's raw output or context."
      : "",
    params.hasSessionsSend
      ? "- Prefer stable `label` names for worker sessions when available; fall back to raw `sessionKey` only when no label exists."
      : "",
    params.hasSessionsSend
      ? '- Example follow-up: `sessions_send({ label: "schema-audit", message: "Focus only on refresh-token failures.", timeoutSeconds: 0 })`.'
      : "",
    '- Example spawn: `sessions_spawn({ label: "schema-audit", task: "Inspect auth edge cases in the API schema." })`.',
    "- When relaying work, send only the next action or delta. Do not paste the full original request again if the worker already has that context.",
    "- If a worker is blocked, it should report exactly what is missing. You decide whether to unblock, re-scope, or finish locally.",
    "- Silence from a subagent after it finishes is normal. Do not treat idle as failure.",
    "",
  ].filter(Boolean);
}

export function buildSubagentCapabilityContext(params: {
  profile?: SubagentCapabilityProfileId;
  requiredTools?: string[];
  sessionToolPolicy?: SandboxToolPolicy;
  resolvedTools?: string[];
}): string[] {
  const lines = [
    "## Operating Manual",
    "- Workflow: complete the assigned slice, then hand back a concise result to the parent agent.",
    "- If blocked, stop and report exactly what is missing instead of improvising around the blocker.",
    "- After you finish or are waiting on missing input, silence is correct. No heartbeats, filler, or side quests.",
  ];

  if (params.profile) {
    const definition =
      params.profile === "custom" ? undefined : SUBAGENT_CAPABILITY_PROFILES[params.profile];
    lines.push(
      "",
      "## Capability Profile",
      `- Profile: ${params.profile}`,
      definition
        ? `- Intent: ${definition.summary}`
        : "- Intent: follow the explicit tool policy for this session.",
    );
  }

  if (params.requiredTools && params.requiredTools.length > 0) {
    lines.push(`- Expected tools: ${params.requiredTools.join(", ")}`);
  }

  if (params.resolvedTools && params.resolvedTools.length > 0) {
    lines.push(`- Available tools in this session: ${params.resolvedTools.join(", ")}`);
  }

  if (params.sessionToolPolicy?.allow?.length) {
    lines.push(
      "- Tool access has been restricted to match this assignment. If a needed tool is unavailable, report that blocker clearly.",
    );
  }

  lines.push("");
  return lines;
}
