import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import { createOpenClawFindTool } from "./pi-tools.find.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { executeToolWithContract } from "./tool-contract.js";
import { applyToolContracts } from "./tool-contracts.js";

async function runFindTool(
  tool: ReturnType<typeof createOpenClawFindTool>,
  rawInput: unknown,
  signal?: AbortSignal,
) {
  return await executeToolWithContract({
    tool,
    rawInput,
    context: {
      toolCallId: "call-find",
      source: "direct",
      signal,
    },
    invoke: async (input) => await tool.execute("call-find", input, signal),
  });
}

async function runFindValidation(
  tool: ReturnType<typeof createOpenClawFindTool>,
  rawInput: unknown,
  signal?: AbortSignal,
) {
  return await applyToolContracts(tool).execute("call-find", rawInput, signal);
}

describe("createOpenClawFindTool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unknown input keys", async () => {
    const tool = createOpenClawFindTool({ workspaceRoot: "/tmp" });

    const result = await runFindValidation(tool, { pattern: "*.ts", nope: true });
    const details = result.details as {
      code?: string;
      issues?: Array<{ path?: string; message?: string }>;
    };

    expect(details.code).toBe("invalid_input");
    expect(details.issues?.some((issue) => issue.path === "/nope")).toBe(true);
  });

  it.each(["undefined", "null"])('rejects "%s" sentinel path strings', async (value) => {
    const tool = createOpenClawFindTool({ workspaceRoot: "/tmp" });

    const result = await runFindValidation(tool, { pattern: "*.ts", path: value });
    const details = result.details as {
      code?: string;
      reasonCode?: string;
      message?: string;
    };

    expect(details.code).toBe("invalid_input");
    expect(details.reasonCode).toBe("PATH_SENTINEL_STRING");
    expect(details.message).toMatch(/omit/i);
  });

  it("returns DIR_NOT_FOUND for missing directories and suggests likely typos", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-find-missing-"));
    await fs.mkdir(path.join(workspaceRoot, "source"));
    const tool = createOpenClawFindTool({ workspaceRoot });

    const result = await runFindValidation(tool, { pattern: "*.ts", path: "sorce" });
    const details = result.details as {
      code?: string;
      reasonCode?: string;
      suggestion?: string;
      message?: string;
    };

    expect(details.code).toBe("not_found");
    expect(details.reasonCode).toBe("DIR_NOT_FOUND");
    expect(details.suggestion).toBe("source");
    expect(details.message).toContain("source");
  });

  it("returns PATH_NOT_DIRECTORY when the path points to a file", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-find-file-"));
    await fs.writeFile(path.join(workspaceRoot, "notes.txt"), "hello", "utf-8");
    const tool = createOpenClawFindTool({ workspaceRoot });

    const result = await runFindValidation(tool, { pattern: "*.ts", path: "notes.txt" });
    const details = result.details as {
      code?: string;
      reasonCode?: string;
      message?: string;
    };

    expect(details.code).toBe("precondition_failed");
    expect(details.reasonCode).toBe("PATH_NOT_DIRECTORY");
    expect(details.message).toBe("Path is not a directory.");
  });

  it("does not leak path details on permission errors", async () => {
    const tool = createOpenClawFindTool({
      workspaceRoot: "/tmp",
      stat: async () => {
        const error = new Error("EACCES: denied /private/workspace/secrets");
        (error as Error & { code?: string }).code = "EACCES";
        throw error;
      },
    });

    const result = await runFindValidation(tool, {
      pattern: "*.ts",
      path: "private/workspace/secrets",
    });
    const details = result.details as {
      code?: string;
      reasonCode?: string;
      message?: string;
    };
    const text = result.content.find((block) => block.type === "text");
    const rendered = text && "text" in text ? text.text : "";

    expect(details.code).toBe("precondition_failed");
    expect(details.reasonCode).toBe("PATH_ACCESS_DENIED");
    expect(details.message).toBe("Cannot access directory.");
    expect(rendered).not.toContain("/private/workspace/secrets");
  });

  it("blocks UNC/network paths before probing the filesystem", async () => {
    const stat = vi.fn();
    const tool = createOpenClawFindTool({
      workspaceRoot: "/tmp",
      stat,
    });

    const result = await runFindValidation(tool, {
      pattern: "*.ts",
      path: "//server/share",
    });
    const details = result.details as {
      code?: string;
      reasonCode?: string;
    };

    expect(details.code).toBe("precondition_failed");
    expect(details.reasonCode).toBe("NETWORK_PATH_BLOCKED");
    expect(stat).not.toHaveBeenCalled();
  });

  it("cancels long-running custom searches", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-find-abort-"));
    const controller = new AbortController();
    const tool = createOpenClawFindTool({
      workspaceRoot,
      operations: {
        exists: () => true,
        glob: () =>
          new Promise<string[]>((resolve) => {
            setTimeout(() => resolve(["slow.ts"]), 200);
          }),
      },
    });

    const timer = setTimeout(() => controller.abort(), 20);
    await expect(runFindTool(tool, { pattern: "*.ts" }, controller.signal)).rejects.toThrow(
      /Search aborted/,
    );
    clearTimeout(timer);
  });

  it("caps results and marks them as truncated", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-find-cap-"));
    const tool = createOpenClawFindTool({
      workspaceRoot,
      operations: {
        exists: () => true,
        glob: () => ["a.ts", "b.ts", "c.ts"],
      },
    });

    const result = await runFindTool(tool, { pattern: "*.ts", limit: 2 });
    const details = result.details as {
      returnedCount?: number;
      filenames?: string[];
      truncated?: boolean;
    };
    const text = result.content.find((block) => block.type === "text");
    const rendered = text && "text" in text ? text.text : "";

    expect(details.returnedCount).toBe(2);
    expect(details.filenames).toEqual(["a.ts", "b.ts"]);
    expect(details.truncated).toBe(true);
    expect(rendered).toContain("Results are truncated");
  });

  it("normalizes returned paths relative to the workspace root when possible", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-find-relative-"));
    const srcDir = path.join(workspaceRoot, "src");
    await fs.mkdir(srcDir);
    const tool = createOpenClawFindTool({
      workspaceRoot,
      operations: {
        exists: () => true,
        glob: () => [path.join(srcDir, "main.ts")],
      },
    });

    const result = await runFindTool(tool, { pattern: "*.ts", path: "src" });
    const details = result.details as {
      filenames?: string[];
      truncated?: boolean;
    };

    expect(details.filenames).toEqual(["src/main.ts"]);
    expect(details.truncated).toBe(false);
  });

  it("returns a stable zero-match response", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-find-empty-"));
    const tool = createOpenClawFindTool({
      workspaceRoot,
      operations: {
        exists: () => true,
        glob: () => [],
      },
    });

    const result = await runFindTool(tool, { pattern: "*.ts" });
    const details = result.details as {
      returnedCount?: number;
      filenames?: string[];
      truncated?: boolean;
    };
    const text = result.content.find((block) => block.type === "text");
    const rendered = text && "text" in text ? text.text : "";

    expect(details.returnedCount).toBe(0);
    expect(details.filenames).toEqual([]);
    expect(details.truncated).toBe(false);
    expect(rendered).toBe("No files found");
  });

  it("surfaces find in the coding profile tool set", () => {
    const tools = createOpenClawCodingTools({
      config: {
        tools: {
          profile: "coding",
        },
      },
      workspaceDir: "/tmp/find-profile",
      agentDir: "/tmp/find-profile-agent",
    });

    expect(tools.map((tool) => tool.name)).toContain("find");
  });
});
