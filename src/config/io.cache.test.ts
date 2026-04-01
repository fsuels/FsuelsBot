import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnvOverride, withTempHome } from "./test-helpers.js";

describe("config cache safety", () => {
  it("does not let cached config mutations leak across loadConfig calls", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({
          gateway: { mode: "local" },
          tools: { exec: { ask: "always" } },
        }),
        "utf-8",
      );

      await withEnvOverride(
        {
          OPENCLAW_CONFIG_CACHE_MS: "5000",
          OPENCLAW_DISABLE_CONFIG_CACHE: undefined,
        },
        async () => {
          const { loadConfig } = await import("./config.js");

          const first = loadConfig();
          first.gateway = { mode: "remote" };
          if (first.tools?.exec) {
            first.tools.exec.ask = "off";
          }

          const second = loadConfig();
          expect(second.gateway?.mode).toBe("local");
          expect(second.tools?.exec?.ask).toBe("always");
        },
      );
    });
  });
});
