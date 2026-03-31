import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHome } from "./test-helpers.js";
import { createConfigIO } from "./io.js";

describe("config migration write safety", () => {
  it("keeps the original config file intact when a write rename fails", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const original = {
        tools: {
          bash: { timeoutSec: 12 },
        },
      };
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(original, null, 2), "utf-8");

      const failingFs = new Proxy(nodeFs, {
        get(target, prop, receiver) {
          if (prop === "promises") {
            return {
              ...target.promises,
              rename: async () => {
                throw new Error("rename failed");
              },
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof nodeFs;

      const io = createConfigIO({
        fs: failingFs,
        configPath,
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
      });

      await expect(
        io.writeConfigFile({
          tools: {
            exec: { timeoutSec: 12 },
          },
        }),
      ).rejects.toThrow("rename failed");

      const raw = await fs.readFile(configPath, "utf-8");
      expect(JSON.parse(raw)).toEqual(original);
    });
  });
});
