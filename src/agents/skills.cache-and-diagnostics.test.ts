import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWorkspaceSkillCaches, loadWorkspaceSkillEntries } from "./skills.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skills-"));
  tempDirs.push(dir);
  return dir;
}

async function writeSkillFile(params: { dir: string; content: string }): Promise<void> {
  await fs.mkdir(params.dir, { recursive: true });
  await fs.writeFile(path.join(params.dir, "SKILL.md"), params.content, "utf-8");
}

function warnedWith(spy: ReturnType<typeof vi.spyOn>, text: string): boolean {
  return spy.mock.calls.some((call) =>
    call
      .map((value) => String(value))
      .join(" ")
      .includes(text),
  );
}

afterEach(async () => {
  clearWorkspaceSkillCaches();
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("workspace skill loading diagnostics and caching", () => {
  it("recovers a missing description from the first body paragraph", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkillFile({
      dir: path.join(workspaceDir, "skills", "demo-skill"),
      content: `---
name: demo-skill
---

# Demo Skill

Use this skill to do demo things for the current task.

- Extra detail that should not become the description.
`,
    });

    const entries = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.skill.name).toBe("demo-skill");
    expect(entries[0]?.skill.description).toBe(
      "Use this skill to do demo things for the current task.",
    );
  });

  it("keeps valid skills when a sibling skill file is malformed", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkillFile({
      dir: path.join(workspaceDir, "skills", "good-skill"),
      content: `---
name: good-skill
description: Healthy skill
---

# Good
`,
    });
    await writeSkillFile({
      dir: path.join(workspaceDir, "skills", "broken-skill"),
      content: `---
name: broken-skill
description: [
---

# Broken
`,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      });
      expect(entries.map((entry) => entry.skill.name)).toEqual(["good-skill"]);
      expect(warnedWith(warnSpy, "skill loader warning")).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when a higher-precedence workspace skill overrides a managed skill", async () => {
    const workspaceDir = await makeWorkspace();
    const managedDir = path.join(workspaceDir, ".managed");
    await writeSkillFile({
      dir: path.join(managedDir, "demo-skill"),
      content: `---
name: demo-skill
description: Managed version
---

# Managed
`,
    });
    await writeSkillFile({
      dir: path.join(workspaceDir, "skills", "demo-skill"),
      content: `---
name: demo-skill
description: Workspace version
---

# Workspace
`,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: path.join(workspaceDir, ".bundled"),
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.skill.description).toBe("Workspace version");
      expect(warnedWith(warnSpy, "skill name collision across sources")).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns cached entries until caches are cleared", async () => {
    const workspaceDir = await makeWorkspace();
    const skillDir = path.join(workspaceDir, "skills", "demo-skill");
    const skillPath = path.join(skillDir, "SKILL.md");

    await writeSkillFile({
      dir: skillDir,
      content: `---
name: demo-skill
description: Old description
---

# Demo
`,
    });

    const first = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    expect(first[0]?.skill.description).toBe("Old description");

    await fs.writeFile(
      skillPath,
      `---
name: demo-skill
description: New description
---

# Demo
`,
      "utf-8",
    );

    const second = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    expect(second[0]?.skill.description).toBe("Old description");

    clearWorkspaceSkillCaches();

    const third = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    expect(third[0]?.skill.description).toBe("New description");
  });
});
