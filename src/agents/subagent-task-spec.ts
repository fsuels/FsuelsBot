import type { SubagentCapabilityProfileId } from "./subagent-policy.js";

export const SUBAGENT_TASK_TYPES = [
  "research",
  "implementation",
  "correction",
  "verification",
] as const;

export type SubagentTaskType = (typeof SUBAGENT_TASK_TYPES)[number];

export type SubagentTaskSpecInput = {
  task: string;
  taskType?: unknown;
  purpose?: unknown;
  facts?: unknown;
  doneCriteria?: unknown;
  constraints?: unknown;
  commands?: unknown;
  filePaths?: unknown;
  symbols?: unknown;
  errors?: unknown;
  sourceTaskId?: unknown;
  allowFileChanges?: unknown;
  defaultTaskType?: SubagentTaskType;
};

export type SubagentTaskSpec = {
  taskType?: SubagentTaskType;
  taskSummary: string;
  taskText: string;
  isStructured: boolean;
  allowFileChanges: boolean;
  hiddenContextRefs: string[];
  facts: string[];
  doneCriteria: string[];
  constraints: string[];
  commands: string[];
  filePaths: string[];
  symbols: string[];
  errors: string[];
  sourceTaskId?: string;
};

const HIDDEN_CONTEXT_PATTERNS = [
  { label: "based on your findings", pattern: /\bbased on your findings\b/i },
  { label: "based on the findings", pattern: /\bbased on the findings\b/i },
  { label: "as discussed", pattern: /\bas discussed\b/i },
  { label: "the bug we found", pattern: /\bthe bug we found\b/i },
  { label: "the recent changes", pattern: /\bthe recent changes\b/i },
];

const TASK_TYPE_ALIASES: Record<string, SubagentTaskType> = {
  fix: "correction",
  fixing: "correction",
  plan: "research",
  planner: "research",
  spec: "research",
  verify: "verification",
  verification_only: "verification",
  test: "verification",
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function summarizeTask(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 240);
}

function formatSection(title: string, values: string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  return [title, ...values.map((value) => `- ${value}`), ""];
}

export function normalizeSubagentTaskType(value: unknown): SubagentTaskType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "_");
  if (!normalized) {
    return undefined;
  }
  const alias = TASK_TYPE_ALIASES[normalized];
  if (alias) {
    return alias;
  }
  return SUBAGENT_TASK_TYPES.includes(normalized as SubagentTaskType)
    ? (normalized as SubagentTaskType)
    : undefined;
}

export function inferTaskTypeFromProfile(
  profile?: SubagentCapabilityProfileId,
): SubagentTaskType | undefined {
  switch (profile) {
    case "research":
    case "planner":
      return "research";
    case "implementation":
      return "implementation";
    case "test-runner":
      return "verification";
    default:
      return undefined;
  }
}

export function inferProfileFromTaskType(
  taskType?: SubagentTaskType,
): SubagentCapabilityProfileId | undefined {
  switch (taskType) {
    case "research":
      return "research";
    case "implementation":
    case "correction":
      return "implementation";
    case "verification":
      return "test-runner";
    default:
      return undefined;
  }
}

export function listHiddenContextReferences(text: string): string[] {
  if (!text.trim()) {
    return [];
  }
  return HIDDEN_CONTEXT_PATTERNS.filter((entry) => entry.pattern.test(text)).map(
    (entry) => entry.label,
  );
}

export function validateTaskTypeProfileCompatibility(params: {
  taskType?: SubagentTaskType;
  profile?: SubagentCapabilityProfileId;
}): string | undefined {
  const { taskType, profile } = params;
  if (!taskType || !profile || profile === "custom") {
    return undefined;
  }
  if (taskType === "research" && profile !== "research" && profile !== "planner") {
    return `Task type "${taskType}" is incompatible with subagent profile "${profile}". Use a read-only research/planner profile.`;
  }
  if (taskType === "verification" && profile !== "test-runner") {
    return `Task type "${taskType}" is incompatible with subagent profile "${profile}". Use the read-only test-runner profile or custom tool policy.`;
  }
  if (
    (taskType === "implementation" || taskType === "correction") &&
    profile !== "implementation"
  ) {
    return `Task type "${taskType}" is incompatible with subagent profile "${profile}". Use the implementation profile or custom tool policy.`;
  }
  return undefined;
}

function buildVerificationDoneCriteria(doneCriteria: string[]): string[] {
  return Array.from(
    new Set([
      ...doneCriteria,
      "Run the relevant tests or verification commands and report the concrete evidence.",
      "Exercise at least one edge case or error path during verification.",
      "Investigate failures with evidence before calling them unrelated.",
    ]),
  );
}

