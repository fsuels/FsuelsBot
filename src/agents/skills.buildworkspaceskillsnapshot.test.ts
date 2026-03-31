import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkspaceSkillSnapshot } from "./skills.js";

async function _writeSkill(params: {
  dir: string;
  name: string;
  description: string;
  metadata?: string;
  frontmatterExtra?: string;
  body?: string;
}) {
  const { dir, name, description, metadata, frontmatterExtra, body } = params;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---
name: ${name}
description: ${description}${metadata ? `\nmetadata: ${metadata}` : ""}
${frontmatterExtra ?? ""}
---

${body ?? `# ${name}\n`}
`,
    "utf-8",
  );
}

describe("buildWorkspaceSkillSnapshot", () => {
  it("returns an empty snapshot when skills dirs are missing", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));

    const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });

    expect(snapshot.prompt).toBe("");
    expect(snapshot.skills).toEqual([]);
  });

  it("omits disable-model-invocation skills from the prompt", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));
    await _writeSkill({
      dir: path.join(workspaceDir, "skills", "visible-skill"),
      name: "visible-skill",
      description: "Visible skill",
    });
    await _writeSkill({
      dir: path.join(workspaceDir, "skills", "hidden-skill"),
      name: "hidden-skill",
      description: "Hidden skill",
      frontmatterExtra: "disable-model-invocation: true",
    });

    const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });

    expect(snapshot.prompt).toContain("visible-skill");
    expect(snapshot.prompt).not.toContain("hidden-skill");
    expect(snapshot.skills.map((skill) => skill.name).toSorted()).toEqual([
      "hidden-skill",
      "visible-skill",
    ]);
  });

  it("filters path-scoped skills when activation paths are provided", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-"));
    await _writeSkill({
      dir: path.join(workspaceDir, "skills", "always-visible"),
      name: "always-visible",
      description: "General helper",
    });
    await _writeSkill({
      dir: path.join(workspaceDir, "skills", "docs-only"),
      name: "docs-only",
      description: "Docs helper",
      frontmatterExtra: 'paths: ["docs/**/*.md", "*.mdx"]',
    });

    const defaultSnapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    expect(defaultSnapshot.prompt).toContain("always-visible");
    expect(defaultSnapshot.prompt).toContain("docs-only");

    const hiddenSnapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      eligibility: {
        activationPaths: ["src/app.ts"],
      },
    });
    expect(hiddenSnapshot.prompt).toContain("always-visible");
    expect(hiddenSnapshot.prompt).not.toContain("docs-only");

    const activeSnapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      eligibility: {
        activationPaths: ["docs/getting-started.md"],
      },
    });
    expect(activeSnapshot.prompt).toContain("docs-only");
  });
});
