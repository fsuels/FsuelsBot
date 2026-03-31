import { redactSensitiveText } from "../../logging/redact.js";

export { formatTimeAgo } from "../../infra/format-time/format-relative.ts";
export { formatDurationPrecise } from "../../infra/format-time/format-duration.ts";

export function formatGatewayAuthUsed(
  auth: {
    token?: string;
    password?: string;
  } | null,
): "token" | "password" | "token+password" | "none" {
  const hasToken = Boolean(auth?.token?.trim());
  const hasPassword = Boolean(auth?.password?.trim());
  if (hasToken && hasPassword) {
    return "token+password";
  }
  if (hasToken) {
    return "token";
  }
  if (hasPassword) {
    return "password";
  }
  return "none";
}

export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }
  let out = text;
  out = out.replace(
    /(\b[A-Z0-9_]*?(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\b\s*[:=]\s*)(["']?)([^"' \t\r\n,;]+)\2/g,
    "$1$2***$2",
  );
  out = out.replace(
    /("(?:[^"]*?(?:TOKEN|SECRET|PASSWORD|API_KEY)|accessToken|refreshToken|apiKey|password|secret)"\s*:\s*")([^"]+)(")/gi,
    "$1***$3",
  );
  out = out.replace(/(^|\r?\n)([ \t]*Authorization\s*[:=]\s*Bearer\s+)[^\r\n]+/gim, "$1$2***");
  out = out.replace(
    /(^|\r?\n)([ \t]*(?:x[-_]?api[-_]?key|api[-_]?key|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gim,
    "$1$2***",
  );
  out = out.replace(
    /([?&](?:token|access_token|refresh_token|sig|signature|secret|password|api[_-]?key)=)([^&#\s]+)/gi,
    "$1***",
  );
  out = out.replace(
    /((?<![?&])\b(?:access[_-]?token|refresh[_-]?token|token|password|secret|api[_-]?key)\b\s*[:=]\s*)(["']?)([^"' \t\r\n,;#&]+)\2/gi,
    "$1$2***$2",
  );
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]+\b/g, "Bearer ***");
  out = out.replace(/\bsk-[A-Za-z0-9]{10,}\b/g, "sk-***");
  return redactSensitiveText(out, { mode: "tools" });
}
