import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserRouteCleanupDeps,
  clearBrowserSessionRoutesForTests,
  clearObservedBrowserStateForRoute,
  getBrowserSessionRoute,
  recordBrowserSessionRoute,
} from "./session-browser-context.js";

describe("session browser context", () => {
  afterEach(() => {
    clearBrowserSessionRoutesForTests();
    vi.clearAllMocks();
  });

  it("preserves targetId when the route stays the same", () => {
    recordBrowserSessionRoute({
      sessionKey: "agent:main:test",
      target: "host",
      profile: "chrome",
      targetId: "tab-1",
    });

    recordBrowserSessionRoute({
      sessionKey: "agent:main:test",
      target: "host",
      profile: "chrome",
      preserveTargetId: true,
    });

    expect(getBrowserSessionRoute("agent:main:test")).toMatchObject({
      target: "host",
      profile: "chrome",
      targetId: "tab-1",
    });
  });

  it("clears targetId when null is passed explicitly", () => {
    recordBrowserSessionRoute({
      sessionKey: "agent:main:test",
      target: "host",
      targetId: "tab-1",
    });

    recordBrowserSessionRoute({
      sessionKey: "agent:main:test",
      target: "host",
      targetId: null,
    });

    expect(getBrowserSessionRoute("agent:main:test")).toMatchObject({
      target: "host",
    });
    expect(getBrowserSessionRoute("agent:main:test")?.targetId).toBeUndefined();
  });

  it("clears observed state for host routes via browser client actions", async () => {
    const browserRequestsMock = vi.fn(async () => ({
      ok: true as const,
      targetId: "tab-1",
      requests: [],
    }));
    const browserPageErrorsMock = vi.fn(async () => ({
      ok: true as const,
      targetId: "tab-1",
      errors: [],
    }));

    await clearObservedBrowserStateForRoute(
      {
        target: "host",
        profile: "chrome",
        targetId: "tab-1",
        updatedAt: 1,
      },
      {
        browserRequests: browserRequestsMock,
        browserPageErrors: browserPageErrorsMock,
        callGatewayTool: vi.fn() as unknown as BrowserRouteCleanupDeps["callGatewayTool"],
      },
    );

    expect(browserRequestsMock).toHaveBeenCalledWith(undefined, {
      targetId: "tab-1",
      clear: true,
      profile: "chrome",
    });
    expect(browserPageErrorsMock).toHaveBeenCalledWith(undefined, {
      targetId: "tab-1",
      clear: true,
      profile: "chrome",
    });
  });

  it("clears observed state for node routes via browser proxy calls", async () => {
    const callGatewayToolMock = vi.fn(async () => ({
      payload: { result: { ok: true } },
    }));

    await clearObservedBrowserStateForRoute(
      {
        target: "node",
        nodeId: "node-1",
        profile: "chrome",
        targetId: "tab-9",
        updatedAt: 1,
      },
      {
        browserRequests: vi.fn() as unknown as BrowserRouteCleanupDeps["browserRequests"],
        browserPageErrors: vi.fn() as unknown as BrowserRouteCleanupDeps["browserPageErrors"],
        callGatewayTool: callGatewayToolMock as unknown as BrowserRouteCleanupDeps["callGatewayTool"],
      },
    );

    expect(callGatewayToolMock).toHaveBeenNthCalledWith(
      1,
      "node.invoke",
      { timeoutMs: 20_000 },
      expect.objectContaining({
        nodeId: "node-1",
        command: "browser.proxy",
        params: expect.objectContaining({
          method: "GET",
          path: "/requests",
          query: {
            clear: true,
            targetId: "tab-9",
            profile: "chrome",
          },
        }),
      }),
    );
    expect(callGatewayToolMock).toHaveBeenNthCalledWith(
      2,
      "node.invoke",
      { timeoutMs: 20_000 },
      expect.objectContaining({
        nodeId: "node-1",
        command: "browser.proxy",
        params: expect.objectContaining({
          method: "GET",
          path: "/errors",
          query: {
            clear: true,
            targetId: "tab-9",
            profile: "chrome",
          },
        }),
      }),
    );
  });
});
