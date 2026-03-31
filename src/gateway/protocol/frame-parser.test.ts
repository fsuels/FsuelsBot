import { describe, expect, it } from "vitest";
import {
  parseConnectChallengeNonce,
  parseGatewayInboundFrame,
  validateGatewayHelloOk,
} from "./frame-parser.js";

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

describe("gateway frame parser", () => {
  it("rejects malformed json", () => {
    const result = parseGatewayInboundFrame("{oops");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_json");
    }
  });

  it("rejects unsupported frame types", () => {
    const result = parseGatewayInboundFrame(JSON.stringify({ type: "future", payload: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("unsupported_frame_type");
    }
  });

  it("rejects malformed response frames before nested access", () => {
    const result = parseGatewayInboundFrame(JSON.stringify({ type: "res", ok: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_response_frame");
      expect(result.issue.message).toContain("frame.id");
    }
  });

  it("validates hello-ok payloads", () => {
    const result = validateGatewayHelloOk(helloOkPayload());
    expect(result.ok).toBe(true);
  });

  it("rejects invalid hello-ok payloads", () => {
    const result = validateGatewayHelloOk({ type: "hello-ok", protocol: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("invalid_hello");
      expect(result.issue.message).toContain("hello.server");
    }
  });

  it("extracts connect.challenge nonce only from valid payloads", () => {
    const ok = parseConnectChallengeNonce({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "abc123" },
    });
    expect(ok).toEqual({ ok: true, value: "abc123" });

    const bad = parseConnectChallengeNonce({
      type: "event",
      event: "connect.challenge",
      payload: {},
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issue.code).toBe("invalid_connect_challenge");
    }
  });
});
