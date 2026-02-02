import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../config/sessions/types.js";
import {
  applyMemoryGuidanceTurn,
  detectMemoryGuidanceUserSignal,
  resolveMemoryGuidanceState,
  selectTaskMemoryNudge,
} from "./task-memory-guidance.js";

describe("selectTaskMemoryNudge", () => {
  it("asks what to work on at session start", () => {
    const decision = selectTaskMemoryNudge({
      message: "hey",
      isNewSession: true,
      activeTaskId: "default",
      now: 1000,
    });
    expect(decision?.text).toBe(
      "Just checking - do you want to continue something we worked on before, or start a new topic?",
    );
  });

  it("uses start prompt after long idle gaps in supportive mode", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      activeTaskId: "default",
    };
    const decision = selectTaskMemoryNudge({
      message: "I am back and ready to continue planning this rollout.",
      isNewSession: false,
      sessionEntry: entry,
      activeTaskId: "default",
      guidanceMode: "supportive",
      now: 8 * 60 * 60 * 1000,
    });
    expect(decision?.text).toBe("Before we begin - what would you like to work on?");
  });

  it("suppresses the long-idle nudge in minimal mode", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      activeTaskId: "default",
    };
    const decision = selectTaskMemoryNudge({
      message: "I am back and ready to continue planning this rollout.",
      isNewSession: false,
      sessionEntry: entry,
      activeTaskId: "default",
      guidanceMode: "minimal",
      now: 8 * 60 * 60 * 1000,
    });
    expect(decision).toBeNull();
  });

  it("asks whether this is a topic switch when inferred task differs", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 1000,
      activeTaskId: "task-a",
    };
    const decision = selectTaskMemoryNudge({
      message: "switch to payment API work",
      isNewSession: false,
      sessionEntry: entry,
      activeTaskId: "task-a",
      inferredTaskId: "task-b",
      now: 2000,
    });
    expect(decision?.text).toBe("It looks like we may be switching topics. Is this something new?");
  });

  it("acknowledges critical memory language", () => {
    const decision = selectTaskMemoryNudge({
      message: "This is important. Do not forget this.",
      isNewSession: false,
      activeTaskId: "task-a",
      now: 2000,
    });
    expect(decision?.text).toBe("Got it. I will treat this as important and remember it.");
  });

  it("suggests saving progress on long tasks in supportive mode", () => {
    const decision = selectTaskMemoryNudge({
      message: "continue",
      isNewSession: false,
      activeTaskId: "task-a",
      taskCompactionCount: 3,
      guidanceMode: "supportive",
      now: 2000,
    });
    expect(decision?.text).toContain("save where we are");
  });

  it("asks the user to choose when multiple tasks match", () => {
    const decision = selectTaskMemoryNudge({
      message: "continue invoice sync",
      isNewSession: false,
      activeTaskId: "default",
      inferredTaskId: "billing",
      ambiguousTaskIds: ["invoices"],
      now: 2000,
    });
    expect(decision?.text).toContain("few things that could match");
  });

  it("surfaces important-memory conflicts explicitly", () => {
    const decision = selectTaskMemoryNudge({
      message: "Actually change that important requirement",
      isNewSession: false,
      activeTaskId: "task-a",
      hasImportantConflict: true,
      now: 2000,
    });
    expect(decision?.text).toContain("conflict between something marked as important");
  });
});

describe("memory guidance mode state", () => {
  it("promotes to minimal after repeated explicit task signals", () => {
    const state = resolveMemoryGuidanceState({
      sessionId: "s1",
      updatedAt: 1,
      memoryGuidanceMode: "supportive",
      memoryGuidancePromptCount: 2,
      memoryGuidanceExplicitCount: 2,
      memoryGuidanceIgnoredCount: 0,
    });
    const update = applyMemoryGuidanceTurn({
      state,
      userSignal: "explicit-task",
    });
    expect(update.next.mode).toBe("minimal");
    expect(update.modeChanged).toBe(true);
  });

  it("falls back to supportive when minimal mode gets ignored repeatedly", () => {
    const state = resolveMemoryGuidanceState({
      sessionId: "s1",
      updatedAt: 1,
      memoryGuidanceMode: "minimal",
      memoryGuidanceIgnoredCount: 1,
      memoryGuidanceLastNudgeKind: "topic-switch",
      memoryGuidanceLastNudgeAt: Date.now(),
    });
    const update = applyMemoryGuidanceTurn({
      state,
      userSignal: "none",
    });
    expect(update.next.mode).toBe("supportive");
    expect(update.modeChanged).toBe(true);
    expect(update.response?.response).toBe("ignored");
  });

  it("tracks acknowledged response for the previous nudge", () => {
    const state = resolveMemoryGuidanceState({
      sessionId: "s1",
      updatedAt: 1,
      memoryGuidanceMode: "supportive",
      memoryGuidanceLastNudgeKind: "missing-task",
      memoryGuidanceLastNudgeAt: Date.now() - 1000,
    });
    const update = applyMemoryGuidanceTurn({
      state,
      userSignal: "explicit-task",
    });
    expect(update.response).toEqual(
      expect.objectContaining({
        priorNudgeKind: "missing-task",
        response: "acknowledged",
      }),
    );
    expect(update.next.lastNudgeKind).toBeUndefined();
  });
});

describe("detectMemoryGuidanceUserSignal", () => {
  it("detects explicit task statements", () => {
    expect(detectMemoryGuidanceUserSignal("Let's continue the task about supplier onboarding.")).toBe(
      "explicit-task",
    );
    expect(detectMemoryGuidanceUserSignal("/task set onboarding")).toBe("explicit-task");
  });

  it("returns none for generic messages", () => {
    expect(detectMemoryGuidanceUserSignal("thanks")).toBe("none");
  });
});

