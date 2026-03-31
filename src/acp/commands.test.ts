import { describe, expect, it } from "vitest";
import { getAvailableCommands } from "./commands.js";

describe("ACP available commands", () => {
  it("hides commands that are disabled by config", () => {
    const commands = getAvailableCommands({
      cfg: {
        commands: {
          bash: false,
          config: false,
          debug: false,
          restart: false,
        },
      },
    });

    const names = commands.map((command) => command.name);
    expect(names).not.toContain("bash");
    expect(names).not.toContain("config");
    expect(names).not.toContain("debug");
    expect(names).not.toContain("restart");
  });

  it("surfaces argument hints from the command registry", () => {
    const commands = getAvailableCommands({
      cfg: {
        commands: {
          restart: true,
        },
      },
    });

    expect(commands.find((command) => command.name === "context")).toMatchObject({
      input: { hint: "[list|detail|json]" },
    });
    expect(commands.find((command) => command.name === "skill")).toMatchObject({
      input: { hint: "<name> [input]" },
    });
  });

  it("uses the public slash alias for dock commands", () => {
    const commands = getAvailableCommands({ cfg: {} });
    const dockCommands = commands.filter((command) => command.name.startsWith("dock-"));

    expect(dockCommands.length).toBeGreaterThan(0);
    expect(dockCommands.every((command) => !command.name.includes("_"))).toBe(true);
  });
});
