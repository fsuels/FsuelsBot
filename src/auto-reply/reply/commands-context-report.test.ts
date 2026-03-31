import { describe, expect, it } from "vitest";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { buildContextReply } from "./commands-context-report.js";

function makeReport(): SessionSystemPromptReport {
  return {
    source: "run",
    generatedAt: 0,
    workspaceDir: "/tmp/project",
    bootstrapMaxChars: 4_000,
    sandbox: { mode: "off", sandboxed: false },
    systemPrompt: {
      chars: 800,
      projectContextChars: 200,
      nonProjectContextChars: 600,
    },
    injectedWorkspaceFiles: [],
    skills: { promptChars: 0, availableCount: 0, loadedCount: 0, entries: [] },
    tools: { listChars: 120, schemaChars: 400, entries: [] },
    modelView: {
      branchHistoryMessages: 10,
      branchHistoryTokens: 900,
      scopedHistoryMessages: 4,
      scopedHistoryTokens: 300,
      sanitizedHistoryMessages: 4,
      sanitizedHistoryTokens: 300,
      validatedHistoryMessages: 4,
      validatedHistoryTokens: 300,
      limitedHistoryMessages: 4,
      limitedHistoryTokens: 300,
      projectedHistoryMessages: 3,
      projectedHistoryTokens: 250,
      taskScoped: true,
      dmHistoryLimit: 24,
      truncatedToolResults: 1,
      systemPromptTokens: 200,
      toolSchemaTokens: 100,
      projectedTotalTokens: 550,
      contextWindowTokens: 2_000,
      contextPressure: 0.275,
      historyStages: [
        {
          key: "branch",
          label: "Branch history",
          messages: 10,
          tokens: 900,
          changed: false,
          savingsTokens: 0,
        },
        {
          key: "scoped",
          label: "Task-scoped history",
          messages: 4,
          tokens: 300,
          changed: true,
          savingsTokens: 600,
        },
        {
          key: "sanitized",
          label: "Sanitized history",
          messages: 4,
          tokens: 300,
          changed: false,
          savingsTokens: 0,
        },
        {
          key: "validated",
          label: "Validated turns",
          messages: 4,
          tokens: 300,
          changed: false,
          savingsTokens: 0,
        },
        {
          key: "limited",
          label: "DM-limited history",
          messages: 4,
          tokens: 300,
          changed: false,
          savingsTokens: 0,
        },
        {
          key: "projected",
          label: "Projected model payload",
          messages: 3,
          tokens: 250,
          changed: true,
          savingsTokens: 50,
        },
      ],
    },
  };
}

function buildParams(commandBodyNormalized: string): HandleCommandsParams {
  return {
    ctx: {} as HandleCommandsParams["ctx"],
    cfg: {} as HandleCommandsParams["cfg"],
    command: {
      surface: "whatsapp",
      channel: "whatsapp",
      ownerList: [],
      senderIsOwner: true,
      isAuthorizedSender: true,
      rawBodyNormalized: commandBodyNormalized,
      commandBodyNormalized,
    },
    directives: {} as HandleCommandsParams["directives"],
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionEntry: {
      updatedAt: 0,
      totalTokens: 1_234,
      systemPromptReport: makeReport(),
    },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp/project",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "openai",
    model: "gpt-test",
    contextTokens: 2_000,
    isGroup: false,
  } as HandleCommandsParams;
}

describe("buildContextReply", () => {
  it("includes the projected model-visible breakdown in list mode", async () => {
    const reply = await buildContextReply(buildParams("/context list"));

    expect(reply.text).toContain("Model-visible payload: 550 tok / 2,000 tok window (27.5%)");
    expect(reply.text).toContain("Branch history: 10 messages / 900 tok");
    expect(reply.text).toContain("Task-scoped history: 4 messages / 300 tok (active)");
    expect(reply.text).toContain("Model-visible history: 3 messages / 250 tok");
    expect(reply.text).toContain("DM limit=24 | truncated tool results=1 | compactions=0");
    expect(reply.text).toContain("Hidden context rewrites:");
    expect(reply.text).toContain("Task-scoped history: 10 msg / 900 tok -> 4 msg / 300 tok");
  });
});
