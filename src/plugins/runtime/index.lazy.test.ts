import { afterEach, describe, expect, it, vi } from "vitest";

const lazyProbeState = vi.hoisted(() => ({
  loadCount: 0,
  probeDiscord: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../discord/probe.js", () => {
  lazyProbeState.loadCount += 1;
  return {
    probeDiscord: lazyProbeState.probeDiscord,
  };
});

describe("plugin runtime lazy adapters", () => {
  afterEach(() => {
    vi.resetModules();
    lazyProbeState.loadCount = 0;
    lazyProbeState.probeDiscord.mockReset();
    lazyProbeState.probeDiscord.mockResolvedValue({ ok: true });
  });

  it("loads async channel adapters on first use and reuses the loaded module", async () => {
    const { createPluginRuntime } = await import("./index.js");

    expect(lazyProbeState.loadCount).toBe(0);

    const runtime = createPluginRuntime();
    expect(lazyProbeState.loadCount).toBe(0);

    await runtime.channel.discord.probeDiscord("token-a", 2500);
    expect(lazyProbeState.loadCount).toBe(1);

    await runtime.channel.discord.probeDiscord("token-b", 5000);
    expect(lazyProbeState.loadCount).toBe(1);
    expect(lazyProbeState.probeDiscord).toHaveBeenCalledTimes(2);
  });
});
