import { describe, expect, it } from "vitest";
import {
  clearExplicitValueIfEqualsDefault,
  mergeUniqueStringArrays,
  moveConfigValue,
  remapConfigValue,
} from "./migration-helpers.js";

describe("config migration helpers", () => {
  it("skips moves when the source path is missing", () => {
    const root = {
      tools: {
        exec: { timeoutSec: 30 },
      },
    };

    const result = moveConfigValue({
      root,
      fromPath: ["tools", "bash"],
      toPath: ["tools", "exec"],
    });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "source value missing",
      sourcePath: "tools.bash",
      destinationPath: "tools.exec",
    });
    expect(root).toEqual({
      tools: {
        exec: { timeoutSec: 30 },
      },
    });
  });

  it("preserves destination values while cleaning legacy keys", () => {
    const root = {
      tools: {
        bash: { timeoutSec: 12 },
        exec: { timeoutSec: 30 },
      },
    };

    const result = moveConfigValue({
      root,
      fromPath: ["tools", "bash"],
      toPath: ["tools", "exec"],
    });

    expect(result).toMatchObject({
      status: "applied",
      reason: "destination already set; removed legacy source",
    });
    expect(root).toEqual({
      tools: {
        exec: { timeoutSec: 30 },
      },
    });
  });

  it("remaps stored aliases in place", () => {
    const root = {
      auth: {
        profiles: {
          "anthropic:claude-cli": { mode: "token" },
        },
      },
    };

    const result = remapConfigValue({
      root,
      path: ["auth", "profiles", "anthropic:claude-cli", "mode"],
      remap: { token: "oauth" },
    });

    expect(result).toMatchObject({
      status: "applied",
      reason: "remapped legacy alias",
    });
    expect(root.auth.profiles["anthropic:claude-cli"]?.mode).toBe("oauth");
  });

  it("merges unique string arrays and removes the source array", () => {
    const root = {
      approvals: {
        legacyAllow: ["alpha", "beta", "alpha"],
        allow: ["beta", "gamma"],
      },
    };

    const result = mergeUniqueStringArrays({
      root,
      fromPath: ["approvals", "legacyAllow"],
      toPath: ["approvals", "allow"],
    });

    expect(result).toMatchObject({
      status: "applied",
      reason: "merged unique string array values",
    });
    expect(root).toEqual({
      approvals: {
        allow: ["beta", "gamma", "alpha"],
      },
    });
  });

  it("clears explicit values that already equal the resolved default", () => {
    const root = {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.2",
          },
        },
      },
    };

    const result = clearExplicitValueIfEqualsDefault({
      root,
      path: ["agents", "defaults", "model", "primary"],
      resolvedDefault: "openai/gpt-5.2",
    });

    expect(result).toMatchObject({
      status: "applied",
      reason: "stored value matched the default; cleared explicit value",
    });
    expect(root).toEqual({});
  });
});
