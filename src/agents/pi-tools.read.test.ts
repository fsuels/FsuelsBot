import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceReadTool } from "./pi-tools.read.js";

function getText(result?: { content?: Array<{ type: string; text?: string }> }): string {
  return (
    result?.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n") ?? ""
  );
}

describe("pi-tools.read", () => {
  it("returns line-numbered text slices with stable metadata", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      await fs.writeFile(path.join(tmpDir, "sample.txt"), "alpha\nbeta\ngamma", "utf8");
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-1", {
        path: "sample.txt",
        offset: 2,
        limit: 2,
      });

      expect(getText(result)).toContain("2\tbeta");
      expect(getText(result)).toContain("3\tgamma");
      expect(getText(result)).not.toContain("1\talpha");
      expect(result.details).toMatchObject({
        kind: "text",
        startLine: 2,
        endLine: 3,
        numLines: 2,
        totalLines: 3,
        requestedOffset: 2,
        requestedLimit: 2,
        truncated: false,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns an explicit empty-file result", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      await fs.writeFile(path.join(tmpDir, "empty.txt"), "", "utf8");
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-2", { path: "empty.txt" });

      expect(getText(result)).toContain("File is empty");
      expect(result.details).toMatchObject({
        kind: "empty",
        totalLines: 0,
        requestedOffset: 1,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns an explicit past-EOF result instead of a blank payload", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      await fs.writeFile(path.join(tmpDir, "short.txt"), "one\ntwo", "utf8");
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-3", {
        path: "short.txt",
        offset: 9,
      });

      expect(getText(result)).toContain("beyond end of file");
      expect(result.details).toMatchObject({
        kind: "past_eof",
        totalLines: 2,
        requestedOffset: 9,
        suggestedOffset: 2,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks dangerous device paths before reading", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-4", { path: "/dev/zero" });
      const details = result.details as Record<string, unknown>;

      expect(details.error_code).toBe("unsafe_path_blocked");
      expect(getText(result)).toContain("hang or stream forever");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("blocks UNC/network paths before filesystem access", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-5", {
        path: "\\\\server\\share\\report.txt",
      });
      const details = result.details as Record<string, unknown>;

      expect(details.error_code).toBe("network_path_blocked");
      expect(getText(result)).toContain("UNC/network path");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid offset values with a structured error", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      await fs.writeFile(path.join(tmpDir, "sample.txt"), "alpha\nbeta", "utf8");
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-5b", {
        path: "sample.txt",
        offset: 0,
      });
      const details = result.details as Record<string, unknown>;

      expect(details.error_code).toBe("invalid_read_range");
      expect(getText(result)).toContain("offset");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported PDF reads with guidance", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      await fs.writeFile(path.join(tmpDir, "manual.pdf"), "%PDF-1.7\nfake", "utf8");
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-6", { path: "manual.pdf" });
      const details = result.details as Record<string, unknown>;

      expect(details.error_code).toBe("invalid_file_type");
      expect(getText(result)).toContain("does not support PDFs");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported binary reads with guidance", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-"));
    try {
      await fs.writeFile(
        path.join(tmpDir, "archive.bin"),
        Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]),
      );
      const readTool = createWorkspaceReadTool(tmpDir, { cwd: tmpDir });

      const result = await readTool.execute("read-7", { path: "archive.bin" });
      const details = result.details as Record<string, unknown>;

      expect(details.error_code).toBe("invalid_file_type");
      expect(getText(result)).toContain("only supports text files and images");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
