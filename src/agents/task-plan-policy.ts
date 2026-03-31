import type { ToolInvocationContract } from "./tool-contract.js";

export const TASK_PLAN_INVOCATION_CONTRACT: ToolInvocationContract = {
  usagePolicy: "semantic_ok",
  sideEffectLevel: "medium",
  whenToUse: [
    "You are working a shared task-board task that needs a durable implementation plan.",
    "You need a canonical, machine-readable plan record before asking a human to approve execution.",
    "You want to read the current persisted plan/approval state without opening the raw markdown file first.",
  ],
  whenNotToUse: [
    "Do not use it for research-only exploration, codebase understanding, or note taking without a concrete implementation plan.",
    "Do not request approval until the implementation plan is complete enough to execute.",
    "Do not use it as a generic question tool to ask whether an idea sounds okay.",
  ],
  preconditions: [
    "Use tasks_list/task_get first so you know which shared task you are planning.",
    "If requirements are still unresolved, ask the user for clarification before request_approval.",
  ],
  behaviorSummary:
    "Reads, saves, and submits durable task-board implementation plans backed by the task card plan path and persisted approval metadata.",
  parametersSummary: [
    "action=get reads the persisted plan and approval state.",
    "action=save writes the canonical plan file and resets approval back to draft if the plan changed.",
    "action=request_approval submits the current saved plan for human approval and marks the task as waiting_human.",
    "taskId is optional; when omitted, the active shared-board task in lanes.bot_current is used.",
    "plan is the full markdown plan text for save or an optional inline replacement for request_approval.",
  ],
};

const POSITIVE_EXAMPLES = [
  "After task_get shows a task file/plan path and you have finished a concrete rollout plan, call task_plan with action=save.",
  "When the saved plan is implementation-ready and all major unknowns are resolved, call task_plan with action=request_approval.",
  "When you inherit a shared task and need to know whether the plan is draft, awaiting approval, approved, or rejected, call task_plan with action=get.",
] as const;

const NEGATIVE_EXAMPLES = [
  "Do not call task_plan while you are still exploring the repo to understand the problem.",
  'Do not call task_plan request_approval for a vague idea like "I might refactor this" without concrete steps, risks, and verification.',
  "Do not use task_plan as a substitute for asking the user clarifying questions when requirements are missing.",
] as const;

export function buildTaskPlanOperatorManual(): string {
  return [
    "Use task_plan only for durable implementation planning on shared task-board work.",
    "",
    "Positive examples:",
    ...POSITIVE_EXAMPLES.map((entry) => `- ${entry}`),
    "",
    "Negative examples:",
    ...NEGATIVE_EXAMPLES.map((entry) => `- ${entry}`),
  ].join("\n");
}
