import { describe, expect, it, vi } from "vitest";
import { buildRedirectScope, fetchWithSsrFGuard } from "./fetch-guard.js";

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

describe("fetchWithSsrFGuard", () => {
  it("allows redirects that stay inside a path-scoped scope", async () => {
    const lookupFn = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetchImpl = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"))
      .mockResolvedValueOnce(redirectResponse("https://github.com/org/docs"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await fetchWithSsrFGuard({
      url: "https://github.com/org",
      fetchImpl,
      lookupFn,
      redirectScope: buildRedirectScope("https://github.com/org"),
    });

    expect(result.finalUrl).toBe("https://github.com/org/docs");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await result.release();
  });

  it("blocks redirects that escape a path-scoped scope", async () => {
    const lookupFn = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetchImpl = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"))
      .mockResolvedValueOnce(redirectResponse("https://github.com/other"));

    await expect(
      fetchWithSsrFGuard({
        url: "https://github.com/org",
        fetchImpl,
        lookupFn,
        redirectScope: buildRedirectScope("https://github.com/org"),
      }),
    ).rejects.toMatchObject({
      code: "REDIRECT_TARGET_BLOCKED",
      details: expect.objectContaining({
        originalUrl: "https://github.com/org",
        redirectUrl: "https://github.com/other",
      }),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops redirect chains at the configured maxRedirects", async () => {
    const lookupFn = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetchImpl = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"))
      .mockResolvedValueOnce(redirectResponse("/step-2"))
      .mockResolvedValueOnce(redirectResponse("/step-3"))
      .mockResolvedValueOnce(redirectResponse("/step-4"));

    await expect(
      fetchWithSsrFGuard({
        url: "https://example.com/step-1",
        fetchImpl,
        lookupFn,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/Too many redirects/);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives blockedHostnames precedence over allowedHostnames", async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchWithSsrFGuard({
        url: "https://example.com/docs",
        fetchImpl,
        policy: {
          allowedHostnames: ["example.com"],
          blockedHostnames: ["example.com"],
        },
      }),
    ).rejects.toMatchObject({ code: "HOSTNAME_BLOCKED" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows www redirects when the path scope still matches", async () => {
    const lookupFn = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetchImpl = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"))
      .mockResolvedValueOnce(redirectResponse("https://example.com/docs/getting-started"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await fetchWithSsrFGuard({
      url: "https://www.example.com/docs",
      fetchImpl,
      lookupFn,
      redirectScope: buildRedirectScope("https://www.example.com/docs"),
    });

    expect(result.finalUrl).toBe("https://example.com/docs/getting-started");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await result.release();
  });
});
