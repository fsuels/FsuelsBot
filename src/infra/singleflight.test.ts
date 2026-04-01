import { describe, expect, it, vi } from "vitest";
import { createSingleflightCache } from "./singleflight.js";

describe("createSingleflightCache", () => {
  it("coalesces concurrent calls for the same key", async () => {
    let resolveTask: ((value: string) => void) | null = null;
    const task = vi.fn(
      async () =>
        await new Promise<string>((resolve) => {
          resolveTask = resolve;
        }),
    );
    const cache = createSingleflightCache<string, string>();

    const runs = Array.from({ length: 20 }, () => cache.run("catalog", task));
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);

    resolveTask?.("ok");
    await expect(Promise.all(runs)).resolves.toEqual(Array.from({ length: 20 }, () => "ok"));
    expect(cache.getStats()).toMatchObject({
      misses: 1,
      joinedCallers: 19,
      cleanupRuns: 1,
    });
  });

  it("does not coalesce different keys", async () => {
    const task = vi.fn(async (key: string) => key);
    const cache = createSingleflightCache<string, string>();

    const [left, right] = await Promise.all([
      cache.run("alpha", async () => await task("alpha")),
      cache.run("beta", async () => await task("beta")),
    ]);

    expect(left).toBe("alpha");
    expect(right).toBe("beta");
    expect(task).toHaveBeenCalledTimes(2);
    expect(cache.getStats().misses).toBe(2);
  });

  it("retries transient failures on the next call", async () => {
    const cache = createSingleflightCache<string, string>({
      classifyError: () => "transient",
    });
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.run("retryable", task)).rejects.toThrow("temporary");
    await expect(cache.run("retryable", task)).resolves.toBe("recovered");

    expect(task).toHaveBeenCalledTimes(2);
    expect(cache.getStats().transientEvictions).toBe(1);
  });

  it("cleans up in-flight bookkeeping on resolve and reject", async () => {
    const cache = createSingleflightCache<string, string>({
      classifyError: () => "transient",
    });

    await expect(cache.run("ok", async () => "done", { cacheSuccessMs: 0 })).resolves.toBe("done");
    await expect(
      cache.run("fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(cache.getState()).toEqual({ entryCount: 0, inFlightCount: 0 });
    expect(cache.getStats().cleanupRuns).toBe(2);
  });
});
