import { describe, expect, it } from "vitest";
import { classifyForDelegation } from "./delegate-router.js";

describe("classifyForDelegation", () => {
  it("delegates straightforward proofreading requests", () => {
    expect(classifyForDelegation("Please fix the grammar in this paragraph.")).toBe("grammar");
    expect(classifyForDelegation("Proofread this short note for me.")).toBe("grammar");
  });

  it("does not treat code-like or path-like keywords as negative triggers", () => {
    expect(classifyForDelegation("Summarize `const plan = 1` in one sentence.")).toBe(
      "summarization",
    );
    expect(classifyForDelegation("Translate docs/review-guide.md to Spanish.")).toBe("translation");
  });

  it("does not delegate natural-language questions that ask for judgment", () => {
    expect(classifyForDelegation("What’s your review of this architecture?")).toBeNull();
    expect(classifyForDelegation("Can you plan the migration strategy?")).toBeNull();
  });

  it("ignores quoted and slash-command trigger words", () => {
    expect(classifyForDelegation('Summarize "review" in one sentence.')).toBe("summarization");
    expect(classifyForDelegation("/review summarize this")).toBeNull();
  });
});
