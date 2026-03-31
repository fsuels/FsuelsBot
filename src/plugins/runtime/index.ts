import { createRequire } from "node:module";
import type { PluginRuntime } from "./types.js";
import { resolveEffectiveMessagesConfig, resolveHumanDelayConfig } from "../../agents/identity.js";
import { createMemoryGetTool, createMemorySearchTool } from "../../agents/tools/memory-tool.js";
import {
  chunkByNewline,
  chunkMarkdownText,
  chunkMarkdownTextWithMode,
  chunkText,
  chunkTextWithMode,
  resolveChunkMode,
  resolveTextChunkLimit,
} from "../../auto-reply/chunk.js";
import {
  hasControlCommand,
  isControlCommandMessage,
  shouldComputeCommandAuthorized,
} from "../../auto-reply/command-detection.js";
import { shouldHandleTextCommands } from "../../auto-reply/commands-registry.js";
import {
  formatAgentEnvelope,
  formatInboundEnvelope,
  resolveEnvelopeFormatOptions,
} from "../../auto-reply/envelope.js";
import {
  createInboundDebouncer,
  resolveInboundDebounceMs,
} from "../../auto-reply/inbound-debounce.js";
import { dispatchReplyFromConfig } from "../../auto-reply/reply/dispatch-from-config.js";
import { finalizeInboundContext } from "../../auto-reply/reply/inbound-context.js";
import {
  buildMentionRegexes,
  matchesMentionPatterns,
  matchesMentionWithExplicit,
} from "../../auto-reply/reply/mentions.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../../auto-reply/reply/provider-dispatcher.js";
import { createReplyDispatcherWithTyping } from "../../auto-reply/reply/reply-dispatcher.js";
import { removeAckReactionAfterReply, shouldAckReaction } from "../../channels/ack-reactions.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../../channels/command-gating.js";
import { discordMessageActions } from "../../channels/plugins/actions/discord.js";
import { signalMessageActions } from "../../channels/plugins/actions/signal.js";
import { telegramMessageActions } from "../../channels/plugins/actions/telegram.js";
import { createWhatsAppLoginTool } from "../../channels/plugins/agent-tools/whatsapp-login.js";
import { recordInboundSession } from "../../channels/session.js";
import { registerMemoryCli } from "../../cli/memory-cli.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import {
  resolveChannelGroupPolicy,
  resolveChannelGroupRequireMention,
} from "../../config/group-policy.js";
import { resolveMarkdownTableMode } from "../../config/markdown-tables.js";
import { resolveStateDir } from "../../config/paths.js";
import {
  readSessionUpdatedAt,
  recordSessionMetaFromInbound,
  resolveStorePath,
  updateLastRoute,
} from "../../config/sessions.js";
import { shouldLogVerbose } from "../../globals.js";
import { getChannelActivity, recordChannelActivity } from "../../infra/channel-activity.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import {
  listLineAccountIds,
  normalizeAccountId as normalizeLineAccountId,
  resolveDefaultLineAccountId,
  resolveLineAccount,
} from "../../line/accounts.js";
import {
  createQuickReplyItems,
  pushMessageLine,
  pushMessagesLine,
  pushFlexMessage,
  pushTemplateMessage,
  pushLocationMessage,
  pushTextMessageWithQuickReplies,
  sendMessageLine,
} from "../../line/send.js";
import { buildTemplateMessageFromPayload } from "../../line/template-messages.js";
import { getChildLogger } from "../../logging.js";
import { normalizeLogLevel } from "../../logging/levels.js";
import { convertMarkdownTables } from "../../markdown/tables.js";
import { isVoiceCompatibleAudio } from "../../media/audio.js";
import { mediaKindFromMime } from "../../media/constants.js";
import { detectMime } from "../../media/mime.js";
import { buildPairingReply } from "../../pairing/pairing-messages.js";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../../pairing/pairing-store.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";
import { resolveTelegramToken } from "../../telegram/token.js";
import { getActiveWebListener } from "../../web/active-listener.js";
import {
  getWebAuthAgeMs,
  logoutWeb,
  logWebSelfId,
  readWebSelfId,
  webAuthExists,
} from "../../web/auth-store.js";
import { createLazyModuleLoader, lazyAsyncExport } from "./lazy.js";
import { formatNativeDependencyHint } from "./native-deps.js";

let cachedVersion: string | null = null;

