import { describe, expect, it } from "vitest";
import { detectAwaitingInputFromTail } from "./process-stall-detector.js";

describe("detectAwaitingInputFromTail", () => {
  it("detects y/n confirmation prompts", () => {
    expect(detectAwaitingInputFromTail("Overwrite existing file? (y/n)")).toMatchObject({
      reason: "interactive confirmation prompt",
      prompt: "Overwrite existing file? (y/n)",
    });
  });

  it("detects continue prompts", () => {
    expect(
      detectAwaitingInputFromTail("Installing dependencies...\nDo you want to continue?"),
    ).toMatchObject({
      reason: "interactive continue prompt",
      prompt: "Do you want to continue?",
    });
  });

  it("detects press enter prompts", () => {
    expect(detectAwaitingInputFromTail("Press Enter to continue")).toMatchObject({
      reason: "interactive enter prompt",
      prompt: "Press Enter to continue",
    });
  });

  it("does not false-trigger on slow non-interactive output", () => {
    expect(detectAwaitingInputFromTail("Downloading package metadata...\n42% complete")).toBeNull();
  });
});
