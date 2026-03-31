import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginSkillDirs } from "./plugin-skills.js";

const tempDirs: string[] = [];
const prevBundledDir = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR;
const EMPTY_PLUGIN_SCHEMA = { type: "object", additionalProperties: false, properties: {} };

function makeTempDir() {
  const dir = path.join(os.tmpdir(), `openclaw-plugin-skills-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writePlugin(params: {
  id: string;
  body: string;
  skills?: string[];
}): { dir: string; file: string } {
  const dir = makeTempDir();
  const file = path.join(dir, `${params.id}.js`);
  fs.writeFileSync(file, params.body, "utf-8");
  fs.writeFileSync(
    path.join(dir, "openclaw.plugin.json"),
    JSON.stringify(
      {
        id: params.id,
        configSchema: EMPTY_PLUGIN_SCHEMA,
        skills: params.skills ?? [],
      },
      null,
      2,
    ),
    "utf-8",
  );
  for (const skillDir of params.skills ?? []) {
    fs.mkdirSync(path.join(dir, skillDir), { recursive: true });
  }
  return { dir, file };
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

describe("resolvePluginSkillDirs", () => {
  it("returns skill dirs from loaded plugins only", () => {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const loaded = writePlugin({
      id: "loaded-skills",
      skills: ["skills/demo"],
      body: `export default { id: "loaded-skills", register() {} };`,
    });
    const disabled = writePlugin({
      id: "disabled-skills",
      skills: ["skills/disabled"],
      body: `export default { id: "disabled-skills", register() {} };`,
    });

    const skillDirs = resolvePluginSkillDirs({
      workspaceDir: loaded.dir,
      config: {
        plugins: {
          load: {
            paths: [loaded.file, disabled.file],
          },
          allow: ["loaded-skills"],
        },
      },
    });

    expect(skillDirs).toEqual([path.join(loaded.dir, "skills", "demo")]);
  });

  it("keeps healthy plugin skill dirs when another plugin fails validation", () => {
    process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled/plugins";
    const healthy = writePlugin({
      id: "healthy-skills",
      skills: ["skills/healthy"],
      body: `export default { id: "healthy-skills", register() {} };`,
    });
    const broken = writePlugin({
      id: "broken-skills",
      skills: ["skills/broken"],
      body: `export default { id: "broken-skills", register() {} };`,
    });
    const invalidConfig = "nope" as unknown as Record<string, unknown>;

    const skillDirs = resolvePluginSkillDirs({
      workspaceDir: healthy.dir,
      config: {
        plugins: {
          load: {
            paths: [healthy.file, broken.file],
          },
          allow: ["healthy-skills", "broken-skills"],
          entries: {
            "broken-skills": {
              config: invalidConfig,
            },
          },
        },
      },
    });

    expect(skillDirs).toEqual([path.join(healthy.dir, "skills", "healthy")]);
  });
});
