import { describe, expect, it } from "vitest";

import type { SessionEntry } from "../../config/sessions/types.js";
import { selectTaskMemoryNudge } from "./task-memory-guidance.js";

describe("selectTaskMemoryNudge", () => {
  it("asks what to work on at session start", () => {
    const text = selectTaskMemoryNudge({
      message: "hey",
      isNewSession: true,
      activeTaskId: "default",
      now: 1000,
    });
    expect(text).toBe(
      "Just checking - do you want to continue something we worked on before, or start a new topic?",
    );
  });

  it("uses start prompt after long idle gaps", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      activeTaskId: "default",
    };
    const text = selectTaskMemoryNudge({
      message: "I am back and ready to continue planning this rollout.",
      isNewSession: false,
      sessionEntry: entry,
      activeTaskId: "default",
      now: 8 * 60 * 60 * 1000,
    });
    expect(text).toBe("Before we begin - what would you like to work on?");
  });

  it("asks whether this is a topic switch when inferred task differs", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 1000,
      activeTaskId: "task-a",
    };
    const text = selectTaskMemoryNudge({
      message: "switch to payment API work",
      isNewSession: false,
      sessionEntry: entry,
      activeTaskId: "task-a",
      inferredTaskId: "task-b",
      now: 2000,
    });
    expect(text).toBe("It looks like we may be switching topics. Is this something new?");
  });

  it("acknowledges critical memory language", () => {
    const text = selectTaskMemoryNudge({
      message: "This is important. Do not forget this.",
      isNewSession: false,
      activeTaskId: "task-a",
      now: 2000,
    });
    expect(text).toBe("Got it. I will treat this as important and remember it.");
  });

  it("suggests saving progress on long tasks", () => {
    const text = selectTaskMemoryNudge({
      message: "continue",
      isNewSession: false,
      activeTaskId: "task-a",
      taskCompactionCount: 3,
      now: 2000,
    });
    expect(text).toContain("save where we are");
  });

  it("asks the user to choose when multiple tasks match", () => {
    const text = selectTaskMemoryNudge({
      message: "continue invoice sync",
      isNewSession: false,
      activeTaskId: "default",
      inferredTaskId: "billing",
      ambiguousTaskIds: ["invoices"],
      now: 2000,
    });
    expect(text).toContain("few things that could match");
  });

  it("surfaces important-memory conflicts explicitly", () => {
    const text = selectTaskMemoryNudge({
      message: "Actually change that important requirement",
      isNewSession: false,
      activeTaskId: "task-a",
      hasImportantConflict: true,
      now: 2000,
    });
    expect(text).toContain("conflict between something marked as important");
  });
});
