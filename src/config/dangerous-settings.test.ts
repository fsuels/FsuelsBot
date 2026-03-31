import { describe, expect, it } from "vitest";
import {
  extractDangerousSettings,
  hasDangerousSettingsChanged,
  listDangerousSettingNames,
} from "./dangerous-settings.js";

describe("dangerous settings", () => {
  it("ignores allowlisted safe env vars", () => {
    const subset = extractDangerousSettings({
      env: {
        vars: {
          LANG: "en_US.UTF-8",
          TERM: "xterm-256color",
        },
      },
    });

    expect(subset.dangerousEnvVars).toEqual([]);
    expect(listDangerousSettingNames(subset)).toEqual([]);
  });

  it("treats unknown env vars as dangerous by default", () => {
    const subset = extractDangerousSettings({
      env: {
        vars: {
          OPENAI_API_KEY: "sk-live-secret",
        },
        CUSTOM_FLAG: "enabled",
      },
    });

    expect(subset.dangerousEnvVars).toEqual(["CUSTOM_FLAG", "OPENAI_API_KEY"]);
    expect(listDangerousSettingNames(subset)).toEqual(["env.CUSTOM_FLAG", "env.OPENAI_API_KEY"]);
  });

  it("treats hook presence as dangerous and exposes names without values", () => {
    const subset = extractDangerousSettings({
      hooks: {
        enabled: true,
        token: "hook-secret-token",
        gmail: {
          pushToken: "gmail-secret",
        },
      },
    });

    expect(subset.hooksPresent).toBe(true);
    expect(listDangerousSettingNames(subset)).toEqual([
      "hooks.enabled",
      "hooks.gmail.pushToken",
      "hooks.token",
    ]);
    expect(listDangerousSettingNames(subset).join(" ")).not.toContain("hook-secret-token");
    expect(listDangerousSettingNames(subset).join(" ")).not.toContain("gmail-secret");
  });

  it("tracks dangerous shell settings when login-shell env import is enabled", () => {
    const subset = extractDangerousSettings({
      env: {
        shellEnv: {
          enabled: true,
          timeoutMs: 15000,
        },
      },
    });

    expect(subset.dangerousShellSettings).toEqual([
      "env.shellEnv.enabled",
      "env.shellEnv.timeoutMs",
    ]);
  });

  it("re-prompts when the dangerous subset changes", () => {
    expect(
      hasDangerousSettingsChanged(
        {
          env: {
            vars: {
              OPENAI_API_KEY: "one",
            },
          },
        },
        {
          env: {
            vars: {
              OPENAI_API_KEY: "one",
              ANTHROPIC_API_KEY: "two",
            },
          },
        },
      ),
    ).toBe(true);
  });

  it("does not re-prompt when only safe settings change", () => {
    expect(
      hasDangerousSettingsChanged(
        {
          env: {
            vars: {
              LANG: "en_US.UTF-8",
            },
          },
        },
        {
          env: {
            vars: {
              LANG: "pt_BR.UTF-8",
            },
          },
        },
      ),
    ).toBe(false);
  });
});
