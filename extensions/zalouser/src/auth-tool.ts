import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { checkZcaAuthenticated, resolveZalouserAccountSync } from "./accounts.js";
import { startZalouserLoginWithQr, waitForZalouserLogin } from "./login-qr.js";
import { getZalouserRuntime } from "./runtime.js";
import { checkZcaInstalled } from "./zca.js";

const AUTH_ACTIONS = ["start", "wait"] as const;

type AuthAction = (typeof AUTH_ACTIONS)[number];

type AuthPayload = {
  ok: boolean;
  status: "qr_code" | "waiting" | "completed" | "unsupported" | "error";
  channel: "zalouser";
  accountId: string;
  profile: string;
  message: string;
  qrDataUrl?: string;
};

function buildAuthResult(payload: AuthPayload) {
  const text =
    payload.status === "qr_code" && payload.qrDataUrl
      ? [
          payload.message,
          "",
          "Scan this code in the Zalo app:",
          "",
          `![zalouser-qr](${payload.qrDataUrl})`,
        ].join("\n")
      : payload.message;
  return {
    content: [{ type: "text" as const, text }],
    details: payload,
  };
}

export function createZalouserAuthTool(): AnyAgentTool {
  return {
    name: "zalouser_authenticate",
    label: "Zalo Personal Authenticate",
    description:
      "The Zalo Personal connector exists but requires authentication before the Zalo tool can send messages or read account data. " +
      "Call this tool to start QR authentication or wait for it to finish. It returns a QR code, a waiting state, " +
      "or a clear fallback/error message.",
    parameters: Type.Object(
      {
        action: Type.Unsafe<AuthAction>({
          type: "string",
          enum: [...AUTH_ACTIONS],
        }),
        accountId: Type.Optional(Type.String()),
        timeoutMs: Type.Optional(Type.Number()),
        force: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    isConcurrencySafe: () => false,
    execute: async (_toolCallId, args) => {
      const cfg = getZalouserRuntime().config.loadConfig();
      const account = resolveZalouserAccountSync({
        cfg,
        accountId: typeof args?.accountId === "string" ? args.accountId : undefined,
      });
      const action = (typeof args?.action === "string" ? args.action : "start") as AuthAction;

      if (!(await checkZcaInstalled())) {
        return buildAuthResult({
          ok: false,
          status: "error",
          channel: "zalouser",
          accountId: account.accountId,
          profile: account.profile,
          message: "Zalo authentication unavailable: zca CLI not found in PATH.",
        });
      }

      if (action === "wait") {
        const result = await waitForZalouserLogin({
          accountId: account.accountId,
          timeoutMs: typeof args?.timeoutMs === "number" ? args.timeoutMs : undefined,
        });
        return buildAuthResult({
          ok: result.connected,
          status: result.connected ? "completed" : "waiting",
          channel: "zalouser",
          accountId: account.accountId,
          profile: account.profile,
          message: result.message,
        });
      }

      if (!(typeof args?.force === "boolean" && args.force)) {
        const authenticated = await checkZcaAuthenticated(account.profile);
        if (authenticated) {
          return buildAuthResult({
            ok: true,
            status: "completed",
            channel: "zalouser",
            accountId: account.accountId,
            profile: account.profile,
            message: `Zalo Personal is already authenticated (${account.profile}).`,
          });
        }
      }

      const result = await startZalouserLoginWithQr({
        accountId: account.accountId,
        force: typeof args?.force === "boolean" ? args.force : false,
        timeoutMs: typeof args?.timeoutMs === "number" ? args.timeoutMs : undefined,
      });
      const authenticated = await checkZcaAuthenticated(account.profile);
      if (result.qrDataUrl) {
        return buildAuthResult({
          ok: true,
          status: "qr_code",
          channel: "zalouser",
          accountId: account.accountId,
          profile: account.profile,
          message: result.message,
          qrDataUrl: result.qrDataUrl,
        });
      }
      return buildAuthResult({
        ok: authenticated,
        status: authenticated ? "completed" : "unsupported",
        channel: "zalouser",
        accountId: account.accountId,
        profile: account.profile,
        message: result.message,
      });
    },
  } as AnyAgentTool;
}
