import { describe, expect, it } from "vitest";
import { findKeywordTriggerPositions, hasKeywordTrigger } from "./keyword-trigger.js";

describe("keyword trigger detection", () => {
  it("matches plain-prose whole-word triggers", () => {
    expect(findKeywordTriggerPositions("Please delegate this quick summary.", "delegate")).toEqual([
      7,
    ]);
  });

  it("ignores code spans, quoted strings, and bracketed text", () => {
    expect(hasKeywordTrigger("Use `delegate()` here.", "delegate")).toBe(false);
    expect(hasKeywordTrigger('He said "delegate later".', "delegate")).toBe(false);
    expect(hasKeywordTrigger("Check (delegate mode) first.", "delegate")).toBe(false);
  });

  it("ignores slash commands, flags, and file paths", () => {
    expect(hasKeywordTrigger("/delegate now", "delegate")).toBe(false);
    expect(hasKeywordTrigger("Run with --delegate after review", "delegate")).toBe(false);
    expect(hasKeywordTrigger("See docs/delegate-mode.md for details", "delegate")).toBe(false);
    expect(hasKeywordTrigger("Windows path C:\\delegate\\notes.txt", "delegate")).toBe(false);
  });

  it("ignores questions and tag-like spans", () => {
    expect(hasKeywordTrigger("delegate?", "delegate")).toBe(false);
    expect(hasKeywordTrigger("<delegate>plan</delegate>", "delegate")).toBe(false);
  });

  it("does not treat apostrophes as quote boundaries", () => {
    expect(hasKeywordTrigger("Don't delegate this one.", "delegate")).toBe(true);
    expect(hasKeywordTrigger("We're in 'delegate' quotes now.", "delegate")).toBe(false);
  });
});