export function buildSubagentTaskSpec(
  input: SubagentTaskSpecInput,
): { ok: true; value: SubagentTaskSpec } | { ok: false; error: string } {
  const task = normalizeText(input.task);
  if (!task) {
    return { ok: false, error: "task required" };
  }

  const explicitTaskType = normalizeSubagentTaskType(input.taskType);
  const taskType = explicitTaskType ?? input.defaultTaskType;
  const purpose = normalizeText(input.purpose) ?? task;
  const facts = normalizeTextList(input.facts);
  const doneCriteriaBase = normalizeTextList(input.doneCriteria);
  const constraints = normalizeTextList(input.constraints);
  const commands = normalizeTextList(input.commands);
  const filePaths = normalizeTextList(input.filePaths);
  const symbols = normalizeTextList(input.symbols);
  const errors = normalizeTextList(input.errors);
  const sourceTaskId = normalizeText(input.sourceTaskId);
  const allowFileChangesInput = normalizeBoolean(input.allowFileChanges);
  const hiddenContextRefs = listHiddenContextReferences(`${task}\n${purpose}`);

  const isStructured =
    Boolean(explicitTaskType) ||
    facts.length > 0 ||
    doneCriteriaBase.length > 0 ||
    constraints.length > 0 ||
    commands.length > 0 ||
    filePaths.length > 0 ||
    symbols.length > 0 ||
    errors.length > 0 ||
    sourceTaskId !== undefined ||
    allowFileChangesInput !== undefined ||
    normalizeText(input.purpose) !== undefined;

  if (!isStructured) {
    if (hiddenContextRefs.length > 0) {
      return {
        ok: false,
        error:
          "Task prompt depends on hidden context. Restate the concrete facts inline instead of phrases like " +
          hiddenContextRefs.map((entry) => `"${entry}"`).join(", ") +
          ".",
      };
    }
    return {
      ok: true,
      value: {
        taskType,
        taskSummary: summarizeTask(task),
        taskText: task,
        isStructured: false,
        allowFileChanges:
          allowFileChangesInput ?? !(taskType === "research" || taskType === "verification"),
        hiddenContextRefs,
        facts,
        doneCriteria: doneCriteriaBase,
        constraints,
        commands,
        filePaths,
        symbols,
        errors,
        sourceTaskId,
      },
    };
  }

  if (hiddenContextRefs.length > 0 && facts.length === 0) {
    return {
      ok: false,
      error:
        "Structured worker tasks must restate concrete facts when they reference prior context. Add facts instead of relying on " +
        hiddenContextRefs.map((entry) => `"${entry}"`).join(", ") +
        ".",
    };
  }

  if (taskType && taskType !== "research" && facts.length === 0) {
    return {
      ok: false,
      error: `Structured ${taskType} tasks require at least one explicit fact.`,
    };
  }

  const doneCriteria =
    taskType === "verification"
      ? buildVerificationDoneCriteria(doneCriteriaBase)
      : doneCriteriaBase;

  if (taskType && taskType !== "research" && doneCriteria.length === 0) {
    return {
      ok: false,
      error: `Structured ${taskType} tasks require explicit doneCriteria.`,
    };
  }

  const allowFileChanges =
    allowFileChangesInput ?? !(taskType === "research" || taskType === "verification");
  if (taskType === "research" && allowFileChanges) {
    return {
      ok: false,
      error: "Research workers must be read-only. Set allowFileChanges to false or omit it.",
    };
  }
  if (taskType === "verification" && allowFileChanges) {
    return {
      ok: false,
      error:
        'Verification workers must be read-only. Use taskType="correction" for follow-up fixes.',
    };
  }

  const lines = [
    "# Worker Task Spec",
    "",
    taskType ? `Task type: ${taskType}` : undefined,
    `Purpose: ${purpose}`,
    "",
    ...formatSection("Known Facts", facts),
    ...formatSection("Relevant Files", filePaths),
    ...formatSection("Relevant Symbols", symbols),
    ...formatSection("Known Errors", errors),
    ...formatSection("Constraints", constraints),
    ...formatSection("Suggested Commands", commands),
    ...formatSection("Done Criteria", doneCriteria),
    "File Modification",
    allowFileChanges
      ? "- Allowed: yes. Limit changes to the scope implied by the facts, files, and done criteria."
      : "- Allowed: no. Report findings only; do not modify files.",
    sourceTaskId ? `- Source task: ${sourceTaskId}` : undefined,
    "",
    "Final Handoff",
    "- Return a concise summary of what you accomplished or verified.",
    "- Include blockers or residual risks only if they are supported by evidence.",
    "",
  ].filter((line): line is string => Boolean(line));

  return {
    ok: true,
    value: {
      taskType,
      taskSummary: summarizeTask(purpose),
      taskText: lines.join("\n"),
      isStructured: true,
      allowFileChanges,
      hiddenContextRefs,
      facts,
      doneCriteria,
      constraints,
      commands,
      filePaths,
      symbols,
      errors,
      sourceTaskId,
    },
  };
}
