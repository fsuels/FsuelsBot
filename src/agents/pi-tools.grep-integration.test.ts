import { describe, expect, it } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

describe("createOpenClawCodingTools grep integration", () => {
  it("includes the dedicated grep tool in the coding tool surface", () => {
    const grep = createOpenClawCodingTools().find((tool) => tool.name === "grep");
    expect(grep).toBeDefined();
    expect(grep?.description).toMatch(/prefer this over raw shell rg\/grep/i);
  });
});
