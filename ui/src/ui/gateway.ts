import { buildDeviceAuthPayload } from "../../../src/gateway/device-auth.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../../src/gateway/protocol/client-info.js";
import {
  parseConnectChallengeNonce,
  parseGatewayInboundFrame,
  validateGatewayHelloOk,
  type EventFrame as SharedGatewayEventFrame,
  type GatewayProtocolIssue,
  type HelloOk as SharedGatewayHelloOk,
} from "../../../src/gateway/protocol/frame-parser.js";
import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "./device-identity.ts";
import { generateUUID } from "./uuid.ts";

export type GatewayEventFrame = SharedGatewayEventFrame;
export type GatewayHelloOk = SharedGatewayHelloOk;

export type GatewayBrowserClientState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closing"
  | "closed";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type GatewayBrowserClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientName?: GatewayClientName;
  clientVersion?: string;
  platform?: string;
  mode?: GatewayClientMode;
  instanceId?: string;
  onHello?: (hello: GatewayHelloOk) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onConnectError?: (err: Error) => void;
  onClose?: (info: { code: number; reason: string; wasClean: boolean }) => void;
  onProtocolIssue?: (issue: GatewayProtocolIssue) => void;
  onGap?: (info: {
    expected: number;
    received: number;
    reset?: boolean;
    latestSeq?: number;
    bufferedFromSeq?: number;
  }) => void;
};

// 4008 = application-defined code (browser rejects 1008 "Policy Violation")
const CONNECT_FAILED_CLOSE_CODE = 4008;

function describeSocketPayload(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return "Blob";
  }
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    return "ArrayBuffer";
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
    return value.constructor?.name ?? "TypedArray";
  }
  return typeof value;
}

const PERMANENT_CONNECT_ERROR_PATTERNS = [
  /unauthorized/i,
  /origin not allowed/i,
  /invalid role/i,
  /protocol mismatch/i,
  /invalid handshake/i,
  /tls fingerprint/i,
  /device identity required/i,
  /secure context/i,
];

