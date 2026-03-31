import { randomUUID } from "node:crypto";
import { checkZcaAuthenticated, resolveZalouserAccountSync } from "./accounts.js";
import { getZalouserRuntime } from "./runtime.js";
import { checkZcaInstalled, runZca } from "./zca.js";

type ActiveLogin = {
  id: string;
  accountId: string;
  profile: string;
  startedAt: number;
  qrDataUrl?: string;
};

const ACTIVE_LOGIN_TTL_MS = 3 * 60_000;
const activeLogins = new Map<string, ActiveLogin>();

function buildLoginKey(profile: string): string {
  return profile.trim().toLowerCase();
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function clearActiveLogin(profile: string): void {
  activeLogins.delete(buildLoginKey(profile));
}

function extractQrDataUrl(output: string): string | undefined {
  const match = output.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/);
  return match?.[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startZalouserLoginWithQr(
  opts: {
    accountId?: string;
    force?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<{ qrDataUrl?: string; message: string }> {
  const cfg = getZalouserRuntime().config.loadConfig();
  const account = resolveZalouserAccountSync({ cfg, accountId: opts.accountId });
  const loginKey = buildLoginKey(account.profile);

  if (!(await checkZcaInstalled())) {
    return {
      message: "Failed to start Zalo login: zca CLI not found in PATH.",
    };
  }

  if (!opts.force && (await checkZcaAuthenticated(account.profile))) {
    return {
      message: `Zalo Personal is already authenticated (${account.profile}).`,
    };
  }

  const existing = activeLogins.get(loginKey);
  if (!opts.force && existing && isLoginFresh(existing) && existing.qrDataUrl) {
    return {
      qrDataUrl: existing.qrDataUrl,
      message: "QR already active. Scan it in the Zalo app.",
    };
  }

  clearActiveLogin(account.profile);

  const result = await runZca(["auth", "login", "--qr-base64"], {
    profile: account.profile,
    timeout: Math.max(opts.timeoutMs ?? 30_000, 5_000),
  });
  if (!result.ok) {
    return {
      message: `Failed to start Zalo login: ${result.stderr || "unknown error"}`,
    };
  }

  if (await checkZcaAuthenticated(account.profile)) {
    clearActiveLogin(account.profile);
    return {
      message: `Zalo Personal authentication already completed (${account.profile}).`,
    };
  }

  const qrDataUrl = extractQrDataUrl(result.stdout);
  if (!qrDataUrl) {
    return {
      message:
        result.stdout ||
        "Zalo login started, but no QR image was returned. Check the gateway host terminal.",
    };
  }

  activeLogins.set(loginKey, {
    id: randomUUID(),
    accountId: account.accountId,
    profile: account.profile,
    startedAt: Date.now(),
    qrDataUrl,
  });

  return {
    qrDataUrl,
    message: "Scan this QR in the Zalo app.",
  };
}

export async function waitForZalouserLogin(
  opts: {
    accountId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<{ connected: boolean; message: string }> {
  const cfg = getZalouserRuntime().config.loadConfig();
  const account = resolveZalouserAccountSync({ cfg, accountId: opts.accountId });
  const loginKey = buildLoginKey(account.profile);

  if (!(await checkZcaInstalled())) {
    return {
      connected: false,
      message: "Zalo login unavailable: zca CLI not found in PATH.",
    };
  }

  if (await checkZcaAuthenticated(account.profile)) {
    clearActiveLogin(account.profile);
    return {
      connected: true,
      message: `Zalo Personal is authenticated (${account.profile}).`,
    };
  }

  const activeLogin = activeLogins.get(loginKey);
  if (!activeLogin) {
    return {
      connected: false,
      message: "No active Zalo login in progress.",
    };
  }

  if (!isLoginFresh(activeLogin)) {
    clearActiveLogin(account.profile);
    return {
      connected: false,
      message: "The login QR expired. Ask me to generate a new one.",
    };
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 60_000, 1_000);
  const pollIntervalMs = Math.max(opts.pollIntervalMs ?? 1_000, 10);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkZcaAuthenticated(account.profile)) {
      clearActiveLogin(account.profile);
      return {
        connected: true,
        message: `Zalo login successful (${account.profile}).`,
      };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)));
  }

  return {
    connected: false,
    message: "Still waiting for the QR scan. Let me know when you've scanned it.",
  };
}

export const __testing = {
  resetActiveLogins(): void {
    activeLogins.clear();
  },
};
