import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import { applySessionModelSelectionTransition } from "./model-transition.js";

describe("applySessionModelSelectionTransition", () => {
  it("applies a new model override and reports a model change", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 1,
    };

    const transition = applySessionModelSelectionTransition({
      entry,
      selection: {
        provider: "openai",
        model: "gpt-4o",
        isDefault: false,
      },
      currentProvider: "anthropic",
      currentModel: "claude-opus-4-5",
    });

    expect(transition.updated).toBe(true);
    expect(transition.modelChanged).toBe(true);
    expect(transition.previousLabel).toBe("anthropic/claude-opus-4-5");
    expect(transition.nextLabel).toBe("openai/gpt-4o");
    expect(entry.providerOverride).toBe("openai");
    expect(entry.modelOverride).toBe("gpt-4o");
  });

  it("treats auth-profile-only updates as metadata changes, not model changes", () => {
    const entry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 1,
      providerOverride: "openai",
      modelOverride: "gpt-4o",
    };

    const transition = applySessionModelSelectionTransition({
      entry,
      selection: {
        provider: "openai",
        model: "gpt-4o",
        isDefault: false,
      },
      profileOverride: "openai:work",
      currentProvider: "openai",
      currentModel: "gpt-4o",
    });

    expect(transition.updated).toBe(true);
    expect(transition.modelChanged).toBe(false);
    expect(entry.authProfileOverride).toBe("openai:work");
  });
});
