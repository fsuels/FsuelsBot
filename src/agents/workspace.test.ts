import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import {
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  loadWorkspaceBootstrapFiles,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("uses OPENCLAW_HOME for default workspace resolution", () => {
    const dir = resolveDefaultAgentWorkspaceDir({
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(path.join(path.resolve("/srv/openclaw-home"), ".openclaw", "workspace"));
  });
});

describe("loadWorkspaceBootstrapFiles", () => {
  it("includes MEMORY.md when present", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "MEMORY.md", content: "memory" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe("memory");
  });

  it("includes memory.md when MEMORY.md is absent", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "memory.md", content: "alt" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe("alt");
  });

  it("omits memory entries when no memory files exist", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

    expect(memoryEntries).toHaveLength(0);
  });

  it("resolves nested includes with provenance and strips frontmatter/comments", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, "partials"), { recursive: true });
    await writeWorkspaceFile({
      dir: tempDir,
      name: "AGENTS.md",
      content: [
        "---",
        'paths: ["src/**"]',
        "---",
        "",
        "Base rules",
        '@include "./partials/shared.md"',
      ].join("\n"),
    });
    await fs.writeFile(
      path.join(tempDir, "partials", "shared.md"),
      ["---", 'paths: ["src/**"]', "---", "", "<!-- hidden -->", "Shared rules"].join("\n"),
      "utf-8",
    );
    const workspaceReal = await fs.realpath(tempDir);

    const files = await loadWorkspaceBootstrapFiles(tempDir, {
      targetPath: path.join(tempDir, "src", "feature"),
    });
    const agents = files.find((file) => file.name === "AGENTS.md");

    expect(agents?.content).toBe("Base rules\nShared rules");
    expect(agents?.rawContent).toContain('paths: ["src/**"]');
    expect(agents?.provenance).toEqual([
      expect.objectContaining({
        path: path.join(workspaceReal, "AGENTS.md"),
        rawChars: expect.any(Number),
        transformedChars: "Base rules\nShared rules".length,
      }),
      expect.objectContaining({
        path: path.join(workspaceReal, "partials", "shared.md"),
        parentInclude: path.join(workspaceReal, "AGENTS.md"),
        transformedChars: "Shared rules".length,
      }),
    ]);
  });

  it("skips conditional instruction files when target paths do not match", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({
      dir: tempDir,
      name: "AGENTS.md",
      content: ["---", 'paths: ["src/**"]', "---", "", "Scoped rules"].join("\n"),
    });

    const files = await loadWorkspaceBootstrapFiles(tempDir, {
      targetPath: path.join(tempDir, "docs"),
    });
    const agents = files.find((file) => file.name === "AGENTS.md");

    expect(agents?.missing).toBe(false);
    expect(agents?.content).toBeUndefined();
  });

  it("blocks external includes outside the workspace", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    const externalDir = await makeTempWorkspace("openclaw-external-");
    const externalPath = await writeWorkspaceFile({
      dir: externalDir,
      name: "outside.md",
      content: "outside",
    });
    const warnings: string[] = [];
    await writeWorkspaceFile({
      dir: tempDir,
      name: "AGENTS.md",
      content: `Base\n@include "${externalPath}"`,
    });

    const files = await loadWorkspaceBootstrapFiles(tempDir, {
      warn: (message) => warnings.push(message),
    });
    const agents = files.find((file) => file.name === "AGENTS.md");

    expect(agents?.content).toBe("Base");
    expect(
      warnings.some((message) =>
        message.includes("workspace instruction include blocked outside workspace"),
      ),
    ).toBe(true);
  });

  it("deduplicates symlinked include aliases", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, "partials"), { recursive: true });
    const realPath = path.join(tempDir, "partials", "real.md");
    const aliasPath = path.join(tempDir, "partials", "alias.md");
    await fs.writeFile(realPath, "Shared rules", "utf-8");
    await fs.symlink(realPath, aliasPath);
    const warnings: string[] = [];
    await writeWorkspaceFile({
      dir: tempDir,
      name: "AGENTS.md",
      content: ['@include "./partials/real.md"', '@include "./partials/alias.md"'].join("\n"),
    });

    const files = await loadWorkspaceBootstrapFiles(tempDir, {
      warn: (message) => warnings.push(message),
    });
    const agents = files.find((file) => file.name === "AGENTS.md");

    expect(agents?.content).toBe("Shared rules");
    expect(
      warnings.some((message) =>
        message.includes("workspace instruction include skipped duplicate path"),
      ),
    ).toBe(true);
  });
});
