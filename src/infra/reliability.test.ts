import { describe, expect, it, vi } from "vitest";
import { launchReliableOperation, runReliableOperation } from "./reliability.js";

describe("reliability helpers", () => {
  it("uses fallback values when a best-effort operation times out", async () => {
    vi.useFakeTimers();
    const debug = vi.fn();
    const cachedValue = { source: "cache" };

    const promise = runReliableOperation({
      name: "session preview",
      criticality: "best_effort",
      timeoutMs: 100,
      task: async () => await new Promise<never>(() => {}),
      fallback: () => cachedValue,
      logger: { debug },
    });

    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toEqual({
      ok: true,
      value: cachedValue,
      fallbackUsed: true,
      message: "session preview failed: session preview timed out after 100ms; using fallback",
    });
    expect(debug).toHaveBeenCalledWith(
      "session preview failed: session preview timed out after 100ms; using fallback",
    );
    vi.useRealTimers();
  });

  it("returns a failure result for best-effort operations instead of throwing", async () => {
    const warn = vi.fn();

    const result = await runReliableOperation({
      name: "noncritical refresh",
      criticality: "best_effort",
      task: async () => {
        throw new Error("boom");
      },
      logger: { warn },
    });

    expect(result).toMatchObject({
      ok: false,
      criticality: "best_effort",
      message: "noncritical refresh failed: boom",
    });
    expect(warn).toHaveBeenCalledWith("noncritical refresh failed: boom");
  });

  it("retries transient failures before succeeding", async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error("retry me")).mockResolvedValueOnce("ok");

    const result = await runReliableOperation({
      name: "gateway read",
      criticality: "critical",
      retry: {
        attempts: 2,
        minDelayMs: 0,
        maxDelayMs: 0,
      },
      shouldRetry: () => true,
      task,
    });

    expect(result).toEqual({
      ok: true,
      value: "ok",
      fallbackUsed: false,
    });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("keeps fire-and-forget failures non-blocking while surfacing a warning", async () => {
    const warn = vi.fn();

    launchReliableOperation({
      name: "background refresh",
      task: async () => {
        throw new Error("background boom");
      },
      logger: { warn },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith("background refresh failed: background boom");
  });
});
