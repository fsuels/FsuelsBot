import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type DiscoverableSkill,
  buildBudgetedSkillsPrompt,
  buildDiscoverableSkills,
  loadWorkspaceSkillEntries,
} from "./skills.js";

type SkillFixture = {
  dir: string;
  name: string;
  description: string;
};

const tempDirs: string[] = [];

async function makeWorkspace() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skills-registry-"));
  tempDirs.push(workspaceDir);
  return workspaceDir;
}

async function writeSkill(params: SkillFixture) {
  const { dir, name, description } = params;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf-8",
  );
}

function createDiscoverableSkill(params: {
  name: string;
  description: string;
  sourceCategory: DiscoverableSkill["sourceCategory"];
  filePath?: string;
}): DiscoverableSkill {
  return {
    entry: {
      skill: {
        name: params.name,
        description: params.description,
        filePath: params.filePath ?? "/skill/SKILL.md",
        source: `openclaw-${params.sourceCategory}`,
      },
      frontmatter: {},
    } as DiscoverableSkill["entry"],
    name: params.name,
    description: params.description,
    sourceCategory: params.sourceCategory,
    promptPriority: 0,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("buildBudgetedSkillsPrompt", () => {
  it("stays within budget and truncates deterministically", async () => {
    const workspaceDir = await makeWorkspace();
    const longDescription =
      "This is a deliberately verbose description that should be trimmed under pressure while staying deterministic across repeated prompt renders.";
    for (const name of ["alpha-skill", "beta-skill", "gamma-skill"]) {
      await writeSkill({
        dir: path.join(workspaceDir, "skills", name),
        name,
        description: `${name} ${longDescription}`,
      });
    }

    const entries = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    const discoverable = buildDiscoverableSkills(entries);
    const first = buildBudgetedSkillsPrompt({
      skills: discoverable,
      budgetChars: 650,
      descriptionMaxChars: 100,
    });
    const second = buildBudgetedSkillsPrompt({
      skills: discoverable,
      budgetChars: 650,
      descriptionMaxChars: 100,
    });

    expect(first.prompt.length).toBeLessThanOrEqual(650);
    expect(first.prompt).toBe(second.prompt);
    expect(first.metrics.truncationMode).not.toBe("full");
  });

  it("keeps bundled skills visible before lower-priority extras under budget pressure", async () => {
    const discoverable = [
      createDiscoverableSkill({
        name: "addon-skill",
        description:
          "Extra skill with a very long description that should be dropped first when the discovery budget gets tight.",
        sourceCategory: "extra",
        filePath: "/x/SKILL.md",
      }),
      createDiscoverableSkill({
        name: "core-skill",
        description:
          "Bundled core skill that should remain discoverable even when lower priority entries are removed.",
        sourceCategory: "bundled",
        filePath: "/c/SKILL.md",
      }),
    ];
    const result = buildBudgetedSkillsPrompt({
      skills: discoverable,
      budgetChars: 520,
      descriptionMaxChars: 120,
    });

    expect(result.prompt).toContain("core-skill");
    expect(result.prompt).not.toContain("addon-skill");
    expect(result.metrics.includedSkills).toBe(1);
    expect(result.metrics.truncationMode).toBe("omitted");
  });

  it("falls back to names-only before omitting a skill", async () => {
    const discoverable = [
      createDiscoverableSkill({
        name: "narrow-skill",
        description:
          "A long description that should collapse all the way to an empty description tag before the skill itself is omitted.",
        sourceCategory: "workspace",
        filePath: "/n/SKILL.md",
      }),
    ];
    const result = buildBudgetedSkillsPrompt({
      skills: discoverable,
      budgetChars: 520,
      descriptionMaxChars: 120,
    });

    expect(result.prompt).toContain("<name>narrow-skill</name>");
    expect(result.prompt).toContain("<description></description>");
    expect(result.metrics.truncationMode).toBe("names_only");
  });
});
