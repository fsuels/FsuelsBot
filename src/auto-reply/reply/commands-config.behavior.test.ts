import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { getConfigValueAtPath, parseConfigPath } from "../../config/config-paths.js";
import { readConfigFileSnapshot, writeConfigFile } from "../../config/config.js";
import {
  applyConfigOverrides,
  resetConfigOverrides,
  setConfigOverride,
} from "../../config/runtime-overrides.js";
import { handleConfigCommand, handleDebugCommand } from "./commands-config.js";
import { buildCommandContext } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

function buildParams(commandBody: string, cfg: OpenClawConfig, ctxOverrides?: Partial<MsgContext>) {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "whatsapp",
    Surface: "whatsapp",
    ...ctxOverrides,
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "whatsapp",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("/config command behavior", () => {
  let tempDir = "";
  let configPath = "";
  const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;

  beforeEach(async () => {
    resetConfigOverrides();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-config-command-"));
    configPath = path.join(tempDir, "openclaw.json");
    process.env.OPENCLAW_CONFIG_PATH = configPath;
  });

  afterEach(async () => {
    resetConfigOverrides();
    if (previousConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("redacts sensitive values when showing the full config", async () => {
    const cfg = {
      commands: { config: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      gateway: { auth: { token: "secret-token" } },
    } as OpenClawConfig;
    await writeConfigFile(cfg);

    const result = await handleConfigCommand(buildParams("/config show", cfg), true);

    expect(result?.reply?.text).toContain("__OPENCLAW_REDACTED__");
    expect(result?.reply?.text).not.toContain("secret-token");
  });

  it("shows stored and effective values when runtime overrides differ", async () => {
    const storedCfg = {
      commands: { config: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { responsePrefix: "[disk]" },
    } as OpenClawConfig;
    await writeConfigFile(storedCfg);
    setConfigOverride("messages.responsePrefix", "[debug]");
    const effectiveCfg = applyConfigOverrides(storedCfg);

    const result = await handleConfigCommand(
      buildParams("/config show messages.responsePrefix", effectiveCfg),
      true,
    );

    expect(result?.reply?.text).toContain("Stored on disk");
    expect(result?.reply?.text).toContain('"[disk]"');
    expect(result?.reply?.text).toContain("Effective now");
    expect(result?.reply?.text).toContain('"[debug]"');
  });

  it("supports bracket-notation writes", async () => {
    const cfg = {
      commands: { config: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    await writeConfigFile(cfg);

    const result = await handleConfigCommand(
      buildParams('/config set commands.ownerAllowFrom[0]="+15551234567"', cfg),
      true,
    );
    expect(result?.reply?.text).toContain("commands.ownerAllowFrom[0]");

    const snapshot = await readConfigFileSnapshot();
    const parsed = parseConfigPath("commands.ownerAllowFrom[0]");
    if (!parsed.ok || !parsed.path) {
      throw new Error("path parse failed");
    }
    expect(getConfigValueAtPath(snapshot.parsed as Record<string, unknown>, parsed.path)).toBe(
      "+15551234567",
    );
  });

  it("accepts /config reset as an alias for unset", async () => {
    const cfg = {
      commands: { config: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      messages: { responsePrefix: "[disk]" },
    } as OpenClawConfig;
    await writeConfigFile(cfg);

    const result = await handleConfigCommand(
      buildParams("/config reset messages.responsePrefix", cfg),
      true,
    );
    expect(result?.reply?.text).toContain("messages.responsePrefix removed");

    const snapshot = await readConfigFileSnapshot();
    const parsed = parseConfigPath("messages.responsePrefix");
    if (!parsed.ok || !parsed.path) {
      throw new Error("path parse failed");
    }
    expect(
      getConfigValueAtPath(snapshot.parsed as Record<string, unknown>, parsed.path),
    ).toBeUndefined();
  });

  it("redacts sensitive values in set acknowledgements", async () => {
    const cfg = {
      commands: { config: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;
    await writeConfigFile(cfg);

    const result = await handleConfigCommand(
      buildParams('/config set gateway.auth.token="next-secret"', cfg),
      true,
    );

    expect(result?.reply?.text).toContain("(redacted)");
    expect(result?.reply?.text).not.toContain("next-secret");
  });

  it("redacts sensitive debug overrides", async () => {
    const cfg = {
      commands: { debug: true, text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as OpenClawConfig;

    const setResult = await handleDebugCommand(
      buildParams('/debug set gateway.auth.token="debug-secret"', cfg),
      true,
    );
    expect(setResult?.reply?.text).toContain("(redacted)");
    expect(setResult?.reply?.text).not.toContain("debug-secret");

    const showResult = await handleDebugCommand(buildParams("/debug show", cfg), true);
    expect(showResult?.reply?.text).toContain("__OPENCLAW_REDACTED__");
    expect(showResult?.reply?.text).not.toContain("debug-secret");
  });
});
