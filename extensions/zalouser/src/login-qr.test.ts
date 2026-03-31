import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfig = vi.fn(() => ({}));
const checkZcaAuthenticated = vi.fn();
const resolveZalouserAccountSync = vi.fn(
  ({ accountId }: { accountId?: string }) =>
    ({
      accountId: accountId ?? "default",
      enabled: true,
      authenticated: false,
      profile: accountId ?? "default",
      config: {},
    }) as const,
);
const checkZcaInstalled = vi.fn();
const runZca = vi.fn();

vi.mock("./runtime.js", () => ({
  getZalouserRuntime: () => ({
    config: {
      loadConfig,
    },
  }),
}));

vi.mock("./accounts.js", () => ({
  checkZcaAuthenticated,
  resolveZalouserAccountSync,
}));

vi.mock("./zca.js", () => ({
  checkZcaInstalled,
  runZca,
}));

const { startZalouserLoginWithQr, waitForZalouserLogin, __testing } = await import("./login-qr.js");

describe("zalouser login qr", () => {
  beforeEach(() => {
    loadConfig.mockReturnValue({});
    checkZcaInstalled.mockReset();
    checkZcaAuthenticated.mockReset();
    resolveZalouserAccountSync.mockClear();
    runZca.mockReset();
    __testing.resetActiveLogins();
  });

  afterEach(() => {
    __testing.resetActiveLogins();
  });

  it("reuses the active QR instead of starting duplicate login flows", async () => {
    checkZcaInstalled.mockResolvedValue(true);
    checkZcaAuthenticated.mockResolvedValue(false);
    runZca.mockResolvedValue({
      ok: true,
      stdout: "data:image/png;base64,abc123",
      stderr: "",
      exitCode: 0,
    });

    const first = await startZalouserLoginWithQr({ accountId: "work" });
    const second = await startZalouserLoginWithQr({ accountId: "work" });

    expect(first.qrDataUrl).toBe("data:image/png;base64,abc123");
    expect(second.qrDataUrl).toBe("data:image/png;base64,abc123");
    expect(second.message).toMatch(/QR already active/i);
    expect(runZca).toHaveBeenCalledTimes(1);
  });

  it("returns completed when the account is already authenticated", async () => {
    checkZcaInstalled.mockResolvedValue(true);
    checkZcaAuthenticated.mockResolvedValue(true);

    const result = await startZalouserLoginWithQr({ accountId: "default" });

    expect(result.qrDataUrl).toBeUndefined();
    expect(result.message).toMatch(/already authenticated/i);
    expect(runZca).not.toHaveBeenCalled();
  });

  it("waits for authentication to complete in the background", async () => {
    checkZcaInstalled.mockResolvedValue(true);
    const authStates = [false, false, false, false, true];
    checkZcaAuthenticated.mockImplementation(async () => authStates.shift() ?? true);
    runZca.mockResolvedValue({
      ok: true,
      stdout: "data:image/png;base64,wait123",
      stderr: "",
      exitCode: 0,
    });

    await startZalouserLoginWithQr({ accountId: "default" });
    const result = await waitForZalouserLogin({
      accountId: "default",
      timeoutMs: 100,
      pollIntervalMs: 10,
    });

    expect(result.connected).toBe(true);
    expect(result.message).toMatch(/login successful/i);
  });
});
