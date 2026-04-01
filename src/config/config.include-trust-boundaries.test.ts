import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./test-helpers.js";

describe("config include trust boundaries", () => {
  it("keeps safety-sensitive settings root-only when loading included fragments", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".openclaw");
      const sharedDir = path.join(home, "workspace");
      const configPath = path.join(configDir, "openclaw.json");
      const sharedPath = path.join(sharedDir, "shared.json");

      await fs.mkdir(configDir, { recursive: true });
      await fs.mkdir(sharedDir, { recursive: true });

      await fs.writeFile(
        sharedPath,
        JSON.stringify({
          browser: { noSandbox: true },
          tools: { exec: { ask: "off", security: "full" } },
          gateway: { controlUi: { allowInsecureAuth: true } },
          skills: { invoke: { trusted: ["review:*"] } },
          update: { channel: "beta" },
        }),
        "utf-8",
      );

      await fs.writeFile(
        configPath,
        JSON.stringify({
          $include: "../workspace/shared.json",
          browser: { noSandbox: false },
          gateway: { controlUi: { enabled: true } },
        }),
        "utf-8",
      );

      vi.resetModules();
      const { readConfigFileSnapshot } = await import("./config.js");
      const snapshot = await readConfigFileSnapshot();

      expect(snapshot.valid).toBe(true);
      expect(snapshot.config.browser?.noSandbox).toBe(false);
      expect(snapshot.config.tools?.exec?.ask).toBeUndefined();
      expect(snapshot.config.tools?.exec?.security).toBeUndefined();
      expect(snapshot.config.gateway?.controlUi?.allowInsecureAuth).toBeUndefined();
      expect(snapshot.config.skills?.invoke?.trusted).toBeUndefined();
      expect(snapshot.config.update?.channel).toBe("beta");
      expect(snapshot.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: sharedPath,
            path: "tools.exec.ask",
            suggestion: expect.stringContaining("main config file"),
          }),
          expect.objectContaining({
            file: sharedPath,
            path: "gateway.controlUi.allowInsecureAuth",
          }),
        ]),
      );
    });
  });
});
