import { describe, expect, it, vi } from "vitest";
import { sleep, withTimeout } from "./async.js";

describe("async helpers", () => {
  it("sleep resolves immediately when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1_000, controller.signal)).resolves.toBeUndefined();
  });

  it("sleep resolves on timer when not aborted", async () => {
    vi.useFakeTimers();
    const promise = sleep(250);
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("sleep rejects with a custom abort error when configured", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      sleep(100, controller.signal, {
        throwOnAbort: true,
        abortError: () => new Error("cancelled"),
      }),
    ).rejects.toThrow("cancelled");
  });

  it("withTimeout rejects after the timeout and clears the timer", async () => {
    vi.useFakeTimers();
    const promise = withTimeout(new Promise<never>(() => {}), 100, "timed out");
    const expectation = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("withTimeout does not cancel underlying work by itself", async () => {
    vi.useFakeTimers();
    let completed = false;
    const underlying = new Promise<string>((resolve) => {
      setTimeout(() => {
        completed = true;
        resolve("ok");
      }, 200);
    });

    const wrapped = withTimeout(underlying, 100, "timed out");
    const expectation = expect(wrapped).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(completed).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await expect(underlying).resolves.toBe("ok");
    expect(completed).toBe(true);
    vi.useRealTimers();
  });
});
