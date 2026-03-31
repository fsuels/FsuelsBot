import { describe, expect, it } from "vitest";
import { applyToolContracts } from "../tool-contracts.js";
import { createSessionsSpawnTool } from "./sessions-spawn-tool.js";

describe("sessions_spawn validation", () => {
  it("rejects invalid whitespace-only labels before execution", async () => {
    const tool = applyToolContracts(
      createSessionsSpawnTool({
        agentSessionKey: "main",
        agentChannel: "whatsapp",
      }),
    );

    const result = await tool.execute("call-invalid-label", {
      task: "do thing",
      label: "   ",
    });

    expect(result.details).toMatchObject({
      ok: false,
      success: false,
      code: "invalid_input",
      tool: "sessions_spawn",
      message: "invalid label: empty",
    });
  });

  it("rejects structured implementation prompts that rely on hidden context", async () => {
    const tool = applyToolContracts(
      createSessionsSpawnTool({
        agentSessionKey: "main",
        agentChannel: "whatsapp",
      }),
    );

    const result = await tool.execute("call-hidden-context", {
      task: "Based on your findings, fix the bug.",
      taskType: "implementation",
      doneCriteria: ["Patch the failing behavior and summarize the change."],
    });

    expect(result.details).toMatchObject({
      status: "error",
    });
    expect((result.details as { error?: string }).error).toContain(
      "Structured worker tasks must restate concrete facts",
    );
  });
});
