import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigFileSnapshot, OpenClawConfig } from "../config/config.js";

const chokidarMock = vi.hoisted(() => {
  const handlers = new Map<string, Array<() => void>>();
  const watch = vi.fn(() => watcher);
  const watcher = {
    on: vi.fn((event: string, handler: () => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return watcher;
    }),
    close: vi.fn(async () => {}),
  };

  return {
    watch,
    emit(event: string) {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
    reset() {
      handlers.clear();
      watcher.on.mockClear();
      watcher.close.mockClear();
      watch.mockClear();
    },
  };
});

vi.mock("chokidar", () => ({
  default: {
    watch: chokidarMock.watch,
  },
}));

function makeSnapshot(config: OpenClawConfig): ConfigFileSnapshot {
  return {
    path: "/tmp/openclaw.json",
    exists: true,
    raw: JSON.stringify(config),
    parsed: config,
    valid: true,
    config,
    hash: "hash",
    issues: [],
    warnings: [],
    legacyIssues: [],
  };
}

describe("gateway config reloader watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chokidarMock.reset();
  });

  afterEach(async () => {
    const { __resetConfigWatchEventStateForTests } = await import("../config/watch-events.js");
    __resetConfigWatchEventStateForTests();
    vi.useRealTimers();
  });

  it("suppresses unlink/add self-echoes from internal writes", async () => {
    const { startGatewayConfigReloader } = await import("./config-reload.js");
    const { markConfigPathWrite } = await import("../config/watch-events.js");

    const readSnapshot = vi.fn(async () =>
      makeSnapshot({
        gateway: { reload: { debounceMs: 0 } },
        messages: { humanDelay: { mode: "off" } },
      }),
    );

    const reloader = startGatewayConfigReloader({
      initialConfig: { gateway: { reload: { debounceMs: 0 } } },
      readSnapshot,
      onHotReload: vi.fn(async () => {}),
      onRestart: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      watchPath: "/tmp/openclaw.json",
    });

    markConfigPathWrite("/tmp/openclaw.json");
    chokidarMock.emit("unlink");
    chokidarMock.emit("add");
    await vi.runAllTimersAsync();

    expect(readSnapshot).not.toHaveBeenCalled();

    await reloader.stop();
  });

  it("treats unlink followed by add as a single external change", async () => {
    const { startGatewayConfigReloader } = await import("./config-reload.js");

    const nextConfig = {
      gateway: { reload: { debounceMs: 0 } },
      messages: { humanDelay: { mode: "off" } },
    } satisfies OpenClawConfig;

    const readSnapshot = vi.fn(async () => makeSnapshot(nextConfig));
    const onHotReload = vi.fn(async () => {});

    const reloader = startGatewayConfigReloader({
      initialConfig: { gateway: { reload: { debounceMs: 0 } } },
      readSnapshot,
      onHotReload,
      onRestart: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      watchPath: "/tmp/openclaw.json",
    });

    chokidarMock.emit("unlink");
    await vi.advanceTimersByTimeAsync(200);
    chokidarMock.emit("add");
    await vi.runAllTimersAsync();

    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(onHotReload).toHaveBeenCalledTimes(1);

    await reloader.stop();
  });
});
