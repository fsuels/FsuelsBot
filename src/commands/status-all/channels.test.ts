import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { buildChannelsTable } from "./channels.js";

const riskyPlugin: ChannelPlugin = {
  id: "risky",
  meta: {
    id: "risky",
    label: "Risky Chat",
    selectionLabel: "Risky Chat",
    docsPath: "/channels/risky",
    blurb: "test stub",
  },
  capabilities: { chatTypes: ["direct", "group"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({ enabled: true }),
    isConfigured: () => true,
    describeAccount: () => ({
      configured: true,
      dmPolicy: "open",
      allowUnmentionedGroups: true,
    }),
  },
};

describe("buildChannelsTable", () => {
  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "risky", source: "test", plugin: riskyPlugin }]),
    );
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
  });

  it("marks risky inbound channel policies as warnings", async () => {
    const result = await buildChannelsTable({} as never);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: "risky",
      state: "warn",
      detail: "open inbound DMs can carry prompt-injection risk",
    });
    expect(result.details[0]?.rows[0]?.Notes).toContain("dm:open");
    expect(result.details[0]?.rows[0]?.Notes).toContain("mentions:optional");
  });
});
