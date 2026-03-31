import { randomUUID } from "node:crypto";
import { WebSocket, type ClientOptions, type CertMeta } from "ws";
import type { DeviceIdentity } from "../infra/device-identity.js";
import {
  clearDeviceAuthToken,
  loadDeviceAuthToken,
  storeDeviceAuthToken,
} from "../infra/device-auth-store.js";
import {
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "../infra/device-identity.js";
import { normalizeFingerprint } from "../infra/tls/fingerprint.js";
import { rawDataToString } from "../infra/ws.js";
import { logDebug, logError } from "../logger.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../utils/message-channel.js";
import { buildDeviceAuthPayload } from "./device-auth.js";
import {
  parseConnectChallengeNonce,
  parseGatewayInboundFrame,
  validateGatewayHelloOk,
  type GatewayProtocolIssue,
} from "./protocol/frame-parser.js";
import {
  type ConnectParams,
  type EventFrame,
  type HelloOk,
  PROTOCOL_VERSION,
  type RequestFrame,
  validateRequestFrame,
} from "./protocol/index.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  expectFinal: boolean;
};

export type GatewayClientState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closing"
  | "closed";

export type GatewayClientOptions = {
  url?: string; // ws://127.0.0.1:18789
  token?: string;
  password?: string;
  instanceId?: string;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  clientVersion?: string;
  platform?: string;
  mode?: GatewayClientMode;
  role?: string;
  scopes?: string[];
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  deviceIdentity?: DeviceIdentity;
  minProtocol?: number;
  maxProtocol?: number;
  tlsFingerprint?: string;
  onEvent?: (evt: EventFrame) => void;
  onHelloOk?: (hello: HelloOk) => void;
  onConnectError?: (err: Error) => void;
  onClose?: (code: number, reason: string) => void;
  onProtocolIssue?: (issue: GatewayProtocolIssue) => void;
  onGap?: (info: {
    expected: number;
    received: number;
    reset?: boolean;
    latestSeq?: number;
    bufferedFromSeq?: number;
  }) => void;
};

export const GATEWAY_CLOSE_CODE_HINTS: Readonly<Record<number, string>> = {
  1000: "normal closure",
  1006: "abnormal closure (no close frame)",
  1008: "policy violation",
  1012: "service restart",
};

