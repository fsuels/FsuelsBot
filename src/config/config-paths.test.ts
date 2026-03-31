import { describe, expect, it } from "vitest";
import {
  getConfigValueAtPath,
  hasConfigValueAtPath,
  parseConfigPath,
  setConfigValueAtPath,
  unsetConfigValueAtPath,
} from "./config-paths.js";

describe("config paths", () => {
  it("rejects empty and blocked paths", () => {
    expect(parseConfigPath("")).toEqual({
      ok: false,
      error: "Invalid path. Use dot or bracket notation (e.g. foo.bar or foo[0].bar).",
    });
    expect(parseConfigPath("__proto__.polluted").ok).toBe(false);
    expect(parseConfigPath("constructor.polluted").ok).toBe(false);
    expect(parseConfigPath("prototype.polluted").ok).toBe(false);
  });

  it("sets, gets, and unsets nested values", () => {
    const root: Record<string, unknown> = {};
    const parsed = parseConfigPath("foo.bar");
    if (!parsed.ok || !parsed.path) {
      throw new Error("path parse failed");
    }
    setConfigValueAtPath(root, parsed.path, 123);
    expect(getConfigValueAtPath(root, parsed.path)).toBe(123);
    expect(unsetConfigValueAtPath(root, parsed.path)).toBe(true);
    expect(getConfigValueAtPath(root, parsed.path)).toBeUndefined();
  });

  it("supports bracket notation and arrays", () => {
    const root: Record<string, unknown> = {};
    const parsed = parseConfigPath("commands.ownerAllowFrom[0]");
    if (!parsed.ok || !parsed.path) {
      throw new Error("path parse failed");
    }
    setConfigValueAtPath(root, parsed.path, "+15551234567");
    expect(root).toEqual({
      commands: {
        ownerAllowFrom: ["+15551234567"],
      },
    });
    expect(hasConfigValueAtPath(root, parsed.path)).toBe(true);
    expect(getConfigValueAtPath(root, parsed.path)).toBe("+15551234567");
  });

  it("supports escaped dots in path segments", () => {
    const parsed = parseConfigPath("plugins.entries.my\\.plugin.enabled");
    expect(parsed).toEqual({
      ok: true,
      path: ["plugins", "entries", "my.plugin", "enabled"],
    });
  });

  it("prunes empty arrays after unset", () => {
    const root: Record<string, unknown> = {
      commands: {
        ownerAllowFrom: ["+15551234567"],
      },
    };
    const parsed = parseConfigPath("commands.ownerAllowFrom[0]");
    if (!parsed.ok || !parsed.path) {
      throw new Error("path parse failed");
    }
    expect(unsetConfigValueAtPath(root, parsed.path)).toBe(true);
    expect(root).toEqual({});
  });
});
