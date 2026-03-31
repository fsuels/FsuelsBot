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
});
