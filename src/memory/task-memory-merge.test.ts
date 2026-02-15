import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mergeTaskMemoryFile,
  mergeTaskMemorySnapshots,
  parseTaskMemorySnapshot,
  renderTaskMemorySnapshot,
} from "./task-memory-merge.js";

let workspaceDir = os.tmpdir();

beforeAll(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-task-memory-merge-"));
});

afterAll(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

describe("task memory snapshot merge", () => {
  it("applies deterministic section merge semantics", () => {
    const existing = parseTaskMemorySnapshot(`
# Task Memory
## Goal
Legacy goal

## Current State
In progress

## Decisions
- Keep API v1

## Open Questions
- Should we use redis cache?

## Next Actions
- Add health endpoint

## Key Entities
- api: /v1
- owner: devrel

## Pinned
- auth token rotates hourly
`)!;
    const incoming = parseTaskMemorySnapshot(`
## Goal
Ship supplier onboarding

## Current State
Implementation started

## Decisions
- keep api v1
- Add retries

## Open Questions
- RESOLVED: should we use redis cache?
- Which cache ttl should we use?

## Next Actions
- Draft rollout plan

## Key Entities
- api: /v2
- owner: platform

## Pinned
- UNPIN: auth token rotates hourly
- SOC2 controls are mandatory
`)!;

    const merged = mergeTaskMemorySnapshots({ existing, incoming });
    expect(merged.goal).toBe("Ship supplier onboarding");
    expect(merged.currentState).toBe("Implementation started");
    expect(merged.decisions).toEqual(["Keep API v1", "Add retries"]);
    expect(merged.openQuestions).toEqual(["Which cache ttl should we use?"]);
    expect(merged.nextActions).toEqual(["Draft rollout plan"]);
    expect(merged.keyEntities).toEqual(["api: /v2", "owner: platform"]);
    expect(merged.pinned).toEqual(["SOC2 controls are mandatory"]);
  });
});

describe("mergeTaskMemoryFile", () => {
  it("merges incoming task memory with previous snapshot", async () => {
    const taskPath = path.join(workspaceDir, "memory", "tasks", "task-a.md");
    await fs.mkdir(path.dirname(taskPath), { recursive: true });
    await fs.writeFile(
      taskPath,
      [
        "## Goal",
        "New goal",
        "",
        "## Decisions",
        "- Add retries",
        "",
        "## Open Questions",
        "- RESOLVED: should we use redis cache?",
        "",
        "## Next Actions",
        "- Draft rollout plan",
      ].join("\n"),
      "utf-8",
    );

    const existingMarkdown = [
      "## Goal",
      "Old goal",
      "",
      "## Decisions",
      "- Keep API v1",
      "",
      "## Open Questions",
      "- Should we use redis cache?",
      "",
      "## Next Actions",
      "- Add health endpoint",
    ].join("\n");

    const result = await mergeTaskMemoryFile({
      workspaceDir,
      taskId: "task-a",
      existingMarkdown,
    });
    expect(result.applied).toBe(true);
    expect(result.changed).toBe(true);
    const merged = await fs.readFile(taskPath, "utf-8");
    expect(merged).toContain("New goal");
    expect(merged).toContain("- Keep API v1");
    expect(merged).toContain("- Add retries");
    expect(merged).toContain("- Draft rollout plan");
    expect(merged).not.toContain("Should we use redis cache?");
  });

  it("skips unstructured task files to avoid destructive rewrites", async () => {
    const taskPath = path.join(workspaceDir, "memory", "tasks", "task-unstructured.md");
    await fs.mkdir(path.dirname(taskPath), { recursive: true });
    await fs.writeFile(taskPath, "just random paragraph content with no known headings", "utf-8");

    const result = await mergeTaskMemoryFile({
      workspaceDir,
      taskId: "task-unstructured",
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("unstructured-content");
  });
});

describe("goalStack and blockers parsing/merge", () => {
  it("parses Goal Stack and Blockers sections from markdown", () => {
    const snapshot = parseTaskMemorySnapshot(`
# Task Memory

## Goal
Ship the feature

## Decisions
- Use PostgreSQL

## Goal Stack
- Root goal
- Mid-level goal

## Blockers
- Waiting for API keys
- CI pipeline broken

## Open Questions
_None._

## Next Actions
- Write migration
`)!;
    expect(snapshot).not.toBeNull();
    expect(snapshot.goalStack).toEqual(["Root goal", "Mid-level goal"]);
    expect(snapshot.blockers).toEqual(["Waiting for API keys", "CI pipeline broken"]);
  });

  it("merges goalStack: incoming replaces if non-empty", () => {
    const existing = parseTaskMemorySnapshot(`
## Goal
Root goal
## Goal Stack
- First sub-goal
## Decisions
- Keep API v1
`)!;
    const incoming = parseTaskMemorySnapshot(`
## Goal Stack
- New sub-goal A
- New sub-goal B
## Decisions
_None._
`)!;
    const merged = mergeTaskMemorySnapshots({ existing, incoming });
    expect(merged.goalStack).toEqual(["New sub-goal A", "New sub-goal B"]);
  });

  it("merges blockers with resolved: markers", () => {
    const existing = parseTaskMemorySnapshot(`
## Blockers
- API keys missing
- Build broken
## Decisions
_None._
`)!;
    const incoming = parseTaskMemorySnapshot(`
## Blockers
- Resolved: API keys missing
- New dependency issue
## Decisions
_None._
`)!;
    const merged = mergeTaskMemorySnapshots({ existing, incoming });
    expect(merged.blockers).toContain("New dependency issue");
    expect(merged.blockers).not.toContain("API keys missing");
    expect(merged.blockers).toContain("Build broken");
  });

  it("renders goalStack and blockers in markdown output", () => {
    const rendered = renderTaskMemorySnapshot({
      taskId: "task-render",
      snapshot: {
        goal: "Ship it",
        decisions: [],
        openQuestions: [],
        nextActions: [],
        keyEntities: [],
        pinned: [],
        notes: [],
        goalStack: ["Root goal", "Sub-goal 1"],
        blockers: ["Waiting for review"],
      },
    });
    expect(rendered).toContain("## Goal Stack");
    expect(rendered).toContain("- Root goal");
    expect(rendered).toContain("- Sub-goal 1");
    expect(rendered).toContain("## Blockers");
    expect(rendered).toContain("- Waiting for review");
  });
});
