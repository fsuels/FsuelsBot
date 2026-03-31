import { isDeepStrictEqual } from "node:util";
import type { CommandHandler } from "./commands-types.js";
import { resolveChannelConfigWrites } from "../../channels/plugins/config-writes.js";
import { normalizeChannelId } from "../../channels/registry.js";
import { mutateConfigAtPath, readConfigPathValues } from "../../config/config-mutations.js";
import { readConfigFileSnapshot } from "../../config/config.js";
import {
  isSensitiveConfigPath,
  redactConfigObject,
  redactConfigSnapshot,
} from "../../config/redact-snapshot.js";
import {
  getConfigOverrides,
  resetConfigOverrides,
  setConfigOverride,
  unsetConfigOverride,
} from "../../config/runtime-overrides.js";
import { logVerbose } from "../../globals.js";
import { parseConfigCommand } from "./config-commands.js";
import { parseDebugCommand } from "./debug-commands.js";

function renderConfigValue(value: unknown, exists: boolean): string {
  if (!exists) {
    return "`(unset)`";
  }
  return `\`\`\`json\n${JSON.stringify(value ?? null, null, 2)}\n\`\`\``;
}

export const handleConfigCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const configCommand = parseConfigCommand(params.command.commandBodyNormalized);
  if (!configCommand) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /config from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (params.cfg.commands?.config !== true) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ /config is disabled. Set commands.config=true to enable.",
      },
    };
  }
  if (configCommand.action === "error") {
    return {
      shouldContinue: false,
      reply: { text: `⚠️ ${configCommand.message}` },
    };
  }

  if (configCommand.action === "set" || configCommand.action === "unset") {
    const channelId = params.command.channelId ?? normalizeChannelId(params.command.channel);
    const allowWrites = resolveChannelConfigWrites({
      cfg: params.cfg,
      channelId,
      accountId: params.ctx.AccountId,
    });
    if (!allowWrites) {
      const channelLabel = channelId ?? "this channel";
      const hint = channelId
        ? `channels.${channelId}.configWrites=true`
        : "channels.<channel>.configWrites=true";
      return {
        shouldContinue: false,
        reply: {
          text: `⚠️ Config writes are disabled for ${channelLabel}. Set ${hint} to enable.`,
        },
      };
    }
  }

  if (configCommand.action === "show") {
    const pathRaw = configCommand.path?.trim();
    if (pathRaw) {
      const readResult = await readConfigPathValues({
        pathRaw,
        effectiveConfig: params.cfg,
      });
      if (!readResult.ok) {
        return {
          shouldContinue: false,
          reply: { text: `⚠️ ${readResult.errorMessage}` },
        };
      }
      if (!readResult.storedExists && !readResult.effectiveExists) {
        return {
          shouldContinue: false,
          reply: { text: `⚙️ No config value found for ${pathRaw}.` },
        };
      }
      const showEffective = !isDeepStrictEqual(
        { exists: readResult.storedExists, value: readResult.storedValue },
        { exists: readResult.effectiveExists, value: readResult.effectiveValue },
      );
      return {
        shouldContinue: false,
        reply: {
          text:
            `⚙️ Config ${pathRaw}:\n` +
            `Stored on disk:\n${renderConfigValue(readResult.storedValue, readResult.storedExists)}` +
            (showEffective
              ? `\nEffective now:\n${renderConfigValue(
                  readResult.effectiveValue,
                  readResult.effectiveExists,
                )}`
              : ""),
        },
      };
    }
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.valid || !snapshot.parsed || typeof snapshot.parsed !== "object") {
      return {
        shouldContinue: false,
        reply: {
          text: "⚠️ Config file is invalid; fix it before using /config.",
        },
      };
    }
    const redactedSnapshot = redactConfigSnapshot(snapshot);
    const json = JSON.stringify(redactedSnapshot.parsed ?? {}, null, 2);
    return {
      shouldContinue: false,
      reply: { text: `⚙️ Config (stored, redacted):\n\`\`\`json\n${json}\n\`\`\`` },
    };
  }

  if (configCommand.action === "unset") {
    const mutation = await mutateConfigAtPath({
      operation: "unset",
      pathRaw: configCommand.path,
    });
    if (!mutation.ok) {
      return {
        shouldContinue: false,
        reply: {
          text:
            mutation.errorCode === "NOT_FOUND"
              ? `⚙️ No config value found for ${configCommand.path}.`
              : `⚠️ ${mutation.errorMessage}`,
        },
      };
    }
    return {
      shouldContinue: false,
      reply: { text: `⚙️ Config updated: ${configCommand.path} removed.` },
    };
  }

  if (configCommand.action === "set") {
    const mutation = await mutateConfigAtPath({
      operation: "set",
      pathRaw: configCommand.path,
      value: configCommand.value,
    });
    if (!mutation.ok) {
      return {
        shouldContinue: false,
        reply: {
          text: `⚠️ ${mutation.errorMessage}`,
        },
      };
    }
    const valueLabel = isSensitiveConfigPath(configCommand.path)
      ? "(redacted)"
      : typeof configCommand.value === "string"
        ? `"${configCommand.value}"`
        : JSON.stringify(configCommand.value);
    return {
      shouldContinue: false,
      reply: {
        text: `⚙️ Config updated: ${configCommand.path}=${valueLabel ?? "null"}`,
      },
    };
  }

  return null;
};