const loadMediaFetchModule = createLazyModuleLoader(
  async () => await import("../../media/fetch.js"),
);
const loadMediaImageOpsModule = createLazyModuleLoader(
  async () => await import("../../media/image-ops.js"),
);
const loadMediaStoreModule = createLazyModuleLoader(
  async () => await import("../../media/store.js"),
);
const loadTtsModule = createLazyModuleLoader(async () => await import("../../tts/tts.js"));
const loadWebMediaModule = createLazyModuleLoader(async () => await import("../../web/media.js"));
const loadDiscordAuditModule = createLazyModuleLoader(
  async () => await import("../../discord/audit.js"),
);
const loadDiscordDirectoryModule = createLazyModuleLoader(
  async () => await import("../../discord/directory-live.js"),
);
const loadDiscordMonitorModule = createLazyModuleLoader(
  async () => await import("../../discord/monitor.js"),
);
const loadDiscordProbeModule = createLazyModuleLoader(
  async () => await import("../../discord/probe.js"),
);
const loadDiscordResolveChannelsModule = createLazyModuleLoader(
  async () => await import("../../discord/resolve-channels.js"),
);
const loadDiscordResolveUsersModule = createLazyModuleLoader(
  async () => await import("../../discord/resolve-users.js"),
);
const loadDiscordSendModule = createLazyModuleLoader(
  async () => await import("../../discord/send.js"),
);
const loadSlackDirectoryModule = createLazyModuleLoader(
  async () => await import("../../slack/directory-live.js"),
);
const loadSlackMonitorModule = createLazyModuleLoader(
  async () => await import("../../slack/index.js"),
);
const loadSlackProbeModule = createLazyModuleLoader(
  async () => await import("../../slack/probe.js"),
);
const loadSlackResolveChannelsModule = createLazyModuleLoader(
  async () => await import("../../slack/resolve-channels.js"),
);
const loadSlackResolveUsersModule = createLazyModuleLoader(
  async () => await import("../../slack/resolve-users.js"),
);
const loadSlackSendModule = createLazyModuleLoader(async () => await import("../../slack/send.js"));
const loadSlackActionsModule = createLazyModuleLoader(
  async () => await import("../../agents/tools/slack-actions.js"),
);
const loadTelegramAuditModule = createLazyModuleLoader(
  async () => await import("../../telegram/audit.js"),
);
const loadTelegramMonitorModule = createLazyModuleLoader(
  async () => await import("../../telegram/monitor.js"),
);
const loadTelegramProbeModule = createLazyModuleLoader(
  async () => await import("../../telegram/probe.js"),
);
const loadTelegramSendModule = createLazyModuleLoader(
  async () => await import("../../telegram/send.js"),
);
const loadSignalMonitorModule = createLazyModuleLoader(
  async () => await import("../../signal/index.js"),
);
const loadSignalProbeModule = createLazyModuleLoader(
  async () => await import("../../signal/probe.js"),
);
const loadSignalSendModule = createLazyModuleLoader(
  async () => await import("../../signal/send.js"),
);
const loadIMessageMonitorModule = createLazyModuleLoader(
  async () => await import("../../imessage/monitor.js"),
);
const loadIMessageProbeModule = createLazyModuleLoader(
  async () => await import("../../imessage/probe.js"),
);
const loadIMessageSendModule = createLazyModuleLoader(
  async () => await import("../../imessage/send.js"),
);
const loadWhatsAppActionsModule = createLazyModuleLoader(
  async () => await import("../../agents/tools/whatsapp-actions.js"),
);
const loadWebMonitorModule = createLazyModuleLoader(
  async () => await import("../../channels/web/index.js"),
);
const loadWebLoginModule = createLazyModuleLoader(async () => await import("../../web/login.js"));
const loadWebLoginQrModule = createLazyModuleLoader(
  async () => await import("../../web/login-qr.js"),
);
const loadWebOutboundModule = createLazyModuleLoader(
  async () => await import("../../web/outbound.js"),
);
const loadLineMonitorModule = createLazyModuleLoader(
  async () => await import("../../line/monitor.js"),
);
const loadLineProbeModule = createLazyModuleLoader(async () => await import("../../line/probe.js"));

function resolveVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../../package.json") as { version?: string };
    cachedVersion = pkg.version ?? "unknown";
    return cachedVersion;
  } catch {
    cachedVersion = "unknown";
    return cachedVersion;
  }
}

