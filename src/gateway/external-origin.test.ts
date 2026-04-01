import { describe, expect, it } from "vitest";
import { normalizeExternalOrigin } from "./external-origin.js";

describe("normalizeExternalOrigin", () => {
  it("preserves valid external origin metadata", () => {
    expect(
      normalizeExternalOrigin({
        source: "browser-link",
        rawUri: "openclaw://agent?message=review%20this",
        receivedAt: 1_234,
        payloadLength: 11,
        trustLevel: "external",
      }),
    ).toEqual({
      source: "browser-link",
      rawUri: "openclaw://agent?message=review%20this",
      receivedAt: 1_234,
      payloadLength: 11,
      trustLevel: "external",
    });
  });

  it("drops control characters and oversized payload lengths", () => {
    expect(
      normalizeExternalOrigin({
        source: "os-protocol",
        rawUri: "openclaw://agent?message=bad\u0007",
        receivedAt: 55,
        payloadLength: 50_000,
        trustLevel: "external",
      }),
    ).toEqual({
      source: "os-protocol",
      rawUri: undefined,
      receivedAt: 55,
      payloadLength: undefined,
      trustLevel: "external",
    });
  });

  it("falls back unknown sources safely and defaults interactive trust for interactive origins", () => {
    expect(
      normalizeExternalOrigin({
        source: "mystery",
        receivedAt: 99,
      }),
    ).toEqual({
      source: "other",
      rawUri: undefined,
      receivedAt: 99,
      payloadLength: undefined,
      trustLevel: "external",
    });

    expect(
      normalizeExternalOrigin({
        source: "interactive",
        receivedAt: 100,
      }),
    ).toEqual({
      source: "interactive",
      rawUri: undefined,
      receivedAt: 100,
      payloadLength: undefined,
      trustLevel: "interactive",
    });
  });
});
