import type { AvailableCommand } from "@agentclientprotocol/sdk";
import type { ChatCommandDefinition } from "../auto-reply/commands-registry.types.js";
import type { OpenClawConfig } from "../config/types.js";
import { listChatCommandsForConfig } from "../auto-reply/commands-registry.js";

function resolveCommandName(command: ChatCommandDefinition): string {
  const primaryAlias = command.textAliases[0]?.trim();
  if (primaryAlias?.startsWith("/")) {
    return primaryAlias.slice(1);
  }
  const nativeName = command.nativeName?.trim();
  if (nativeName) {
    return nativeName;
  }
  return command.key;
}

function toAvailableCommand(command: ChatCommandDefinition): AvailableCommand {
  return {
    name: resolveCommandName(command),
    description: command.description,
    ...(command.argumentHint ? { input: { hint: command.argumentHint } } : {}),
  };
}

export function getAvailableCommands(params?: { cfg?: OpenClawConfig }): AvailableCommand[] {
  const commands = listChatCommandsForConfig(params?.cfg ?? {});
  return commands.map((command) => toAvailableCommand(command));
}
