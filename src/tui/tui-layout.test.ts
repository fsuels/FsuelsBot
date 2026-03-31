import { describe, expect, it } from "vitest";
import { visibleWidth } from "../terminal/ansi.js";
import { formatTuiFooterLine, formatTuiHeaderLine } from "./tui-layout.js";

describe("tui layout formatting", () => {
  it("switches to a compact header on narrow terminals without overflowing", () => {
    const line = formatTuiHeaderLine({
      columns: 60,
      connectionUrl: "ws://127.0.0.1:18789/gateway/socket",
      agentLabel: "main-agent-with-a-very-long-name",
      sessionLabel: "agent:main:customer-success:very-long-session-name",
    });

    expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    expect(line).toContain("openclaw tui");
    expect(line).toContain("agent");
    expect(line).not.toContain("session ");
  });

  it("keeps full header context on wide terminals", () => {
    const line = formatTuiHeaderLine({
      columns: 120,
      connectionUrl: "ws://127.0.0.1:18789/gateway/socket",
      agentLabel: "main",
      sessionLabel: "agent:main:main",
    });

    expect(visibleWidth(line)).toBeLessThanOrEqual(120);
    expect(line).toContain("session agent:main:main");
    expect(line).toContain("ws://127.0.0.1:18789/gateway/socket");
  });

  it("keeps compact footer stable on narrow terminals", () => {
    const line = formatTuiFooterLine({
      columns: 64,
      sessionLabel: "main (customer success escalation queue)",
      modelLabel: "anthropic/claude-opus-4.6-extended",
      tokensLabel: "tokens 48.2k/200k (24%)",
      thinkLabel: "think high",
      verboseLabel: "verbose on",
      reasoningLabel: "reasoning",
    });

    expect(visibleWidth(line)).toBeLessThanOrEqual(64);
    expect(line).toContain("tokens");
    expect(line).toContain("anthropic");
  });
});