function shouldRetryConnectError(error: Error, opts: { allowSharedTokenRetry: boolean }): boolean {
  if (opts.allowSharedTokenRetry) {
    return true;
  }
  return !PERMANENT_CONNECT_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

export class GatewayBrowserClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private state: GatewayBrowserClientState = "idle";
  private lastSeq: number | null = null;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: number | null = null;
  private backoffMs = 800;
  private reconnectTimer: number | null = null;
  private lastTick: number | null = null;
  private tickIntervalMs = 30_000;
  private tickTimer: number | null = null;
  private transportGeneration = 0;
  private connectSupportsEventResume = true;

  constructor(private opts: GatewayBrowserClientOptions) {}

  start() {
    this.closed = false;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.connect();
  }

  stop() {
    this.closed = true;
    this.state = "closing";
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    const ws = this.ws;
    this.transportGeneration += 1;
    this.ws = null;
    ws?.close();
    this.flushPending(new Error("gateway client stopped"));
    this.state = "closed";
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getState() {
    return this.state;
  }

  private connect() {
    if (this.closed) {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state = this.state === "reconnecting" ? "reconnecting" : "connecting";
    const ws = new WebSocket(this.opts.url);
    const generation = ++this.transportGeneration;
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (!this.isCurrentTransport(ws, generation)) {
        this.safeCloseSocket(ws);
        return;
      }
      this.queueConnect();
    });
    ws.addEventListener("message", (ev) => {
      if (!this.isCurrentTransport(ws, generation)) {
        return;
      }
      if (typeof ev.data !== "string") {
        this.reportProtocolIssue({
          code: "unexpected_ws_payload",
          message: `unexpected gateway WebSocket payload type: ${describeSocketPayload(ev.data)}`,
        });
        return;
      }
      this.handleMessage(ev.data);
    });
    ws.addEventListener("close", (ev) => {
      if (!this.isCurrentTransport(ws, generation)) {
        return;
      }
      const reason = String(ev.reason ?? "");
      if (ev.code === 1012) {
        this.lastSeq = null;
      }
      this.ws = null;
      this.connectSent = false;
      this.connectNonce = null;
      this.lastTick = null;
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.flushPending(new Error(`gateway closed (${ev.code}): ${reason}`));
      this.opts.onClose?.({ code: ev.code, reason, wasClean: Boolean(ev.wasClean) });
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      if (!this.isCurrentTransport(ws, generation)) {
        return;
      }
      // ignored; close handler will fire
    });
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    this.state = "reconnecting";
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.reconnectTimer !== null) {
      return;
    }
    const baseDelay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.max(100, Math.round(baseDelay * jitter));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    // crypto.subtle is only available in secure contexts (HTTPS, localhost).
    // Over plain HTTP, we skip device identity and fall back to token-only auth.
    // Gateways may reject this unless gateway.controlUi.allowInsecureAuth is enabled.
    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;

    const scopes = ["operator.admin", "operator.approvals", "operator.pairing"];
    const role = "operator";
    let deviceIdentity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>> | null = null;
    let canFallbackToShared = false;
    let authToken = this.opts.token;

    if (isSecureContext) {
      deviceIdentity = await loadOrCreateDeviceIdentity();
      const storedToken = loadDeviceAuthToken({
        deviceId: deviceIdentity.deviceId,
        role,
      })?.token;
      authToken = storedToken ?? this.opts.token;
      canFallbackToShared = Boolean(storedToken && this.opts.token);
    }
    const auth =
      authToken || this.opts.password
        ? {
            token: authToken,
            password: this.opts.password,
          }
        : undefined;

    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string | undefined;
        }
      | undefined;

    if (isSecureContext && deviceIdentity) {
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? undefined;
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.CONTROL_UI,
        clientMode: this.opts.mode ?? GATEWAY_CLIENT_MODES.WEBCHAT,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(deviceIdentity.privateKey, payload);
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.CONTROL_UI,
        version: this.opts.clientVersion ?? "dev",
        platform: this.opts.platform ?? navigator.platform ?? "web",
        mode: this.opts.mode ?? GATEWAY_CLIENT_MODES.WEBCHAT,
        instanceId: this.opts.instanceId,
      },
      role,
      scopes,
      device,
      caps: [],
      auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    } as Record<string, unknown>;
    if (this.connectSupportsEventResume && this.lastSeq !== null) {
      params.lastEventSeq = this.lastSeq;
    }

    void this.request<unknown>("connect", params)
      .then((helloRaw) => {
        const helloResult = validateGatewayHelloOk(helloRaw);
        if (!helloResult.ok) {
          this.reportProtocolIssue(helloResult.issue);
          throw new Error(helloResult.issue.message);
        }
        const hello = helloResult.value;
        if (hello?.auth?.deviceToken && deviceIdentity) {
          storeDeviceAuthToken({
            deviceId: deviceIdentity.deviceId,
            role: hello.auth.role ?? role,
            token: hello.auth.deviceToken,
            scopes: hello.auth.scopes ?? [],
          });
        }
        this.backoffMs = 800;
        if (hello.resume) {
          if (hello.resume.gap || hello.resume.reset) {
            this.opts.onGap?.({
              expected: hello.resume.requestedSeq + 1,
              received: hello.resume.bufferedFromSeq ?? hello.resume.latestSeq,
              reset: hello.resume.reset,
              latestSeq: hello.resume.latestSeq,
              bufferedFromSeq: hello.resume.bufferedFromSeq,
            });
          }
          if (hello.resume.reset) {
            this.lastSeq = hello.resume.latestSeq > 0 ? hello.resume.latestSeq : null;
          } else if (typeof hello.resume.replayedThroughSeq === "number") {
            this.lastSeq = hello.resume.replayedThroughSeq;
          }
        } else {
          this.lastSeq = null;
        }
        this.tickIntervalMs =
          typeof hello.policy?.tickIntervalMs === "number" ? hello.policy.tickIntervalMs : 30_000;
        this.lastTick = Date.now();
        this.state = "connected";
        this.startTickWatch();
        this.opts.onHello?.(hello);
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const message = err instanceof Error ? err.message : String(err);
        if (
          params.lastEventSeq !== undefined &&
          this.connectSupportsEventResume &&
          /invalid connect params:/i.test(message)
        ) {
          this.connectSupportsEventResume = false;
          this.connectSent = false;
          this.backoffMs = Math.min(this.backoffMs, 250);
          this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "retry without event resume");
          return;
        }
        if (canFallbackToShared && deviceIdentity) {
          clearDeviceAuthToken({ deviceId: deviceIdentity.deviceId, role });
        }
        const shouldRetry = shouldRetryConnectError(error, {
          allowSharedTokenRetry: canFallbackToShared,
        });
        if (!shouldRetry) {
          this.closed = true;
          this.state = "closed";
        }
        this.opts.onConnectError?.(error);
        console.error("[gateway] connect failed:", error);
        this.ws?.close(
          CONNECT_FAILED_CLOSE_CODE,
          shouldRetry ? "connect failed" : "connect failed: permanent",
        );
      });
  }

  private handleMessage(raw: string) {
    const parsed = parseGatewayInboundFrame(raw);
    if (!parsed.ok) {
      this.reportProtocolIssue(parsed.issue);
      return;
    }

    if (parsed.value.kind === "event") {
      const evt = parsed.value.frame;
      if (evt.event === "connect.challenge") {
        const nonceResult = parseConnectChallengeNonce(evt);
        if (!nonceResult.ok) {
          this.reportProtocolIssue(nonceResult.issue);
          return;
        }
        this.connectNonce = nonceResult.value;
        void this.sendConnect();
        return;
      }
      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null) {
          if (seq <= this.lastSeq) {
            console.debug(`[gateway] ignored duplicate/stale event seq=${seq}`);
            return;
          }
          if (seq > this.lastSeq + 1) {
            this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
          }
        }
        this.lastSeq = seq;
      }
      if (evt.event === "tick") {
        this.lastTick = Date.now();
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (err) {
        console.error("[gateway] event handler error:", err);
      }
      return;
    }

    const res = parsed.value.frame;
    const pending = this.pending.get(res.id);
    if (!pending) {
      return;
    }
    this.pending.delete(res.id);
    if (res.ok) {
      pending.resolve(res.payload);
    } else {
      pending.reject(new Error(res.error?.message ?? "request failed"));
    }
  }

  private reportProtocolIssue(issue: GatewayProtocolIssue) {
    const frameType = issue.frameType ? ` type=${issue.frameType}` : "";
    console.warn(`[gateway] protocol issue [${issue.code}]${frameType}: ${issue.message}`);
    this.opts.onProtocolIssue?.(issue);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, 750);
  }

  private startTickWatch() {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
    }
    const interval = Math.max(this.tickIntervalMs, 1000);
    this.tickTimer = window.setInterval(() => {
      if (this.closed || !this.lastTick) {
        return;
      }
      const gap = Date.now() - this.lastTick;
      if (gap > this.tickIntervalMs * 2) {
        this.ws?.close(4000, "tick timeout");
      }
    }, interval);
  }

  private isCurrentTransport(ws: WebSocket, generation: number): boolean {
    return this.ws === ws && this.transportGeneration === generation;
  }

  private safeCloseSocket(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}
