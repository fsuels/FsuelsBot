import { beforeEach, describe, expect, it, vi } from "vitest";

const checkZcaAuthenticated = vi.fn();
const runZca = vi.fn();
const parseJsonOutput = vi.fn();

vi.mock("./accounts.js", () => ({
  checkZcaAuthenticated,
}));

vi.mock("./zca.js", () => ({
  runZca,
  parseJsonOutput,
}));

const { executeZalouserTool } = await import("./tool.js");

describe("executeZalouserTool", () => {
  beforeEach(() => {
    checkZcaAuthenticated.mockReset();
    runZca.mockReset();
    parseJsonOutput.mockReset();
  });

  it("returns an auth recovery payload when the session is missing", async () => {
    checkZcaAuthenticated.mockResolvedValue(false);

    const result = await executeZalouserTool("tool-call", {
      action: "send",
      threadId: "123",
      message: "hello",
    });

    expect(result.details).toMatchObject({
      ok: false,
      code: "authentication_required",
      authTool: "zalouser_authenticate",
    });
    expect(result.content[0]?.text).toContain("zalouser_authenticate");
    expect(runZca).not.toHaveBeenCalled();
  });

  it("still reports auth status directly", async () => {
    runZca.mockResolvedValue({
      ok: true,
      stdout: "authenticated",
      stderr: "",
      exitCode: 0,
    });

    const result = await executeZalouserTool("tool-call", {
      action: "status",
    });

    expect(result.details).toMatchObject({
      authenticated: true,
      profile: "default",
    });
  });
});
