import { describe, expect, it, vi } from "vitest";
import { getTopModalOverlayId, handleEscapeKeyForOverlayState } from "./app-overlays.ts";

function createEscapeEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    key: "Escape",
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as Pick<
    KeyboardEvent,
    "key" | "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault"
  >;
}

function createState(
  overrides: Partial<Parameters<typeof handleEscapeKeyForOverlayState>[0]["state"]> = {},
) {
  return {
    pendingGatewayUrl: null,
    execApprovalQueue: [],
    connected: false,
    chatRunId: null,
    ...overrides,
  };
}

describe("app overlay precedence", () => {
  it("prioritizes the gateway-url modal over exec approvals", () => {
    expect(
      getTopModalOverlayId({
        pendingGatewayUrl: "wss://example.com/gateway",
        execApprovalQueue: [
          {
            id: "approval-1",
            request: { command: "rm -rf /tmp/demo" },
            createdAtMs: 1_000,
            expiresAtMs: 2_000,
          },
        ],
      }),
    ).toBe("gateway-url-confirmation");
  });

  it("returns the exec-approval modal when no gateway-url modal is pending", () => {
    expect(
      getTopModalOverlayId({
        pendingGatewayUrl: null,
        execApprovalQueue: [
          {
            id: "approval-1",
            request: { command: "rm -rf /tmp/demo" },
            createdAtMs: 1_000,
            expiresAtMs: 2_000,
          },
        ],
      }),
    ).toBe("exec-approval");
  });

  it("dismisses the gateway-url modal before any other escape action", () => {
    const event = createEscapeEvent();
    const onCancelGatewayUrl = vi.fn();
    const onDenyExecApproval = vi.fn();
    const onAbortChat = vi.fn();

    const result = handleEscapeKeyForOverlayState({
      event,
      state: createState({
        pendingGatewayUrl: "wss://example.com/gateway",
        execApprovalQueue: [
          {
            id: "approval-1",
            request: { command: "rm -rf /tmp/demo" },
            createdAtMs: 1_000,
            expiresAtMs: 2_000,
          },
        ],
        connected: true,
        chatRunId: "run-1",
      }),
      onCancelGatewayUrl,
      onDenyExecApproval,
      onAbortChat,
    });

    expect(result).toBe("gateway-url-confirmation");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onCancelGatewayUrl).toHaveBeenCalledOnce();
    expect(onDenyExecApproval).not.toHaveBeenCalled();
    expect(onAbortChat).not.toHaveBeenCalled();
  });

  it("denies the active exec approval before aborting chat", () => {
    const event = createEscapeEvent();
    const onCancelGatewayUrl = vi.fn();
    const onDenyExecApproval = vi.fn();
    const onAbortChat = vi.fn();

    const result = handleEscapeKeyForOverlayState({
      event,
      state: createState({
        execApprovalQueue: [
          {
            id: "approval-1",
            request: { command: "rm -rf /tmp/demo" },
            createdAtMs: 1_000,
            expiresAtMs: 2_000,
          },
        ],
        connected: true,
        chatRunId: "run-1",
      }),
      onCancelGatewayUrl,
      onDenyExecApproval,
      onAbortChat,
    });

    expect(result).toBe("exec-approval");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onCancelGatewayUrl).not.toHaveBeenCalled();
    expect(onDenyExecApproval).toHaveBeenCalledOnce();
    expect(onAbortChat).not.toHaveBeenCalled();
  });

  it("aborts chat when no overlay is active", () => {
    const event = createEscapeEvent();
    const onCancelGatewayUrl = vi.fn();
    const onDenyExecApproval = vi.fn();
    const onAbortChat = vi.fn();

    const result = handleEscapeKeyForOverlayState({
      event,
      state: createState({
        connected: true,
        chatRunId: "run-1",
      }),
      onCancelGatewayUrl,
      onDenyExecApproval,
      onAbortChat,
    });

    expect(result).toBe("chat-abort");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onCancelGatewayUrl).not.toHaveBeenCalled();
    expect(onDenyExecApproval).not.toHaveBeenCalled();
    expect(onAbortChat).toHaveBeenCalledOnce();
  });
});
