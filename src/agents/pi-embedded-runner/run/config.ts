import type { ImageContent } from "@mariozechner/pi-ai";
import type { ExecElevatedDefaults, ExecToolDefaults } from "../../bash-tools.js";
import type { BlockReplyChunking, ToolResultFormat } from "../../pi-embedded-subscribe.js";
import type { ClientToolDefinition, RunEmbeddedPiAgentParams } from "./params.js";
import { isMarkdownCapableMessageChannel } from "../../../utils/message-channel.js";
import { resolveOpenClawAgentDir } from "../../agent-paths.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../defaults.js";
import { resolveRunWorkspaceDir, type ResolveRunWorkspaceResult } from "../../workspace-run.js";

export type EmbeddedPiRunConfig = Readonly<
  Omit<
    RunEmbeddedPiAgentParams,
    | "provider"
    | "model"
    | "thinkLevel"
    | "toolResultFormat"
    | "agentDir"
    | "workspaceDir"
    | "images"
    | "clientTools"
    | "ownerNumbers"
    | "execOverrides"
    | "bashElevated"
    | "blockReplyChunking"
    | "streamParams"
  > & {
    queuedAt: number;
    provider: string;
    model: string;
    thinkLevel: NonNullable<RunEmbeddedPiAgentParams["thinkLevel"]>;
    toolResultFormat: ToolResultFormat;
    agentDir: string;
    workspaceDir: string;
    workspaceResolution: ResolveRunWorkspaceResult;
    isProbeSession: boolean;
    images?: ImageContent[];
    clientTools?: ClientToolDefinition[];
    ownerNumbers?: string[];
    execOverrides?: Pick<ExecToolDefaults, "host" | "security" | "ask" | "node">;
    bashElevated?: ExecElevatedDefaults;
    blockReplyChunking?: BlockReplyChunking;
    streamParams?: RunEmbeddedPiAgentParams["streamParams"];
  }
>;

export function createEmbeddedPiRunConfig(
  params: RunEmbeddedPiAgentParams,
  now: () => number,
): EmbeddedPiRunConfig {
  const channelHint = params.messageChannel ?? params.messageProvider;
  const toolResultFormat =
    params.toolResultFormat ??
    (channelHint
      ? isMarkdownCapableMessageChannel(channelHint)
        ? "markdown"
        : "plain"
      : "markdown");
  const workspaceResolution = resolveRunWorkspaceDir({
    workspaceDir: params.workspaceDir,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    config: params.config,
  });

  return Object.freeze({
    ...params,
    queuedAt: now(),
    provider: (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER,
    model: (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    thinkLevel: params.thinkLevel ?? "off",
    toolResultFormat,
    agentDir: params.agentDir ?? resolveOpenClawAgentDir(),
    workspaceDir: workspaceResolution.workspaceDir,
    workspaceResolution,
    isProbeSession: params.sessionId?.startsWith("probe-") ?? false,
    images: params.images?.map((image) => ({ ...image })),
    clientTools: params.clientTools?.map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
      },
    })),
    ownerNumbers: params.ownerNumbers ? [...params.ownerNumbers] : undefined,
    execOverrides: params.execOverrides ? { ...params.execOverrides } : undefined,
    bashElevated: params.bashElevated ? { ...params.bashElevated } : undefined,
    blockReplyChunking: params.blockReplyChunking ? { ...params.blockReplyChunking } : undefined,
    streamParams: params.streamParams ? { ...params.streamParams } : undefined,
  });
}
