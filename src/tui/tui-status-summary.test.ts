import { describe, expect, it } from "vitest";
import { formatStatusSummary } from "./tui-status-summary.js";

describe("formatStatusSummary", () => {
  it("prefers structured channel diagnostics when available", () => {
    const lines = formatStatusSummary({
      channels: {
        rows: [
          {
            id: "whatsapp",
            label: "WhatsApp",
            state: "warn",
            detail: "open inbound DMs can carry prompt-injection risk",
          },
          {
            id: "signal",
            label: "Signal",
            state: "ok",
            detail: "configured",
          },
        ],
      },
      heartbeat: { agents: [] },
      sessions: { defaults: { model: "claude", contextTokens: 200_000 }, count: 0 },
      queuedSystemEvents: [],
    });

    expect(lines).toContain("Channels:");
    expect(lines).toContain(
      "  - WhatsApp: warn | open inbound DMs can carry prompt-injection risk",
    );
    expect(lines).toContain("  - Signal: ok | configured");
  });

  it("falls back to legacy channel summary lines", () => {
    const lines = formatStatusSummary({
      channelSummary: ["WhatsApp: linked", "  - default (dm:allowlist)"],
      heartbeat: { agents: [] },
      sessions: { defaults: { model: "claude", contextTokens: 200_000 }, count: 0 },
      queuedSystemEvents: [],
    });

    expect(lines).toContain("Channels:");
    expect(lines).toContain("  WhatsApp: linked");
  });
});
