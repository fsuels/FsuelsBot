import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { disablePluginLifecycle, enablePluginLifecycle } from "./lifecycle.js";

const tempDirs: string[] = [];
const prevBundledDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `openclaw-plugin-lifecycle-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeBundledPlugin(params: { bundledDir: string; id: string; body: string }) {
  const pluginDir = path.join(params.bundledDir, params.id);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "index.ts"), params.body, "utf-8");
  fs.writeFileSync(
    path.join(pluginDir, "openclaw.plugin.json"),
    JSON.stringify(
      {
        id: params.id,
        configSchema: EMPTY_PLUGIN_SCHEMA,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  if (prevBundledDir === undefined) {
    delete process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = prevBundledDir;
  }
});

describe("plugin lifecycle", () => {
  it("enables a bundled plugin only after preflight passes", () => {
    const bundledDir = makeTempDir();
    writeBundledPlugin({
      bundledDir,
      id: "helper",
      body: `export default { id: "helper", register() {} };`,
    });
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledDir;

    const config: OpenClawConfig = {
      plugins: {
        allow: ["other-plugin"],
      },
    };

    const result = enablePluginLifecycle({
      config,
      pluginId: "helper",
    });

    expect(result.status).toBe("changed");
    expect(result.config.plugins?.entries?.helper?.enabled).toBe(true);
    expect(result.config.plugins?.allow).toEqual(["other-plugin", "helper"]);
  });

  it("blocks enable when the plugin is unavailable and preserves config", () => {
    const bundledDir = makeTempDir();
    writeBundledPlugin({
      bundledDir,
      id: "voice",
      body: `export default {
  id: "voice",
  isAvailable() {
    return { available: false, reason: "macOS microphone access required" };
  },
  register() {},
};`,
    });
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledDir;

    const config: OpenClawConfig = {};
    const result = enablePluginLifecycle({
      config,
      pluginId: "voice",
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") {
      return;
    }
    expect(result.code).toBe("UNAVAILABLE");
    expect(result.reason).toContain("macOS microphone access required");
    expect(result.remediation).toContain("openclaw plugins doctor");
    expect(result.config).toBe(config);
  });

  it("blocks enable when the plugin is denied and preserves config", () => {
    const bundledDir = makeTempDir();
    writeBundledPlugin({
      bundledDir,
      id: "blocked-plugin",
      body: `export default { id: "blocked-plugin", register() {} };`,
    });
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = bundledDir;

    const config: OpenClawConfig = {
      plugins: {
        deny: ["blocked-plugin"],
      },
    };
    const result = enablePluginLifecycle({
      config,
      pluginId: "blocked-plugin",
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") {
      return;
    }
    expect(result.code).toBe("BLOCKED_BY_DENYLIST");
    expect(result.remediation).toContain("plugins.deny");
    expect(result.config).toBe(config);
  });

  it("disables default-slot plugins without requiring plugin discovery", () => {
    const config: OpenClawConfig = {
      plugins: {
        entries: {
          "memory-core": { enabled: true },
        },
      },
    };

    const result = disablePluginLifecycle({
      config,
      pluginId: "memory-core",
    });

    expect(result.status).toBe("changed");
    expect(result.config.plugins?.entries?.["memory-core"]?.enabled).toBe(false);
    expect(result.config.plugins?.slots?.memory).toBe("none");
    expect(result.warnings).toContain('Exclusive slot "memory" disabled for "memory-core".');
  });
});
