import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SkillFactoryEpisode, SkillFactorySkillVersion } from "./skill-factory/types.js";
import { backfillSkillFactoryEpisodes } from "./skill-factory/backfill.js";
import { createSkillDraftFromEpisodes } from "./skill-factory/drafts.js";
import { loadEpisodes } from "./skill-factory/episodes.js";
import { evaluateSkillDraft } from "./skill-factory/eval.js";
import { resolveSkillFactoryEpisodesPath } from "./skill-factory/paths.js";
import { recordEpisodeInRepeatIndex } from "./skill-factory/repeats.js";
import {
  buildGeneratedSkillSafetyManifest,
  enforceSkillDispatchPolicy,
  validateSafetyManifest,
} from "./skill-factory/safety.js";

const tempDirs: string[] = [];
const originalStateDir = process.env.OPENCLAW_STATE_DIR;

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createEpisode(params: {
  id: string;
  signature?: string;
  toolNames?: string[];
  outcome?: "success" | "error" | "aborted";
  durationMs?: number;
}): SkillFactoryEpisode {
  const now = Date.now();
  return {
    id: params.id,
    ts: now,
    startedAt: now - (params.durationMs ?? 1000),
    endedAt: now,
    durationMs: params.durationMs ?? 1000,
    agentId: "main",
    workspaceHash: "ws",
    source: "embedded",
    intentSummary: "test",
    intentHash: "intent",
    intentSignature: params.signature ?? "sig",
    toolNames: params.toolNames ?? ["sessions_send"],
    toolCount: (params.toolNames ?? ["sessions_send"]).length,
    outcome: params.outcome ?? "success",
  };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
  if (originalStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = originalStateDir;
  }
});

