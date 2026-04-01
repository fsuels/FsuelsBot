import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnvOverride, withTempHome } from "./test-helpers.js";

function runtimeImportSpecifiers(source: string): string[] {
  const matches = source.matchAll(
    /^\s*import\s+(?!type\b)(?:[^"'`]+\s+from\s+)?["']([^"']+)["'];?\s*$/gm,
  );
  return Array.from(matches, (match) => match[1] ?? "");
}

describe("bootstrap config loader", () => {
  it("loads bootstrap-safe config even when plugin validation would fail", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".openclaw");
      await fs.mkdir(configDir, { recursive: true });
      const missingPluginPath = path.join(home, "missing-plugin");
      await fs.writeFile(
        path.join(configDir, "openclaw.json"),
        JSON.stringify(
          {
            agents: { list: [{ id: "pi" }] },
            plugins: {
              enabled: false,
              load: { paths: [missingPluginPath] },
              entries: { "missing-plugin": { enabled: true } },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      await withEnvOverride({ OPENCLAW_CONFIG_CACHE_MS: "0" }, async () => {
        const { loadConfig, clearConfigCache } = await import("./config.js");
        const { loadBootstrapConfig, clearBootstrapConfigCache } = await import("./bootstrap.js");

        clearConfigCache();
        clearBootstrapConfigCache();

        const bootstrap = loadBootstrapConfig();
        expect(bootstrap.agents?.list?.[0]?.id).toBe("pi");
        expect(bootstrap.plugins?.entries?.["missing-plugin"]?.enabled).toBe(true);

        const full = loadConfig();
        expect(full).toEqual({});
      });
    });
  });

  it("exposes a cache clear hook for env-derived bootstrap reads", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".openclaw");
      const configPath = path.join(configDir, "openclaw.json");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            gateway: { auth: { token: "token-a" } },
          },
          null,
          2,
        ),
        "utf-8",
      );

      await withEnvOverride({ OPENCLAW_CONFIG_CACHE_MS: "60000" }, async () => {
        const { loadBootstrapConfig, clearBootstrapConfigCache } = await import("./bootstrap.js");

        clearBootstrapConfigCache();
        expect(loadBootstrapConfig().gateway?.auth?.token).toBe("token-a");

        await fs.writeFile(
          configPath,
          JSON.stringify(
            {
              gateway: { auth: { token: "token-b" } },
            },
            null,
            2,
          ),
          "utf-8",
        );

        expect(loadBootstrapConfig().gateway?.auth?.token).toBe("token-a");
        clearBootstrapConfigCache();
        expect(loadBootstrapConfig().gateway?.auth?.token).toBe("token-b");
      });
    });
  });

  it("refuses bootstrap includes outside the main config directory", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".openclaw");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(home, "outside.json"),
        JSON.stringify(
          {
            gateway: { auth: { token: "outside-token" } },
          },
          null,
          2,
        ),
        "utf-8",
      );
      await fs.writeFile(
        path.join(configDir, "openclaw.json"),
        JSON.stringify(
          {
            $include: "../outside.json",
          },
          null,
          2,
        ),
        "utf-8",
      );

      await withEnvOverride({ OPENCLAW_CONFIG_CACHE_MS: "0" }, async () => {
        const { loadConfig, clearConfigCache } = await import("./config.js");
        const { loadBootstrapConfig, clearBootstrapConfigCache } = await import("./bootstrap.js");

        clearConfigCache();
        clearBootstrapConfigCache();

        expect(loadBootstrapConfig()).toEqual({});
        expect(loadConfig().gateway?.auth?.token).toBe("outside-token");
      });
    });
  });

  it("keeps bootstrap files off plugin and UI layers", async () => {
    const bootstrapPath = new URL("./bootstrap.ts", import.meta.url);
    const validationBasePath = new URL("./validation.base.ts", import.meta.url);
    const [bootstrapSource, validationBaseSource] = await Promise.all([
      fs.readFile(bootstrapPath, "utf-8"),
      fs.readFile(validationBasePath, "utf-8"),
    ]);

    const forbiddenPatterns = [
      /^\.\.\/plugins\//,
      /^\.\.\/cli\//,
      /^\.\.\/commands\//,
      /^\.\.\/tui\//,
    ];

    for (const source of [bootstrapSource, validationBaseSource]) {
      const imports = runtimeImportSpecifiers(source);
      for (const specifier of imports) {
        expect(forbiddenPatterns.some((pattern) => pattern.test(specifier))).toBe(false);
      }
    }
  });

  it("keeps hot-path consumers on bootstrap config reads", async () => {
    const consumerPaths = [
      "../agents/model-catalog.ts",
      "../gateway/server-session-key.ts",
      "../gateway/server-model-catalog.ts",
      "../gateway/server/health-state.ts",
      "../infra/exec-approval-forwarder.ts",
      "../infra/provider-usage.auth.ts",
    ];

    for (const relativePath of consumerPaths) {
      const source = await fs.readFile(new URL(relativePath, import.meta.url), "utf-8");
      const imports = runtimeImportSpecifiers(source);
      expect(imports.some((specifier) => specifier.endsWith("/config/config.js"))).toBe(false);
    }
  });
});
