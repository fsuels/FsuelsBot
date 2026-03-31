import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";
import { queueAuthProfileWrite, type AuthConfigWritePlan } from "./auth-config-write-plan.js";
export { CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF } from "../agents/cloudflare-ai-gateway.js";
export { XAI_DEFAULT_MODEL_REF } from "./onboard-auth.models.js";

const resolveAuthAgentDir = (agentDir?: string) => agentDir ?? resolveOpenClawAgentDir();

function queueOrUpsertAuthProfile(params: {
  agentDir?: string;
  profileId: string;
  credential: Parameters<typeof upsertAuthProfile>[0]["credential"];
  writePlan?: AuthConfigWritePlan;
}) {
  const resolvedAgentDir = resolveAuthAgentDir(params.agentDir);
  if (
    queueAuthProfileWrite(params.writePlan, {
      agentDir: resolvedAgentDir,
      profileId: params.profileId,
      credential: params.credential,
    })
  ) {
    return;
  }
  upsertAuthProfile({
    profileId: params.profileId,
    credential: params.credential,
    agentDir: resolvedAgentDir,
  });
}

export async function writeOAuthCredentials(
  provider: string,
  creds: OAuthCredentials,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
): Promise<void> {
  const email =
    typeof creds.email === "string" && creds.email.trim() ? creds.email.trim() : "default";
  queueOrUpsertAuthProfile({
    profileId: `${provider}:${email}`,
    credential: {
      type: "oauth",
      provider,
      ...creds,
    },
    agentDir,
    writePlan,
  });
}

export async function setAnthropicApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "anthropic:default",
    credential: {
      type: "api_key",
      provider: "anthropic",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setGeminiApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "google:default",
    credential: {
      type: "api_key",
      provider: "google",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setMinimaxApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "minimax:default",
    credential: {
      type: "api_key",
      provider: "minimax",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setMoonshotApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "moonshot:default",
    credential: {
      type: "api_key",
      provider: "moonshot",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setKimiCodingApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "kimi-coding:default",
    credential: {
      type: "api_key",
      provider: "kimi-coding",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setSyntheticApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "synthetic:default",
    credential: {
      type: "api_key",
      provider: "synthetic",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setVeniceApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "venice:default",
    credential: {
      type: "api_key",
      provider: "venice",
      key,
    },
    agentDir,
    writePlan,
  });
}

export const ZAI_DEFAULT_MODEL_REF = "zai/glm-4.7";
export const XIAOMI_DEFAULT_MODEL_REF = "xiaomi/mimo-v2-flash";
export const OPENROUTER_DEFAULT_MODEL_REF = "openrouter/auto";
export const VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF = "vercel-ai-gateway/anthropic/claude-opus-4.6";

export async function setZaiApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  // Write to resolved agent dir so gateway finds credentials on startup.
  queueOrUpsertAuthProfile({
    profileId: "zai:default",
    credential: {
      type: "api_key",
      provider: "zai",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setXiaomiApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  queueOrUpsertAuthProfile({
    profileId: "xiaomi:default",
    credential: {
      type: "api_key",
      provider: "xiaomi",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setOpenrouterApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  queueOrUpsertAuthProfile({
    profileId: "openrouter:default",
    credential: {
      type: "api_key",
      provider: "openrouter",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setCloudflareAiGatewayConfig(
  accountId: string,
  gatewayId: string,
  apiKey: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  const normalizedAccountId = accountId.trim();
  const normalizedGatewayId = gatewayId.trim();
  const normalizedKey = apiKey.trim();
  queueOrUpsertAuthProfile({
    profileId: "cloudflare-ai-gateway:default",
    credential: {
      type: "api_key",
      provider: "cloudflare-ai-gateway",
      key: normalizedKey,
      metadata: {
        accountId: normalizedAccountId,
        gatewayId: normalizedGatewayId,
      },
    },
    agentDir,
    writePlan,
  });
}

export async function setVercelAiGatewayApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  queueOrUpsertAuthProfile({
    profileId: "vercel-ai-gateway:default",
    credential: {
      type: "api_key",
      provider: "vercel-ai-gateway",
      key,
    },
    agentDir,
    writePlan,
  });
}

export async function setOpencodeZenApiKey(
  key: string,
  agentDir?: string,
  writePlan?: AuthConfigWritePlan,
) {
  queueOrUpsertAuthProfile({
    profileId: "opencode:default",
    credential: {
      type: "api_key",
      provider: "opencode",
      key,
    },
    agentDir,
    writePlan,
  });
}

export function setQianfanApiKey(key: string, agentDir?: string, writePlan?: AuthConfigWritePlan) {
  queueOrUpsertAuthProfile({
    profileId: "qianfan:default",
    credential: {
      type: "api_key",
      provider: "qianfan",
      key,
    },
    agentDir,
    writePlan,
  });
}

export function setXaiApiKey(key: string, agentDir?: string, writePlan?: AuthConfigWritePlan) {
  queueOrUpsertAuthProfile({
    profileId: "xai:default",
    credential: {
      type: "api_key",
      provider: "xai",
      key,
    },
    agentDir,
    writePlan,
  });
}
