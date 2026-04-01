import { describe, expect, it, vi } from "vitest";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createTuiTurnLifecycleStore } from "./tui-turn-lifecycle.js";

describe("tui command handlers", () => {
  const makeContext = (overrides?: {
    sendChat?: ReturnType<typeof vi.fn>;
    addUser?: ReturnType<typeof vi.fn>;
    addSystem?: ReturnType<typeof vi.fn>;
    requestRender?: ReturnType<typeof vi.fn>;
    setActivityStatus?: ReturnType<typeof vi.fn>;
    forceRedraw?: ReturnType<typeof vi.fn>;
  }) => {
    const sendChat = overrides?.sendChat ?? vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = overrides?.addUser ?? vi.fn();
    const addSystem = overrides?.addSystem ?? vi.fn();
    const requestRender = overrides?.requestRender ?? vi.fn();
    const setActivityStatus = overrides?.setActivityStatus ?? vi.fn();
    const forceRedraw = overrides?.forceRedraw ?? vi.fn();
    const turnLifecycle = createTuiTurnLifecycleStore();

    return {
      sendChat,
      addUser,
      addSystem,
      requestRender,
      setActivityStatus,
      forceRedraw,
      turnLifecycle,
      handlers: createCommandHandlers({
        client: { sendChat } as never,
        chatLog: { addUser, addSystem } as never,
        tui: { requestRender } as never,
        opts: {},
        state: {
          currentSessionKey: "agent:main:main",
          activeChatRunId: null,
          sessionInfo: {},
        } as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus,
        turnLifecycle,
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch: vi.fn(),
        noteLocalRunId: vi.fn(),
        forgetLocalRunId: vi.fn(),
        forceRedraw,
      }),
    };
  };

  it("forwards unknown slash commands to the gateway", async () => {
    const { sendChat, addUser, addSystem, requestRender, handlers } = makeContext();

    await handlers.handleCommand("/context");

    expect(addSystem).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith("/context");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        message: "/context",
      }),
    );
    expect(requestRender).toHaveBeenCalled();
  });

  it("blocks a second send while the first run is still reserving", async () => {
    let resolveSend: ((value: { runId: string }) => void) | undefined;
    const sendChat = vi.fn().mockImplementation(
      () =>
        new Promise<{ runId: string }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { addUser, addSystem, handlers, turnLifecycle } = makeContext({ sendChat });

    const first = handlers.sendMessage("first");
    await Promise.resolve();
    await handlers.sendMessage("second");

    expect(sendChat).toHaveBeenCalledTimes(1);
    expect(addUser).toHaveBeenCalledTimes(1);
    expect(addSystem).toHaveBeenCalledWith("run already in progress");
    expect(turnLifecycle.getSnapshot().phase).toBe("reserving");

    resolveSend?.({ runId: "r1" });
    await first;
  });

  it("does not re-enter waiting after a reserve was cancelled", async () => {
    let resolveSend: ((value: { runId: string }) => void) | undefined;
    const sendChat = vi.fn().mockImplementation(
      () =>
        new Promise<{ runId: string }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { handlers, turnLifecycle, setActivityStatus } = makeContext({ sendChat });

    const sendPromise = handlers.sendMessage("hello");
    await Promise.resolve();

    const runId = turnLifecycle.getSnapshot().activeRunId;
    expect(runId).toBeTruthy();

    turnLifecycle.cancel(runId);
    setActivityStatus("aborted");

    resolveSend?.({ runId: "r1" });
    await sendPromise;

    expect(turnLifecycle.getSnapshot().phase).toBe("cancelled");
    expect(turnLifecycle.getSnapshot().activityLabel).toBe("aborted");
  });

  it("ignores a late send failure after the run was already cancelled", async () => {
    let rejectSend: ((error?: unknown) => void) | undefined;
    const sendChat = vi.fn().mockImplementation(
      () =>
        new Promise<{ runId: string }>((_, reject) => {
          rejectSend = reject;
        }),
    );
    const addSystem = vi.fn();
    const { handlers, turnLifecycle, setActivityStatus } = makeContext({ sendChat, addSystem });

    const sendPromise = handlers.sendMessage("hello");
    await Promise.resolve();

    const runId = turnLifecycle.getSnapshot().activeRunId;
    turnLifecycle.cancel(runId);
    setActivityStatus.mockClear();

    rejectSend?.(new Error("cancelled upstream"));
    await sendPromise;

    expect(turnLifecycle.getSnapshot().phase).toBe("cancelled");
    expect(addSystem).not.toHaveBeenCalledWith(expect.stringContaining("send failed"));
    expect(setActivityStatus).not.toHaveBeenCalledWith("error");
  });

  it("forces a full redraw when requested", async () => {
    const { addSystem, forceRedraw, handlers } = makeContext();

    await handlers.handleCommand("/redraw");

    expect(addSystem).toHaveBeenCalledWith("screen refreshed");
    expect(forceRedraw).toHaveBeenCalledTimes(1);
  });
});
