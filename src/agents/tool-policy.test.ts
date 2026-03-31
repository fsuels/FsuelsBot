import { describe, expect, it } from "vitest";
import {
  __testing,
  CORE_TOOL_IDS,
  expandToolGroups,
  isOwnerOnlyToolName,
  resolveToolProfilePolicy,
  TOOL_GROUPS,
} from "./tool-policy.js";

describe("tool-policy", () => {
  it("expands groups and normalizes aliases", () => {
    const expanded = expandToolGroups(["group:runtime", "BASH", "apply-patch", "group:fs"]);
    const set = new Set(expanded);
    expect(set.has("exec")).toBe(true);
    expect(set.has("process")).toBe(true);
    expect(set.has("bash")).toBe(false);
    expect(set.has("apply_patch")).toBe(true);
    expect(set.has("read")).toBe(true);
    expect(set.has("write")).toBe(true);
    expect(set.has("edit")).toBe(true);
    expect(set.has("find")).toBe(true);
  });

  it("resolves known profiles and ignores unknown ones", () => {
    const coding = resolveToolProfilePolicy("coding");
    expect(coding?.allow).toContain("group:fs");
    expect(resolveToolProfilePolicy("nope")).toBeUndefined();
  });

  it("includes core tool groups in group:openclaw", () => {
    const group = TOOL_GROUPS["group:openclaw"];
    expect(group).toContain("browser");
    expect(group).toContain("delegate");
    expect(group).toContain("message");
    expect(group).toContain("session_status");
    expect(group).toContain("verification_gate");
    expect(group).toContain("task_tracker");
    expect(group).toContain("tts");
  });

  it("fails validation when policy references an unknown tool id", () => {
    expect(() =>
      __testing.validateStaticToolPolicyConfig({
        toolIds: CORE_TOOL_IDS,
        toolGroups: TOOL_GROUPS,
        toolProfiles: {
          minimal: { allow: ["missing_tool"] },
          coding: {},
          messaging: {},
          full: {},
        },
      }),
    ).toThrow(/unknown tool id "missing_tool"/i);
  });

  it("fails duplicate tool ids after normalization", () => {
    expect(() =>
      __testing.assertUniqueToolNames(
        [{ name: "exec" }, { name: "bash" }] as Array<{ name: string }>,
        "test tools",
      ),
    ).toThrow(/duplicate tool id "exec"/i);
  });

  it("allows explicit deprecated tool aliases when they are intentionally exposed", () => {
    expect(() =>
      __testing.assertUniqueToolNames(
        [{ name: "get_task_output" }, { name: "task_output" }] as Array<{ name: string }>,
        "task tools",
      ),
    ).not.toThrow();
  });

  it("treats auth/login helper tools as owner-only", () => {
    expect(isOwnerOnlyToolName("whatsapp_login")).toBe(true);
    expect(isOwnerOnlyToolName("zalouser_authenticate")).toBe(true);
    expect(isOwnerOnlyToolName("message")).toBe(false);
  });
});
