import type { OpenClawConfig } from "./types.js";

const PROTECTED_CONFIG_ENV_KEYS = new Set<string>([
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_GATEWAY_URL",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_HOME",
  "OPENCLAW_PROFILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "PATH",
  "HOME",
  "USERPROFILE",
  "SHELL",
]);

const PROTECTED_CONFIG_ENV_PREFIXES = ["OPENCLAW_GATEWAY_", "SSH_", "GIT_SSH_"] as const;

export function isProtectedConfigEnvVar(key: string): boolean {
  if (PROTECTED_CONFIG_ENV_KEYS.has(key)) {
    return true;
  }
  return PROTECTED_CONFIG_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function collectConfigEnvVars(cfg?: OpenClawConfig): Record<string, string> {
  const envConfig = cfg?.env;
  if (!envConfig) {
    return {};
  }

  const entries: Record<string, string> = {};

  if (envConfig.vars) {
    for (const [key, value] of Object.entries(envConfig.vars)) {
      if (!value) {
        continue;
      }
      entries[key] = value;
    }
  }

  for (const [key, value] of Object.entries(envConfig)) {
    if (key === "shellEnv" || key === "vars") {
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    entries[key] = value;
  }

  return entries;
}
