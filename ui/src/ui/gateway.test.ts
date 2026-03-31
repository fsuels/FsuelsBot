import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayBrowserClient } from "./gateway.ts";

type FakeListener = (event?: {
  data?: unknown;
  code?: number;
  reason?: string;
  wasClean?: boolean;
}) => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, FakeListener[]>();

  constructor(public url: string) {
    fakeSockets.push(this);
  }

  addEventListener(type: string, listener: FakeListener) {
    const next = this.listeners.get(type) ?? [];
    next.push(listener);
    this.listeners.set(type, next);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code: code ?? 1000, reason: reason ?? "", wasClean: true });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  message(data: unknown) {
    this.dispatch("message", { data });
  }

  private dispatch(
    type: string,
    event: { data?: unknown; code?: number; reason?: string; wasClean?: boolean },
  ) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const fakeSockets: FakeWebSocket[] = [];

async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function connectFrameId(socket: FakeWebSocket): string {
  const frame = JSON.parse(socket.sent[0] ?? "{}") as { id?: unknown };
  if (typeof frame.id !== "string" || !frame.id) {
    throw new Error("connect frame id missing");
  }
  return frame.id;
}

function helloOkPayload(overrides?: Record<string, unknown>) {
  return {
    type: "hello-ok",
    protocol: 3,
    server: { version: "dev", connId: "conn-1" },
    features: { methods: [], events: [] },
    snapshot: {
      presence: [],
      health: {},
      stateVersion: { presence: 1, health: 1 },
      uptimeMs: 1,
    },
    policy: {
      maxPayload: 512 * 1024,
      maxBufferedBytes: 1024 * 1024,
      tickIntervalMs: 30_000,
    },
    ...overrides,
  };
}

describe("GatewayBrowserClient", () => {
  afterEach(() => {
    fakeSockets.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ignores malformed and unknown frames while keeping valid events flowing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { subtle: undefined });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onProtocolIssue = vi.fn();

    const events: string[] = [];
    const client = new GatewayBrowserClient({
      url: "ws://gateway.test",
      onEvent: (evt) => events.push(evt.event),
      onProtocolIssue,
    });

    client.start();
    expect(fakeSockets).toHaveLength(1);

    const socket = fakeSockets[0];
    socket.open();
    vi.advanceTimersByTime(750);
    await flushTasks();

    socket.message(
      JSON.stringify({
        type: "res",
        id: connectFrameId(socket),
        ok: true,
        payload: helloOkPayload(),
      }),
    );
    await flushTasks();

    socket.message("{oops");
    socket.message(JSON.stringify({ type: "future", payload: { version: 2 } }));
    socket.message(JSON.stringify({ type: "event", event: "custom", payload: { ok: true } }));

    expect(events).toEqual(["custom"]);
    expect(onProtocolIssue.mock.calls.map(([issue]) => issue.code)).toEqual([
      "invalid_json",
      "unsupported_frame_type",
    ]);
    expect(fakeSockets).toHaveLength(1);
    client.stop();
  });

  it("stops reconnecting after a permanent auth failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { subtle: undefined });
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const onConnectError = vi.fn();
    const client = new GatewayBrowserClient({
      url: "ws://gateway.test",
      token: "bad-token",
      onConnectError,
    });

    client.start();
    const socket = fakeSockets[0];
    socket.open();
    vi.advanceTimersByTime(750);
    await flushTasks();

    socket.message(
      JSON.stringify({
        type: "res",
        id: connectFrameId(socket),
        ok: false,
        error: { code: "INVALID_REQUEST", message: "unauthorized: gateway token mismatch" },
      }),
    );
    await flushTasks();
    vi.advanceTimersByTime(5_000);

    expect(onConnectError).toHaveBeenCalledWith(expect.any(Error));
    expect(client.getState()).toBe("closed");
    expect(fakeSockets).toHaveLength(1);
  });

  it("reconnects after tick timeout with a single scheduled retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { subtle: undefined });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(Math, "random").mockReturnValue(0);

    const client = new GatewayBrowserClient({
      url: "ws://gateway.test",
    });

    client.start();
    const firstSocket = fakeSockets[0];
    firstSocket.open();
    vi.advanceTimersByTime(750);
    await flushTasks();

    firstSocket.message(
      JSON.stringify({
        type: "res",
        id: connectFrameId(firstSocket),
        ok: true,
        payload: helloOkPayload({
          policy: {
            maxPayload: 512 * 1024,
            maxBufferedBytes: 1024 * 1024,
            tickIntervalMs: 5,
          },
        }),
      }),
    );
    await flushTasks();

    vi.advanceTimersByTime(1_000);
    await flushTasks();
    vi.advanceTimersByTime(640);

    expect(fakeSockets).toHaveLength(2);
    expect(client.getState()).toBe("reconnecting");
    client.stop();
  });

  it("reports invalid hello-ok payloads during connect", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { subtle: undefined });
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const onConnectError = vi.fn();
    const onProtocolIssue = vi.fn();
    const client = new GatewayBrowserClient({
      url: "ws://gateway.test",
      onConnectError,
      onProtocolIssue,
    });

    client.start();
    const socket = fakeSockets[0];
    socket.open();
    vi.advanceTimersByTime(750);
    await flushTasks();

    socket.message(
      JSON.stringify({
        type: "res",
        id: connectFrameId(socket),
        ok: true,
        payload: {
          type: "hello-ok",
          protocol: 3,
        },
      }),
    );
    await flushTasks();

    expect(onProtocolIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_hello" }),
    );
    expect(onConnectError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("invalid hello-ok payload") }),
    );
    client.stop();
  });

  it("reports non-text websocket payloads and close metadata", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("crypto", { subtle: undefined });
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const onProtocolIssue = vi.fn();
    const onClose = vi.fn();
    const client = new GatewayBrowserClient({
      url: "ws://gateway.test",
      onProtocolIssue,
      onClose,
    });

    client.start();
    const socket = fakeSockets[0];
    socket.open();
    socket.message(new Uint8Array([1, 2, 3]));
    socket.close(4001, "bye");
    await flushTasks();

    expect(onProtocolIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unexpected_ws_payload" }),
    );
    expect(onClose).toHaveBeenCalledWith({ code: 4001, reason: "bye", wasClean: true });
    client.stop();
  });
});
