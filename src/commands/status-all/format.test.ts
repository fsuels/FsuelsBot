import { describe, expect, it } from "vitest";
import { redactSecrets } from "./format.js";

describe("status-all redactSecrets", () => {
  it("redacts env-style secret assignments", () => {
    const redacted = redactSecrets(
      "OPENAI_API_KEY=sk-supersecret\nGITHUB_TOKEN=ghp_12345678901234567890",
    );

    expect(redacted).toContain("OPENAI_API_KEY=***");
    expect(redacted).toContain("GITHUB_TOKEN=***");
    expect(redacted).not.toContain("supersecret");
  });

  it("redacts auth and api-key style headers", () => {
    const redacted = redactSecrets(
      "Authorization: Bearer token-12345\nX-Api-Key: key-12345\nCookie: session=abc",
    );

    expect(redacted).toContain("Authorization: Bearer ***");
    expect(redacted).toContain("X-Api-Key: ***");
    expect(redacted).toContain("Cookie: ***");
  });

  it("redacts JSON secret fields", () => {
    const redacted = redactSecrets(
      '{"accessToken":"abc123","refreshToken":"def456","apiKey":"ghi789"}',
    );

    expect(redacted).toBe('{"accessToken":"***","refreshToken":"***","apiKey":"***"}');
  });

  it("redacts sensitive query parameters", () => {
    const redacted = redactSecrets("https://example.com/report?token=abc123&sig=def456&safe=keep");

    expect(redacted).toContain("token=***");
    expect(redacted).toContain("sig=***");
    expect(redacted).toContain("safe=keep");
  });
});
