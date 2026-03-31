import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOpenClawCodingTools } from "./pi-tools.js";

vi.mock("../plugins/tools.js", () => ({
  getPluginToolMeta: () => undefined,
  resolvePluginTools: () => [],
}));

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return { ...mod, getShellPathFromLoginShell: () => null };
});

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function getText(result?: { content?: Array<{ type: string; text?: string }> }) {
  return (
    result?.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

function getDetails<T extends object = Record<string, unknown>>(result?: {
  details?: unknown;
}): T | undefined {
  return result?.details && typeof result.details === "object" ? (result.details as T) : undefined;
}

describe("pi-tools write guards", () => {
  it("rejects full-file writes after only a partial read", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const fullPath = path.join(workspaceDir, "partial.txt");
      await fs.writeFile(fullPath, "one\ntwo\nthree\n", "utf8");

      const tools = createOpenClawCodingTools({ workspaceDir });
      const readTool = tools.find((tool) => tool.name === "read");
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(readTool).toBeDefined();
      expect(writeTool).toBeDefined();

      await readTool?.execute("partial-read", {
        path: "partial.txt",
        limit: 1,
      });
      const result = await writeTool?.execute("partial-write", {
        path: "partial.txt",
        content: "replaced\n",
      });

      expect(getDetails(result)?.error_code).toBe("partial_read_only");
      expect(getText(result)).toContain("Read the full file without offset/limit");
      expect(await fs.readFile(fullPath, "utf8")).toBe("one\ntwo\nthree\n");
    });
  });

  it("rejects stale writes and returns a diff against current content", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const fullPath = path.join(workspaceDir, "stale.txt");
      await fs.writeFile(fullPath, "before\n", "utf8");

      const tools = createOpenClawCodingTools({ workspaceDir });
      const readTool = tools.find((tool) => tool.name === "read");
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(readTool).toBeDefined();
      expect(writeTool).toBeDefined();

      await readTool?.execute("stale-read", { path: "stale.txt" });
      await fs.writeFile(fullPath, "current\n", "utf8");

      const result = await writeTool?.execute("stale-write", {
        path: "stale.txt",
        content: "attempted\n",
      });
      const details = getDetails(result);

      expect(details?.error_code).toBe("file_changed_since_read");
      expect(details?.diff).toContain("-1 current");
      expect(details?.diff).toContain("+1 attempted");
      expect(await fs.readFile(fullPath, "utf8")).toBe("current\n");
    });
  });

  it("allows writes when only the timestamp changed after a full read", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const fullPath = path.join(workspaceDir, "mtime.txt");
      await fs.writeFile(fullPath, "same\n", "utf8");

      const tools = createOpenClawCodingTools({ workspaceDir });
      const readTool = tools.find((tool) => tool.name === "read");
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(readTool).toBeDefined();
      expect(writeTool).toBeDefined();

      await readTool?.execute("mtime-read", { path: "mtime.txt" });
      const now = new Date();
      const later = new Date(now.getTime() + 5_000);
      await fs.utimes(fullPath, now, later);

      const result = await writeTool?.execute("mtime-write", {
        path: "mtime.txt",
        content: "next\n",
      });

      expect(getDetails(result)?.operation).toBe("update");
      expect(await fs.readFile(fullPath, "utf8")).toBe("next\n");
    });
  });

  it("blocks slash-style network paths before touching the filesystem", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const tools = createOpenClawCodingTools({ workspaceDir });
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(writeTool).toBeDefined();

      const result = await writeTool?.execute("slash-unc", {
        path: "//server/share/report.txt",
        content: "x",
      });

      expect(getDetails(result)?.error_code).toBe("network_path_blocked");
    });
  });

  it("creates parent directories and returns a bounded preview with correct line counts", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const tools = createOpenClawCodingTools({ workspaceDir });
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(writeTool).toBeDefined();

      const result = await writeTool?.execute("create-preview", {
        path: "nested/new.txt",
        content: "alpha\nbeta\n",
      });
      const details = getDetails(result);

      expect(details?.operation).toBe("create");
      expect(details?.linesWritten).toBe(2);
      expect(details?.preview).toBe("alpha\nbeta");
      expect(details?.previewOverflowLines).toBe(0);
      expect(await fs.readFile(path.join(workspaceDir, "nested/new.txt"), "utf8")).toBe(
        "alpha\nbeta\n",
      );
    });
  });

  it("refreshes tracked state after a write so a second rewrite can proceed", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const fullPath = path.join(workspaceDir, "refresh.txt");
      await fs.writeFile(fullPath, "before\n", "utf8");

      const tools = createOpenClawCodingTools({ workspaceDir });
      const readTool = tools.find((tool) => tool.name === "read");
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(readTool).toBeDefined();
      expect(writeTool).toBeDefined();

      await readTool?.execute("refresh-read", { path: "refresh.txt" });
      await writeTool?.execute("refresh-write-1", {
        path: "refresh.txt",
        content: "middle\n",
      });
      const second = await writeTool?.execute("refresh-write-2", {
        path: "refresh.txt",
        content: "after\n",
      });

      expect(getDetails(second)?.operation).toBe("update");
      expect(await fs.readFile(fullPath, "utf8")).toBe("after\n");
    });
  });

  it("returns a structured diff for successful updates", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const fullPath = path.join(workspaceDir, "diff.txt");
      await fs.writeFile(fullPath, "before\n", "utf8");

      const tools = createOpenClawCodingTools({ workspaceDir });
      const readTool = tools.find((tool) => tool.name === "read");
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(readTool).toBeDefined();
      expect(writeTool).toBeDefined();

      await readTool?.execute("diff-read", { path: "diff.txt" });
      const result = await writeTool?.execute("diff-write", {
        path: "diff.txt",
        content: "after\n",
      });
      const details = getDetails(result);

      expect(details?.operation).toBe("update");
      expect(details?.diff).toContain("-1 before");
      expect(details?.diff).toContain("+1 after");
      expect(details?.firstChangedLine).toBe(1);
    });
  });

  it("treats delete-after-read as stale instead of silently recreating the file", async () => {
    await withTempDir("openclaw-write-guards-", async (workspaceDir) => {
      const fullPath = path.join(workspaceDir, "deleted.txt");
      await fs.writeFile(fullPath, "before\n", "utf8");

      const tools = createOpenClawCodingTools({ workspaceDir });
      const readTool = tools.find((tool) => tool.name === "read");
      const writeTool = tools.find((tool) => tool.name === "write");
      expect(readTool).toBeDefined();
      expect(writeTool).toBeDefined();

      await readTool?.execute("deleted-read", { path: "deleted.txt" });
      await fs.rm(fullPath);

      const result = await writeTool?.execute("deleted-write", {
        path: "deleted.txt",
        content: "after\n",
      });

      expect(getDetails(result)?.error_code).toBe("file_changed_since_read");
      await expect(fs.stat(fullPath)).rejects.toBeDefined();
    });
  });
});