export function createPluginRuntime(): PluginRuntime {
  return {
    version: resolveVersion(),
    config: {
      loadConfig,
      writeConfigFile,
    },
    system: {
      enqueueSystemEvent,
      runCommandWithTimeout,
      formatNativeDependencyHint,
    },
    media: {
      loadWebMedia: lazyAsyncExport(loadWebMediaModule, "loadWebMedia"),
      detectMime,
      mediaKindFromMime,
      isVoiceCompatibleAudio,
      getImageMetadata: lazyAsyncExport(loadMediaImageOpsModule, "getImageMetadata"),
      resizeToJpeg: lazyAsyncExport(loadMediaImageOpsModule, "resizeToJpeg"),
    },
    tts: {
      textToSpeechTelephony: lazyAsyncExport(loadTtsModule, "textToSpeechTelephony"),
    },
    tools: {
      createMemoryGetTool,
      createMemorySearchTool,
      registerMemoryCli,
    },
    channel: {
      text: {
        chunkByNewline,
        chunkMarkdownText,
        chunkMarkdownTextWithMode,
        chunkText,
        chunkTextWithMode,
        resolveChunkMode,
        resolveTextChunkLimit,
        hasControlCommand,
        resolveMarkdownTableMode,
        convertMarkdownTables,
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
        createReplyDispatcherWithTyping,
        resolveEffectiveMessagesConfig,
        resolveHumanDelayConfig,
        dispatchReplyFromConfig,
        finalizeInboundContext,
        formatAgentEnvelope,
        formatInboundEnvelope,
        resolveEnvelopeFormatOptions,
      },
      routing: {
        resolveAgentRoute,
      },
      pairing: {
        buildPairingReply,
        readAllowFromStore: readChannelAllowFromStore,
        upsertPairingRequest: upsertChannelPairingRequest,
      },
      media: {
        fetchRemoteMedia: lazyAsyncExport(loadMediaFetchModule, "fetchRemoteMedia"),
        saveMediaBuffer: lazyAsyncExport(loadMediaStoreModule, "saveMediaBuffer"),
      },
      activity: {
        record: recordChannelActivity,
        get: getChannelActivity,
      },
      session: {
        resolveStorePath,
        readSessionUpdatedAt,
        recordSessionMetaFromInbound,
        recordInboundSession,
        updateLastRoute,
      },
      mentions: {
        buildMentionRegexes,
        matchesMentionPatterns,
        matchesMentionWithExplicit,
      },
      reactions: {
        shouldAckReaction,
        removeAckReactionAfterReply,
      },
      groups: {
        resolveGroupPolicy: resolveChannelGroupPolicy,
        resolveRequireMention: resolveChannelGroupRequireMention,
      },
      debounce: {
        createInboundDebouncer,
        resolveInboundDebounceMs,
      },
      commands: {
        resolveCommandAuthorizedFromAuthorizers,
        isControlCommandMessage,
        shouldComputeCommandAuthorized,
        shouldHandleTextCommands,
      },
      discord: {
        messageActions: discordMessageActions,
        auditChannelPermissions: lazyAsyncExport(
          loadDiscordAuditModule,
          "auditDiscordChannelPermissions",
        ),
        listDirectoryGroupsLive: lazyAsyncExport(
          loadDiscordDirectoryModule,
          "listDiscordDirectoryGroupsLive",
        ),
        listDirectoryPeersLive: lazyAsyncExport(
          loadDiscordDirectoryModule,
          "listDiscordDirectoryPeersLive",
        ),
        probeDiscord: lazyAsyncExport(loadDiscordProbeModule, "probeDiscord"),
        resolveChannelAllowlist: lazyAsyncExport(
          loadDiscordResolveChannelsModule,
          "resolveDiscordChannelAllowlist",
        ),
        resolveUserAllowlist: lazyAsyncExport(
          loadDiscordResolveUsersModule,
          "resolveDiscordUserAllowlist",
        ),
        sendMessageDiscord: lazyAsyncExport(loadDiscordSendModule, "sendMessageDiscord"),
        sendPollDiscord: lazyAsyncExport(loadDiscordSendModule, "sendPollDiscord"),
        monitorDiscordProvider: lazyAsyncExport(loadDiscordMonitorModule, "monitorDiscordProvider"),
      },
      slack: {
        listDirectoryGroupsLive: lazyAsyncExport(
          loadSlackDirectoryModule,
          "listSlackDirectoryGroupsLive",
        ),
        listDirectoryPeersLive: lazyAsyncExport(
          loadSlackDirectoryModule,
          "listSlackDirectoryPeersLive",
        ),
        probeSlack: lazyAsyncExport(loadSlackProbeModule, "probeSlack"),
        resolveChannelAllowlist: lazyAsyncExport(
          loadSlackResolveChannelsModule,
          "resolveSlackChannelAllowlist",
        ),
        resolveUserAllowlist: lazyAsyncExport(
          loadSlackResolveUsersModule,
          "resolveSlackUserAllowlist",
        ),
        sendMessageSlack: lazyAsyncExport(loadSlackSendModule, "sendMessageSlack"),
        monitorSlackProvider: lazyAsyncExport(loadSlackMonitorModule, "monitorSlackProvider"),
        handleSlackAction: lazyAsyncExport(loadSlackActionsModule, "handleSlackAction"),
      },
      telegram: {
        auditGroupMembership: lazyAsyncExport(
          loadTelegramAuditModule,
          "auditTelegramGroupMembership",
        ),
        collectUnmentionedGroupIds: lazyAsyncExport(
          loadTelegramAuditModule,
          "collectTelegramUnmentionedGroupIds",
        ),
        probeTelegram: lazyAsyncExport(loadTelegramProbeModule, "probeTelegram"),
        resolveTelegramToken,
        sendMessageTelegram: lazyAsyncExport(loadTelegramSendModule, "sendMessageTelegram"),
        monitorTelegramProvider: lazyAsyncExport(
          loadTelegramMonitorModule,
          "monitorTelegramProvider",
        ),
        messageActions: telegramMessageActions,
      },
      signal: {
        probeSignal: lazyAsyncExport(loadSignalProbeModule, "probeSignal"),
        sendMessageSignal: lazyAsyncExport(loadSignalSendModule, "sendMessageSignal"),
        monitorSignalProvider: lazyAsyncExport(loadSignalMonitorModule, "monitorSignalProvider"),
        messageActions: signalMessageActions,
      },
      imessage: {
        monitorIMessageProvider: lazyAsyncExport(
          loadIMessageMonitorModule,
          "monitorIMessageProvider",
        ),
        probeIMessage: lazyAsyncExport(loadIMessageProbeModule, "probeIMessage"),
        sendMessageIMessage: lazyAsyncExport(loadIMessageSendModule, "sendMessageIMessage"),
      },
      whatsapp: {
        getActiveWebListener,
        getWebAuthAgeMs,
        logoutWeb,
        logWebSelfId,
        readWebSelfId,
        webAuthExists,
        sendMessageWhatsApp: lazyAsyncExport(loadWebOutboundModule, "sendMessageWhatsApp"),
        sendPollWhatsApp: lazyAsyncExport(loadWebOutboundModule, "sendPollWhatsApp"),
        loginWeb: lazyAsyncExport(loadWebLoginModule, "loginWeb"),
        startWebLoginWithQr: lazyAsyncExport(loadWebLoginQrModule, "startWebLoginWithQr"),
        waitForWebLogin: lazyAsyncExport(loadWebLoginQrModule, "waitForWebLogin"),
        monitorWebChannel: lazyAsyncExport(loadWebMonitorModule, "monitorWebChannel"),
        handleWhatsAppAction: lazyAsyncExport(loadWhatsAppActionsModule, "handleWhatsAppAction"),
        createLoginTool: createWhatsAppLoginTool,
      },
      line: {
        listLineAccountIds,
        resolveDefaultLineAccountId,
        resolveLineAccount,
        normalizeAccountId: normalizeLineAccountId,
        probeLineBot: lazyAsyncExport(loadLineProbeModule, "probeLineBot"),
        sendMessageLine,
        pushMessageLine,
        pushMessagesLine,
        pushFlexMessage,
        pushTemplateMessage,
        pushLocationMessage,
        pushTextMessageWithQuickReplies,
        createQuickReplyItems,
        buildTemplateMessageFromPayload,
        monitorLineProvider: lazyAsyncExport(loadLineMonitorModule, "monitorLineProvider"),
      },
    },
    logging: {
      shouldLogVerbose,
      getChildLogger: (bindings, opts) => {
        const logger = getChildLogger(bindings, {
          level: opts?.level ? normalizeLogLevel(opts.level) : undefined,
        });
        return {
          debug: (message) => logger.debug?.(message),
          info: (message) => logger.info(message),
          warn: (message) => logger.warn(message),
          error: (message) => logger.error(message),
        };
      },
    },
    state: {
      resolveStateDir,
    },
  };
}

export type { PluginRuntime } from "./types.js";