export const handleDebugCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const debugCommand = parseDebugCommand(params.command.commandBodyNormalized);
  if (!debugCommand) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /debug from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (params.cfg.commands?.debug !== true) {
    return {
      shouldContinue: false,
      reply: {
        text: "⚠️ /debug is disabled. Set commands.debug=true to enable.",
      },
    };
  }
  if (debugCommand.action === "error") {
    return {
      shouldContinue: false,
      reply: { text: `⚠️ ${debugCommand.message}` },
    };
  }
  if (debugCommand.action === "show") {
    const overrides = getConfigOverrides();
    const hasOverrides = Object.keys(overrides).length > 0;
    if (!hasOverrides) {
      return {
        shouldContinue: false,
        reply: { text: "⚙️ Debug overrides: (none)" },
      };
    }
    const json = JSON.stringify(redactConfigObject(overrides), null, 2);
    return {
      shouldContinue: false,
      reply: {
        text: `⚙️ Debug overrides (memory-only, redacted):\n\`\`\`json\n${json}\n\`\`\``,
      },
    };
  }
  if (debugCommand.action === "reset") {
    resetConfigOverrides();
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Debug overrides cleared; using config on disk." },
    };
  }
  if (debugCommand.action === "unset") {
    const result = unsetConfigOverride(debugCommand.path);
    if (!result.ok) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ ${result.error ?? "Invalid path."}` },
      };
    }
    if (!result.removed) {
      return {
        shouldContinue: false,
        reply: {
          text: `⚙️ No debug override found for ${debugCommand.path}.`,
        },
      };
    }
    return {
      shouldContinue: false,
      reply: { text: `⚙️ Debug override removed for ${debugCommand.path}.` },
    };
  }
  if (debugCommand.action === "set") {
    const result = setConfigOverride(debugCommand.path, debugCommand.value);
    if (!result.ok) {
      return {
        shouldContinue: false,
        reply: { text: `⚠️ ${result.error ?? "Invalid override."}` },
      };
    }
    const valueLabel = isSensitiveConfigPath(debugCommand.path)
      ? "(redacted)"
      : typeof debugCommand.value === "string"
        ? `"${debugCommand.value}"`
        : JSON.stringify(debugCommand.value);
    return {
      shouldContinue: false,
      reply: {
        text: `⚙️ Debug override set: ${debugCommand.path}=${valueLabel ?? "null"}`,
      },
    };
  }

  return null;
};
