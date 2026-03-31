import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSkillRuntimeState,
  evaluateSkillPermission,
  loadWorkspaceSkillEntries,
  markSkillInvocationLifecycle,
  routeExplicitSkillInvocation,
} from "./skills.js";

type SkillFixture = {
  dir: string;
  name: string;
  description: string;
  metadata?: string;
  frontmatterExtra?: string;
  body?: string;
};

const tempDirs: string[] = [];

async function makeWorkspace() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skills-router-"));
  tempDirs.push(workspaceDir);
  return workspaceDir;
}

async function writeSkill(params: SkillFixture) {
  const { dir, name, description, metadata, frontmatterExtra, body } = params;
  await fs.mkdir(dir, { recursive: true });
  const frontmatter = [
    `name: ${name}`,
    `description: ${description}`,
    metadata ? `metadata: ${metadata}` : "",
    frontmatterExtra ?? "",
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n${body ?? `# ${name}\n`}`,
    "utf-8",
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("routeExplicitSkillInvocation", () => {
  it("normalizes explicit skill names and reuses an already loaded skill", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "demo-skill"),
      name: "demo-skill",
      description: "Demo skill",
    });

    const state = createSkillRuntimeState();
    const first = await routeExplicitSkillInvocation({
      workspaceDir,
      state,
      skillName: "/demo_skill",
      commandName: "skill",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.record.skillName).toBe("demo-skill");
    expect(first.reused).toBe(false);
    expect(first.record.loadedPrompt).toContain("## Loaded Skill (runtime-routed)");

    const second = await routeExplicitSkillInvocation({
      workspaceDir,
      state,
      skillName: "demo-skill",
      commandName: "skill",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.reused).toBe(true);
    expect(second.record.id).toBe(first.record.id);
  });

  it("blocks duplicate invocation while a skill is already running", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "review-pr"),
      name: "review-pr",
      description: "Review a pull request",
    });

    const state = createSkillRuntimeState();
    const routed = await routeExplicitSkillInvocation({
      workspaceDir,
      state,
      skillName: "review-pr",
      commandName: "review_pr",
    });
    expect(routed.ok).toBe(true);
    if (!routed.ok) {
      return;
    }
    markSkillInvocationLifecycle({ state, skillName: "review-pr", lifecycle: "running" });

    const duplicate = await routeExplicitSkillInvocation({
      workspaceDir,
      state,
      skillName: "review-pr",
      commandName: "review_pr",
    });
    expect(duplicate).toEqual({
      ok: false,
      code: "already_running",
      message: 'Skill "review-pr" is already running in this turn.',
    });
  });

  it("rejects unknown and non-user-invocable skills", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "private-skill"),
      name: "private-skill",
      description: "Hidden skill",
      frontmatterExtra: "user-invocable: false",
    });

    const state = createSkillRuntimeState();
    const unknown = await routeExplicitSkillInvocation({
      workspaceDir,
      state,
      skillName: "missing-skill",
      commandName: "skill",
    });
    expect(unknown).toEqual({
      ok: false,
      code: "unknown_skill",
      message: "Unknown skill: missing-skill",
    });

    const hidden = await routeExplicitSkillInvocation({
      workspaceDir,
      state,
      skillName: "private-skill",
      commandName: "skill",
    });
    expect(hidden).toEqual({
      ok: false,
      code: "not_user_invocable",
      message: 'Skill "private-skill" is not user-invocable.',
    });
  });

  it("keeps explicit invocation available for disable-model-invocation skills", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "manual-only"),
      name: "manual-only",
      description: "Manual only skill",
      frontmatterExtra: "disable-model-invocation: true",
    });

    const routed = await routeExplicitSkillInvocation({
      workspaceDir,
      state: createSkillRuntimeState(),
      skillName: "manual-only",
      commandName: "skill",
    });
    expect(routed.ok).toBe(true);
  });
});

describe("evaluateSkillPermission", () => {
  it("lets deny rules win over allow rules and supports prefix matches", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "review-pr"),
      name: "review:pr",
      description: "Review a pull request",
    });

    const entry = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    }).find((candidate) => candidate.skill.name === "review:pr");
    expect(entry).toBeDefined();
    if (!entry) {
      return;
    }

    const decision = evaluateSkillPermission({
      entry,
      config: {
        skills: {
          invoke: {
            allow: ["review:*"],
            deny: ["review:pr"],
          },
        },
      },
    });
    expect(decision).toEqual({
      behavior: "deny",
      reason: 'Skill "review:pr" is blocked by skills.invoke.deny (review:pr).',
      matchedRule: "review:pr",
    });
  });

  it("fails closed for unsafe manifest properties and auto-allows safe skills", async () => {
    const workspaceDir = await makeWorkspace();
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "safe-skill"),
      name: "safe-skill",
      description: "Safe skill",
    });
    await writeSkill({
      dir: path.join(workspaceDir, "skills", "unsafe-skill"),
      name: "unsafe-skill",
      description: "Unsafe skill",
      metadata: '\'{"openclaw":{"model":"openai/gpt-5.2"}}\'',
    });

    const entries = loadWorkspaceSkillEntries(workspaceDir, {
      managedSkillsDir: path.join(workspaceDir, ".managed"),
      bundledSkillsDir: path.join(workspaceDir, ".bundled"),
    });
    const safeEntry = entries.find((candidate) => candidate.skill.name === "safe-skill");
    const unsafeEntry = entries.find((candidate) => candidate.skill.name === "unsafe-skill");
    expect(safeEntry).toBeDefined();
    expect(unsafeEntry).toBeDefined();
    if (!safeEntry || !unsafeEntry) {
      return;
    }

    expect(evaluateSkillPermission({ entry: safeEntry })).toEqual({
      behavior: "allow",
      matchedRule: "safe_properties",
    });
    expect(evaluateSkillPermission({ entry: unsafeEntry })).toEqual({
      behavior: "ask",
      reason:
        'Skill "unsafe-skill" has non-default manifest/frontmatter fields and requires approval before explicit invocation.',
      suggestedAllowRules: ["unsafe-skill"],
    });
  });
});
