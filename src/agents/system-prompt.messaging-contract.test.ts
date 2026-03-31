import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

describe("buildAgentSystemPrompt messaging contract", () => {
  it("teaches label-first cross-session messaging", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["sessions_send"],
    });

    expect(prompt).toContain(
      "use `sessions_send({ label, message })` when a worker has a stable label",
    );
    expect(prompt).toContain("Send only the next action or delta");
  });

  it("adds subagent orchestration guidance when worker tools are available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["delegate", "sessions_spawn", "sessions_send", "sessions_history"],
    });

    expect(prompt).toContain("## Subagent Orchestration");
    expect(prompt).toContain(
      "Your normal text output is not visible to other agents. To communicate with another worker, use `sessions_send`.",
    );
    expect(prompt).toContain("Messages from workers are delivered automatically");
    expect(prompt).toContain('sessions_send({ label: "schema-audit"');
    expect(prompt).toContain('sessions_spawn({ label: "schema-audit"');
  });
});

