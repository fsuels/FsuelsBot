import { beforeEach, describe, expect, it } from "vitest";
import { telegramPlugin } from "../../extensions/telegram/src/channel.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  extractMessagingToolSend,
  extractToolErrorMessage,
  extractToolErrorPresentation,
} from "./pi-embedded-subscribe.tools.js";

describe("extractMessagingToolSend", () => {
  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "telegram", plugin: telegramPlugin, source: "test" }]),
    );
  });

  it("uses channel as provider for message tool", () => {
    const result = extractMessagingToolSend("message", {
      action: "send",
      channel: "telegram",
      to: "123",
    });

    expect(result?.tool).toBe("message");
    expect(result?.provider).toBe("telegram");
    expect(result?.to).toBe("telegram:123");
  });

  it("prefers provider when both provider and channel are set", () => {
    const result = extractMessagingToolSend("message", {
      action: "send",
      provider: "slack",
      channel: "telegram",
      to: "channel:C1",
    });

    expect(result?.tool).toBe("message");
    expect(result?.provider).toBe("slack");
    expect(result?.to).toBe("channel:c1");
  });
});

describe("extractToolErrorPresentation", () => {
  it("uses the tool error presenter for structured validation payloads", () => {
    const presented = extractToolErrorPresentation({
      details: {
        issues: [{ path: "/path", message: "field required" }],
      },
    });

    expect(presented).toMatchObject({
      classification: "validation",
      text: "Invalid tool input:\n- /path field required",
    });
  });

  it("returns the presented text through extractToolErrorMessage", () => {
    const message = extractToolErrorMessage({
      error: "<tool_error>connection timeout\nretry later</tool_error>",
    });

    expect(message).toBe("connection timeout\nretry later");
  });
});