describe("skill-factory safety", () => {
  it("validates manifest schema", () => {
    const manifest = buildGeneratedSkillSafetyManifest({ toolName: "sessions_send" });
    const result = validateSafetyManifest(manifest);
    expect(result.ok).toBe(true);
    expect(result.manifest?.permissions.tools).toEqual(["sessions_send"]);
  });

  it("blocks generated skill dispatch without manifest", async () => {
    const workspaceDir = await makeTempDir("skill-factory-workspace-");
    const skillDir = path.join(workspaceDir, "skills", "generated-test");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: generated-test\ndescription: test\ncommand-dispatch: tool\ncommand-tool: sessions_send\nskill-factory-generated: true\n---\n\n# generated-test\n`,
      "utf-8",
    );

    const result = await enforceSkillDispatchPolicy({
      workspaceDir,
      skillName: "generated-test",
      toolName: "sessions_send",
      rawArgs: "--confirm ping",
      config: {},
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("safety manifest");
  });

  it("enforces confirmation for side-effect skills", async () => {
    const workspaceDir = await makeTempDir("skill-factory-workspace-");
    const skillDir = path.join(workspaceDir, "skills", "generated-test-confirm");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: generated-test-confirm\ndescription: test\ncommand-dispatch: tool\ncommand-tool: sessions_send\nskill-factory-generated: true\n---\n\n# generated-test-confirm\n`,
      "utf-8",
    );
    await fs.writeFile(
      path.join(skillDir, "skill.safety.json"),
      JSON.stringify(
        {
          version: 1,
          permissions: { tools: ["sessions_send"] },
          risk: { sideEffects: "send", requiresConfirmation: true },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const denied = await enforceSkillDispatchPolicy({
      workspaceDir,
      skillName: "generated-test-confirm",
      toolName: "sessions_send",
      rawArgs: "ping",
      config: {},
    });
    expect(denied.ok).toBe(false);

    const allowed = await enforceSkillDispatchPolicy({
      workspaceDir,
      skillName: "generated-test-confirm",
      toolName: "sessions_send",
      rawArgs: "--confirm ping",
      config: {},
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.normalizedArgs).toBe("ping");
  });
});

describe("skill-factory repeats", () => {
  it("crosses threshold on third matching episode", async () => {
    const root = await makeTempDir("skill-factory-repeats-");
    const repeatPath = path.join(root, "repeat-index.json");

    const first = await recordEpisodeInRepeatIndex({
      pathname: repeatPath,
      episode: createEpisode({ id: "e1" }),
      thresholds: { minCount: 3, windowMs: 10_000 },
    });
    const second = await recordEpisodeInRepeatIndex({
      pathname: repeatPath,
      episode: createEpisode({ id: "e2" }),
      thresholds: { minCount: 3, windowMs: 10_000 },
    });
    const third = await recordEpisodeInRepeatIndex({
      pathname: repeatPath,
      episode: createEpisode({ id: "e3" }),
      thresholds: { minCount: 3, windowMs: 10_000 },
    });

    expect(first.crossedThreshold).toBe(false);
    expect(second.crossedThreshold).toBe(false);
    expect(third.crossedThreshold).toBe(true);
    expect(third.entry.count).toBe(3);
  });
});

describe("skill-factory eval", () => {
  it("caches passing eval by hash tuple", async () => {
    const root = await makeTempDir("skill-factory-eval-");
    const evalPath = path.join(root, "evals.jsonl");

    const version: SkillFactorySkillVersion = {
      hash: "vhash",
      createdAt: Date.now(),
      sourceSignature: "sig",
      status: "draft",
      generated: true,
      skillName: "test-skill",
      dispatchTool: "sessions_send",
      draftDir: root,
      manifestHash: "mhash",
    };

    const episodes = [
      createEpisode({ id: "e1", durationMs: 1200 }),
      createEpisode({ id: "e2", durationMs: 900 }),
      createEpisode({ id: "e3", durationMs: 1000 }),
    ];

    const first = await evaluateSkillDraft({
      evalPath,
      skillKey: "test-skill",
      suiteId: "episodes-v1",
      version,
      episodes,
      runtime: {
        provider: "openai",
        model: "gpt-5",
        toolPolicyHash: "tph",
        surface: "embedded",
      },
    });
    const second = await evaluateSkillDraft({
      evalPath,
      skillKey: "test-skill",
      suiteId: "episodes-v1",
      version,
      episodes,
      runtime: {
        provider: "openai",
        model: "gpt-5",
        toolPolicyHash: "tph",
        surface: "embedded",
      },
    });

    expect(first.record.passed).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.record.key).toBe(first.record.key);
  });
});

describe("skill-factory drafts", () => {
  it("uses tool-based keys and excludes user content from generated skill key", async () => {
    const root = await makeTempDir("skill-factory-drafts-");
    process.env.OPENCLAW_STATE_DIR = root;

    const draft = await createSkillDraftFromEpisodes({
      agentId: "main",
      signature: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      episodes: [
        createEpisode({
          id: "e1",
          signature: "sig-draft",
          toolNames: ["sessions_send"],
        }),
      ],
    });

    expect(draft).not.toBeNull();
    expect(draft?.skillKey).toBe("workflow-sessions-send-abcdef01");
    expect(draft?.skillKey.toLowerCase()).not.toContain("francisco");
    expect(draft?.skillKey.toLowerCase()).not.toContain("suels");

    const skillDocPath = path.join(
      root,
      "agents",
      "main",
      "skill-factory",
      "drafts",
      draft?.skillKey ?? "",
      draft?.version.hash ?? "",
      "SKILL.md",
    );
    const doc = await fs.readFile(skillDocPath, "utf-8");
    expect(doc).not.toContain("francisco");
    expect(doc).not.toContain("suels");
    expect(doc).toContain("workflow signature `abcdef01`");
  });
});

describe("skill-factory backfill", () => {
  it("keeps deterministic episode ids and extracts tools from transcript records", async () => {
    const root = await makeTempDir("skill-factory-backfill-");
    process.env.OPENCLAW_STATE_DIR = root;

    const sessionsDir = path.join(root, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, "session-1.jsonl");
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({ type: "session", id: "session-1" }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-02-01T10:00:00.000Z",
          message: { role: "user", content: "Send the status update to channel 123." },
        }),
        JSON.stringify({
          type: "message",
          timestamp: "2026-02-01T10:00:05.000Z",
          message: {
            role: "assistant",
            provider: "openai",
            model: "gpt-5",
            content: [
              { type: "text", text: "Posting the update now." },
              { type: "tool_use", name: "sessions_send" },
            ],
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const first = await backfillSkillFactoryEpisodes({
      agentId: "main",
      workspaceDir: root,
      full: true,
    });
    const second = await backfillSkillFactoryEpisodes({
      agentId: "main",
      workspaceDir: root,
      full: true,
    });

    expect(first.createdEpisodes).toBe(1);
    expect(second.createdEpisodes).toBe(0);
    expect(second.skippedEpisodes).toBe(1);

    const episodes = await loadEpisodes({ pathname: resolveSkillFactoryEpisodesPath("main") });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.toolNames).toContain("sessions_send");
  });
});
