import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { applyCollaborationModeTransition } from "./plan-mode.js";

describe("plan-mode transitions", () => {
  it("enters plan mode with a default profile when none is provided", () => {
    const entry = { sessionId: "plan-a", updatedAt: 1 } as SessionEntry;

    const result = applyCollaborationModeTransition(entry, { mode: "plan" });

    expect(result.changed).toBe(true);
    expect(result.previousMode).toBe("default");
    expect(result.nextMode).toBe("plan");
    expect(result.nextPlanProfile).toBe("conservative");
    expect(result.entry.collaborationMode).toBe("plan");
    expect(result.entry.planProfile).toBe("conservative");
  });

  it("clears plan metadata when returning to default mode", () => {
    const entry = {
      sessionId: "plan-b",
      updatedAt: 1,
      collaborationMode: "plan",
      planProfile: "proactive",
    } as SessionEntry;

    const result = applyCollaborationModeTransition(entry, { mode: "default" });

    expect(result.changed).toBe(true);
    expect(result.previousMode).toBe("plan");
    expect(result.previousPlanProfile).toBe("proactive");
    expect(result.nextMode).toBe("default");
    expect(result.entry.collaborationMode).toBeUndefined();
    expect(result.entry.planProfile).toBeUndefined();
  });
});
