import { describe, expect, it } from "vitest";
import { createExecTool } from "./bash-tools.exec.js";

describe("exec sleep policy", () => {
  it("rejects direct shell sleep", async () => {
    const tool = createExecTool();

    await expect(
      tool.execute("call-sleep", {
        command: "sleep 5",
      }),
    ).rejects.toThrow(/Use the sleep tool instead of shell sleep/i);
  });

  it("rejects polling loops that sleep in exec", async () => {
    const tool = createExecTool();

    await expect(
      tool.execute("call-loop", {
        command: "while true; do echo waiting; sleep 5; done",
      }),
    ).rejects.toThrow(/Use the sleep tool instead of shell polling loops/i);
  });
});
