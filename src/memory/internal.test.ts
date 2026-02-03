import { describe, expect, it } from "vitest";
import path from "node:path";

import { chunkMarkdown, isPathWithinRoot } from "./internal.js";

describe("chunkMarkdown", () => {
  it("splits overly long lines into max-sized chunks", () => {
    const chunkTokens = 400;
    const maxChars = chunkTokens * 4;
    const content = "a".repeat(maxChars * 3 + 25);
    const chunks = chunkMarkdown(content, { tokens: chunkTokens, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(maxChars);
    }
  });
});

describe("isPathWithinRoot", () => {
  it("accepts root and descendant paths", () => {
    const root = path.resolve("/tmp/workspace");
    expect(isPathWithinRoot(root, root)).toBe(true);
    expect(isPathWithinRoot(root, path.join(root, "memory", "global.md"))).toBe(true);
  });

  it("rejects outside and sibling-prefixed paths", () => {
    const root = path.resolve("/tmp/workspace");
    expect(isPathWithinRoot(root, path.resolve("/tmp/workspace-backup/secrets.md"))).toBe(false);
    expect(isPathWithinRoot(root, path.resolve("/tmp/secrets.md"))).toBe(false);
  });
});
