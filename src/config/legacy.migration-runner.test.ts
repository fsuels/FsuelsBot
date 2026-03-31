import { describe, expect, it } from "vitest";
import { applyLegacyMigrations } from "./legacy.js";

describe("legacy migration runner", () => {
  it("records structured applied and skipped outcomes for converted migrations", () => {
    const first = applyLegacyMigrations({
      tools: {
        bash: { timeoutSec: 12 },
      },
    });

    expect(first.next?.tools).toEqual({
      exec: { timeoutSec: 12 },
    });
    expect(first.events.find((event) => event.migrationId === "tools.bash->tools.exec")).toMatchObject(
      {
        status: "applied",
        reason: "moved value to destination",
        sourceScope: "config",
        destinationScope: "config",
        sourcePaths: ["tools.bash"],
        destinationPaths: ["tools.exec"],
      },
    );

    const second = applyLegacyMigrations(first.next);
    expect(second.next).toBeNull();
    expect(second.changes).toEqual([]);
    expect(
      second.events.find((event) => event.migrationId === "tools.bash->tools.exec"),
    ).toMatchObject({
      status: "skipped",
      reason: "source value missing",
    });
  });

  it("preserves the migrated destination when rerun against partially upgraded config", () => {
    const result = applyLegacyMigrations({
      messages: {
        tts: {
          enabled: true,
          auto: "off",
        },
      },
    });

    expect(result.next?.messages).toEqual({
      tts: {
        auto: "off",
      },
    });
    expect(result.changes).toContain("Removed messages.tts.enabled (messages.tts.auto already set).");
    expect(
      result.events.find((event) => event.migrationId === "messages.tts.enabled->auto"),
    ).toMatchObject({
      status: "applied",
      reason: "destination already set; removed legacy source",
      sourcePaths: ["messages.tts.enabled"],
      destinationPaths: ["messages.tts.auto"],
    });
  });
});
