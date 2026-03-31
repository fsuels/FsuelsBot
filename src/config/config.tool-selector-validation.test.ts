import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./test-helpers.js";

async function writeToolPluginFixture(params: { dir: string; id: string; toolNames: string[] }) {
  await fs.mkdir(params.dir, { recursive: true });
  await fs.writeFile(
    path.join(params.dir, "index.js"),
    [
      "export default {",
      `  id: ${JSON.stringify(params.id)},`,
      "  register(api) {",
      ...params.toolNames.map(
        (toolName) =>
          `    api.registerTool({ name: ${JSON.stringify(toolName)}, description: ${JSON.stringify(`Tool ${toolName}`)}, parameters: { type: "object", additionalProperties: false }, execute: async () => ({ ok: true }) });`,
      ),
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf-8",
  );
  await fs.writeFile(
    path.join(params.dir, "openclaw.plugin.json"),
    JSON.stringify(
      {
        id: params.id,
        configSchema: { type: "object", additionalProperties: false },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

describe("config tool selector validation", () => {
  it("rejects unknown core tool selectors", async () => {
    await withTempHome(async (home) => {
      process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");
      vi.resetModules();
      const { validateConfigObjectWithPlugins } = await import("./config.js");
      const res = validateConfigObjectWithPlugins({
        tools: {
          allow: ["read", "missing-tool"],
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues).toContainEqual({
          path: "tools.allow",
          message: 'unknown tool selector "missing-tool"',
        });
      }
    });
  });

  it("rejects wildcard selectors that match nothing", async () => {
    await withTempHome(async (home) => {
      process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");
      vi.resetModules();
      const { validateConfigObjectWithPlugins } = await import("./config.js");
      const res = validateConfigObjectWithPlugins({
        agents: {
          list: [
            {
              id: "work",
              tools: {
                alsoAllow: ["ghost-*"],
              },
            },
          ],
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.issues).toContainEqual({
          path: "agents.list.0.tools.alsoAllow",
          message: 'tool selector "ghost-*" does not match any currently available tools',
        });
      }
    });
  });

  it("accepts selectors for plugin ids", async () => {
    await withTempHome(async (home) => {
      process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");
      const pluginDir = path.join(home, "tool-plugin");
      await writeToolPluginFixture({
        dir: pluginDir,
        id: "tool-plugin",
        toolNames: ["plugin_probe"],
      });

      vi.resetModules();
      const { validateConfigObjectWithPlugins } = await import("./config.js");
      const res = validateConfigObjectWithPlugins({
        agents: {
          list: [
            {
              id: "work",
              tools: {
                profile: "coding",
                alsoAllow: ["tool-plugin"],
              },
            },
          ],
        },
        plugins: {
          enabled: true,
          load: { paths: [pluginDir] },
        },
      });
      expect(res.ok).toBe(true);
    });
  });
});
