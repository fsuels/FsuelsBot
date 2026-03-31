import { Type } from "@sinclair/typebox";
import type { ChannelAgentTool } from "../types.js";

type WhatsAppAuthPayload = {
  ok: boolean;
  status: "qr_code" | "waiting" | "completed" | "error";
  channel: "whatsapp";
  message: string;
  qrDataUrl?: string;
};

function buildAuthResult(payload: WhatsAppAuthPayload) {
  const text =
    payload.status === "qr_code" && payload.qrDataUrl
      ? [
          payload.message,
          "",
          "Open WhatsApp -> Linked Devices and scan:",
          "",
          `![whatsapp-qr](${payload.qrDataUrl})`,
        ].join("\n")
      : payload.message;
  return {
    content: [{ type: "text" as const, text }],
    details: payload,
  };
}

export function createWhatsAppLoginTool(): ChannelAgentTool {
  return {
    label: "WhatsApp Login",
    name: "whatsapp_login",
    description:
      "The WhatsApp connector requires an authenticated WhatsApp Web session before it can send or receive. " +
      "Call this tool to generate a QR code or wait for the scan to complete.",
    // NOTE: Using Type.Unsafe for action enum instead of Type.Union([Type.Literal(...)]
    // because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
    parameters: Type.Object({
      action: Type.Unsafe<"start" | "wait">({
        type: "string",
        enum: ["start", "wait"],
      }),
      timeoutMs: Type.Optional(Type.Number()),
      force: Type.Optional(Type.Boolean()),
    }),
    isConcurrencySafe: () => false,
    execute: async (_toolCallId, args) => {
      const { startWebLoginWithQr, waitForWebLogin } = await import("../../../web/login-qr.js");
      const action = (args as { action?: string })?.action ?? "start";
      if (action === "wait") {
        const result = await waitForWebLogin({
          timeoutMs:
            typeof (args as { timeoutMs?: unknown }).timeoutMs === "number"
              ? (args as { timeoutMs?: number }).timeoutMs
              : undefined,
        });
        return buildAuthResult({
          ok: result.connected,
          status: result.connected ? "completed" : "waiting",
          channel: "whatsapp",
          message: result.message,
        });
      }

      const result = await startWebLoginWithQr({
        timeoutMs:
          typeof (args as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (args as { timeoutMs?: number }).timeoutMs
            : undefined,
        force:
          typeof (args as { force?: unknown }).force === "boolean"
            ? (args as { force?: boolean }).force
            : false,
      });

      if (!result.qrDataUrl) {
        const completed = !/^Failed\b/i.test(result.message);
        return buildAuthResult({
          ok: completed,
          status: completed ? "completed" : "error",
          channel: "whatsapp",
          message: result.message,
        });
      }

      return buildAuthResult({
        ok: true,
        status: "qr_code",
        channel: "whatsapp",
        message: result.message,
        qrDataUrl: result.qrDataUrl,
      });
    },
  };
}
