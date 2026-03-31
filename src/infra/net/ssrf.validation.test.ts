import { describe, expect, it, vi } from "vitest";
import { resolvePinnedHostnameWithPolicy, validateFetchUrl } from "./ssrf.js";

function expectBlocked(url: string, code: string) {
  try {
    validateFetchUrl(url);
    throw new Error(`Expected ${url} to be blocked`);
  } catch (err) {
    expect(err).toMatchObject({ code });
  }
}

describe("validateFetchUrl", () => {
  it("accepts public http and https URLs and canonicalizes default ports", () => {
    expect(validateFetchUrl("http://example.com/docs").canonicalUrl).toBe(
      "http://example.com/docs",
    );
    expect(validateFetchUrl("https://Example.com:443/docs").canonicalUrl).toBe(
      "https://example.com/docs",
    );
  });

  it("rejects unsupported schemes", () => {
    for (const url of [
      "file:///tmp/secret.txt",
      "ftp://example.com/file.txt",
      "data:text/plain,hi",
    ]) {
      expectBlocked(url, "INVALID_SCHEME");
    }
  });

  it("rejects embedded credentials", () => {
    expectBlocked("https://user:pass@example.com/private", "URL_CREDENTIALS_BLOCKED");
  });

  it("rejects localhost, metadata, and single-label hostnames", () => {
    expectBlocked("http://localhost/health", "LOCALHOST_BLOCKED");
    expectBlocked("http://metadata.google.internal/", "LOCAL_NETWORK_HOSTNAME_BLOCKED");
    expectBlocked("http://printer/status", "LOCAL_NETWORK_HOSTNAME_BLOCKED");
  });

  it("rejects private and reserved IPv4 literals", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://172.16.5.4/",
      "http://192.168.1.20/",
      "http://169.254.10.10/",
      "http://198.51.100.5/",
      "http://203.0.113.9/",
    ]) {
      expectBlocked(url, "PRIVATE_ADDRESS_BLOCKED");
    }
  });

  it("rejects private and reserved IPv6 literals", () => {
    for (const url of ["http://[::1]/", "http://[fc00::1]/", "http://[fe80::1]/"]) {
      expectBlocked(url, "PRIVATE_ADDRESS_BLOCKED");
    }
  });
});

describe("resolvePinnedHostnameWithPolicy", () => {
  it("rejects DNS answers that resolve to private addresses", async () => {
    const lookupFn = vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]);

    await expect(
      resolvePinnedHostnameWithPolicy("public.example", { lookupFn }),
    ).rejects.toMatchObject({
      code: "DNS_RESOLUTION_BLOCKED",
      details: expect.objectContaining({ address: "10.0.0.5" }),
    });
  });
});