export function describeGatewayCloseCode(code: number): string | undefined {
  return GATEWAY_CLOSE_CODE_HINTS[code];
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

export class GatewayClient {
  private ws: WebSocket | null = null;
  private opts: GatewayClientOptions;
  private pending = new Map<string, Pending>();
  private backoffMs = 1000;
  private closed = false;
  private state: GatewayClientState = "idle";
  private lastSeq: number | null = null;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Track last tick to detect silent stalls.
  private lastTick: number | null = null;
  private tickIntervalMs = 30_000;
  private tickTimer: NodeJS.Timeout | null = null;
  private transportGeneration = 0;
  private connectSupportsEventResume = true;

  constructor(opts: GatewayClientOptions) {
    this.opts = {
      ...opts,
      deviceIdentity: opts.deviceIdentity ?? loadOrCreateDeviceIdentity(),
    };
  }

  getState(): GatewayClientState {
    return this.state;
  }

  start() {
    this.closed = false;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const url = this.opts.url ?? "ws://127.0.0.1:18789";
    if (this.opts.tlsFingerprint && !url.startsWith("wss://")) {
      this.opts.onConnectError?.(new Error("gateway tls fingerprint requires wss:// gateway url"));
      return;
    }
    this.state = this.state === "reconnecting" ? "reconnecting" : "connecting";
    // Allow node screen snapshots and other large responses.
    const wsOptions: ClientOptions = {
      maxPayload: 25 * 1024 * 1024,
    };
    if (url.startsWith("wss://") && this.opts.tlsFingerprint) {
      wsOptions.rejectUnauthorized = false;
      wsOptions.checkServerIdentity = ((_host: string, cert: CertMeta) => {
        const fingerprintValue =
          typeof cert === "object" && cert && "fingerprint256" in cert
            ? ((cert as { fingerprint256?: string }).fingerprint256 ?? "")
            : "";
        const fingerprint = normalizeFingerprint(
          typeof fingerprintValue === "string" ? fingerprintValue : "",
        );
        const expected = normalizeFingerprint(this.opts.tlsFingerprint ?? "");
        if (!expected) {
          return new Error("gateway tls fingerprint missing");
        }
        if (!fingerprint) {
          return new Error("gateway tls fingerprint unavailable");
        }
        if (fingerprint !== expected) {
          return new Error("gateway tls fingerprint mismatch");
        }
        return undefined;
        // oxlint-disable-next-line typescript/no-explicit-any
      }) as any;
    }
    const ws = new WebSocket(url, wsOptions);
    const generation = ++this.transportGeneration;
    this.ws = ws;

    ws.on("open", () => {
      if (!this.isCurrentTransport(ws, generation)) {
        this.safeCloseSocket(ws);
        return;
      }
      if (url.startsWith("wss://") && this.opts.tlsFingerprint) {
        const tlsError = this.validateTlsFingerprint();
        if (tlsError) {
          this.opts.onConnectError?.(tlsError);
          this.ws?.close(1008, tlsError.message);
          return;
        }
      }
      this.queueConnect();
    });
    ws.on("message", (data) => {
      if (!this.isCurrentTransport(ws, generation)) {
        return;
      }
      this.handleMessage(rawDataToString(data));
    });
    ws.on("close", (code, reason) => {
      if (!this.isCurrentTransport(ws, generation)) {
        return;
      }
      const reasonText = rawDataToString(reason);
      if (code === 1012) {
        this.lastSeq = null;
      }
      this.ws = null;
      this.connectSent = false;
      this.connectNonce = null;
      this.lastTick = null;
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.flushPendingErrors(new Error(`gateway closed (${code}): ${reasonText}`));
      this.scheduleReconnect();
      this.opts.onClose?.(code, reasonText);
    });
    ws.on("error", (err) => {
      if (!this.isCurrentTransport(ws, generation)) {
        return;
      }
      logDebug(`gateway client error: ${String(err)}`);
      if (!this.connectSent) {
        this.opts.onConnectError?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  stop() {
    this.closed = true;
    this.state = "closing";
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    const ws = this.ws;
    this.transportGeneration += 1;
    this.ws = null;
    ws?.close();
    this.flushPendingErrors(new Error("gateway client stopped"));
    this.state = "closed";
  }

  private sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const role = this.opts.role ?? "operator";
    const storedToken = this.opts.deviceIdentity
      ? loadDeviceAuthToken({ deviceId: this.opts.deviceIdentity.deviceId, role })?.token
      : null;
    const authToken = storedToken ?? this.opts.token ?? undefined;
    const canFallbackToShared = Boolean(storedToken && this.opts.token);
    const auth =
      authToken || this.opts.password
        ? {
            token: authToken,
            password: this.opts.password,
          }
        : undefined;
    const signedAtMs = Date.now();
    const nonce = this.connectNonce ?? undefined;
    const scopes = this.opts.scopes ?? ["operator.admin"];
    const device = (() => {
      if (!this.opts.deviceIdentity) {
        return undefined;
      }
      const payload = buildDeviceAuthPayload({
        deviceId: this.opts.deviceIdentity.deviceId,
        clientId: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
        clientMode: this.opts.mode ?? GATEWAY_CLIENT_MODES.BACKEND,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = signDevicePayload(this.opts.deviceIdentity.privateKeyPem, payload);
      return {
        id: this.opts.deviceIdentity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(this.opts.deviceIdentity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    })();
    const params: ConnectParams = {
      minProtocol: this.opts.minProtocol ?? PROTOCOL_VERSION,
      maxProtocol: this.opts.maxProtocol ?? PROTOCOL_VERSION,
      client: {
        id: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
        displayName: this.opts.clientDisplayName,
        version: this.opts.clientVersion ?? "dev",
        platform: this.opts.platform ?? process.platform,
        mode: this.opts.mode ?? GATEWAY_CLIENT_MODES.BACKEND,
        instanceId: this.opts.instanceId,
      },
      caps: Array.isArray(this.opts.caps) ? this.opts.caps : [],
      commands: Array.isArray(this.opts.commands) ? this.opts.commands : undefined,
      permissions:
        this.opts.permissions && typeof this.opts.permissions === "object"
          ? this.opts.permissions
          : undefined,
      pathEnv: this.opts.pathEnv,
      auth,
      role,
      scopes,
      device,
    };
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
        const helloOk = helloResult.value;
        const authInfo = helloOk?.auth;
        if (authInfo?.deviceToken && this.opts.deviceIdentity) {
          storeDeviceAuthToken({
            deviceId: this.opts.deviceIdentity.deviceId,
            role: authInfo.role ?? role,
            token: authInfo.deviceToken,
            scopes: authInfo.scopes ?? [],
          });
        }
        this.backoffMs = 1000;
        this.tickIntervalMs =
          typeof helloOk.policy?.tickIntervalMs === "number"
            ? helloOk.policy.tickIntervalMs
            : 30_000;
        const resume = helloOk.resume;
        if (resume) {
          if (resume.gap || resume.reset) {
            this.opts.onGap?.({
              expected: resume.requestedSeq + 1,
              received: resume.bufferedFromSeq ?? resume.latestSeq,
              reset: resume.reset,
              latestSeq: resume.latestSeq,
              bufferedFromSeq: resume.bufferedFromSeq,
            });
          }
          if (resume.reset) {
            this.lastSeq = resume.latestSeq > 0 ? resume.latestSeq : null;
          } else if (typeof resume.replayedThroughSeq === "number") {
            this.lastSeq = resume.replayedThroughSeq;
          }
        } else {
          this.lastSeq = null;
        }
        this.lastTick = Date.now();
        this.state = "connected";
        this.startTickWatch();
        this.opts.onHelloOk?.(helloOk);
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        if (
          params.lastEventSeq !== undefined &&
          this.connectSupportsEventResume &&
          /invalid connect params:/i.test(error.message)
        ) {
          this.connectSupportsEventResume = false;
          this.connectSent = false;
          this.backoffMs = Math.min(this.backoffMs, 250);
          this.ws?.close(1012, "retry without event resume");
          return;
        }
        if (canFallbackToShared && this.opts.deviceIdentity) {
          clearDeviceAuthToken({
            deviceId: this.opts.deviceIdentity.deviceId,
            role,
          });
        }
        const shouldRetry = shouldRetryConnectError(error, {
          allowSharedTokenRetry: canFallbackToShared,
        });
        if (!shouldRetry) {
          this.closed = true;
          this.state = "closed";
        }
        this.opts.onConnectError?.(error);
        const msg = `gateway connect failed: ${String(error)}`;
        if (this.opts.mode === GATEWAY_CLIENT_MODES.PROBE) {
          logDebug(msg);
        } else {
          logError(msg);
        }
        this.ws?.close(1008, shouldRetry ? "connect failed" : "connect failed: permanent");
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
        this.sendConnect();
        return;
      }
      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null) {
          if (seq <= this.lastSeq) {
            logDebug(`gateway client ignored duplicate/stale event seq=${seq}`);
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
      this.opts.onEvent?.(evt);
      return;
    }

    const res = parsed.value.frame;
    const pending = this.pending.get(res.id);
    if (!pending) {
      return;
    }
    // If the payload is an ack with status accepted, keep waiting for final.
    const payload = res.payload as { status?: unknown } | undefined;
    const status = payload?.status;
    if (pending.expectFinal && status === "accepted") {
      return;
    }
    this.pending.delete(res.id);
    if (res.ok) {
      pending.resolve(res.payload);
    } else {
      pending.reject(new Error(res.error?.message ?? "unknown error"));
    }
  }

  private reportProtocolIssue(issue: GatewayProtocolIssue) {
    const frameType = issue.frameType ? ` type=${issue.frameType}` : "";
    logDebug(`gateway client protocol issue [${issue.code}]${frameType}: ${issue.message}`);
    this.opts.onProtocolIssue?.(issue);
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
    }
    this.connectTimer = setTimeout(() => {
      this.sendConnect();
    }, 750);
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    this.state = "reconnecting";
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.reconnectTimer) {
      return;
    }
    const baseDelay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.max(100, Math.round(baseDelay * jitter));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
    this.reconnectTimer.unref();
  }

  private flushPendingErrors(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private startTickWatch() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
    const interval = Math.max(this.tickIntervalMs, 1000);
    this.tickTimer = setInterval(() => {
      if (this.closed) {
        return;
      }
      if (!this.lastTick) {
        return;
      }
      const gap = Date.now() - this.lastTick;
      if (gap > this.tickIntervalMs * 2) {
        this.ws?.close(4000, "tick timeout");
      }
    }, interval);
  }

  private validateTlsFingerprint(): Error | null {
    if (!this.opts.tlsFingerprint || !this.ws) {
      return null;
    }
    const expected = normalizeFingerprint(this.opts.tlsFingerprint);
    if (!expected) {
      return new Error("gateway tls fingerprint missing");
    }
    const socket = (
      this.ws as WebSocket & {
        _socket?: { getPeerCertificate?: () => { fingerprint256?: string } };
      }
    )._socket;
    if (!socket || typeof socket.getPeerCertificate !== "function") {
      return new Error("gateway tls fingerprint unavailable");
    }
    const cert = socket.getPeerCertificate();
    const fingerprint = normalizeFingerprint(cert?.fingerprint256 ?? "");
    if (!fingerprint) {
      return new Error("gateway tls fingerprint unavailable");
    }
    if (fingerprint !== expected) {
      return new Error("gateway tls fingerprint mismatch");
    }
    return null;
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

  async request<T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean },
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway not connected");
    }
    const id = randomUUID();
    const frame: RequestFrame = { type: "req", id, method, params };
    if (!validateRequestFrame(frame)) {
      throw new Error(
        `invalid request frame: ${JSON.stringify(validateRequestFrame.errors, null, 2)}`,
      );
    }
    const expectFinal = opts?.expectFinal === true;
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        expectFinal,
      });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }
}
