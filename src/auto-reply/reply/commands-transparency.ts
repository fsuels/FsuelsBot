import path from "node:path";
import type { CommandHandler } from "./commands-types.js";
import { logVerbose } from "../../globals.js";
import { buildWorkspaceHookStatus, type HookStatusEntry } from "../../hooks/hooks-status.js";
import { loadContextReport } from "./commands-context-report.js";

function formatDisplayPath(targetPath: string, workspaceDir?: string): string {
  const absolute = path.resolve(targetPath);
  const bases = [process.cwd(), workspaceDir]
    .filter((base): base is string => Boolean(base))
    .map((base) => path.resolve(base));

  for (const base of bases) {
    const relative = path.relative(base, absolute);
    if (!relative) {
      return ".";
    }
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
  }

  return absolute;
}

function formatHookMissing(entry: HookStatusEntry): string | null {
  const parts: string[] = [];
  if (entry.missing.bins.length > 0) {
    parts.push(`bins=${entry.missing.bins.join(", ")}`);
  }
  if (entry.missing.anyBins.length > 0) {
    parts.push(`any-bin=${entry.missing.anyBins.join(" | ")}`);
  }
  if (entry.missing.env.length > 0) {
    parts.push(`env=${entry.missing.env.join(", ")}`);
  }
  if (entry.missing.config.length > 0) {
    parts.push(`config=${entry.missing.config.join(", ")}`);
  }
  if (entry.missing.os.length > 0) {
    parts.push(`os=${entry.missing.os.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function parseHooksMode(normalized: string): "summary" | "detail" | "json" | "invalid" | null {
  if (normalized === "/hooks") {
    return "summary";
  }
  if (!normalized.startsWith("/hooks ")) {
    return null;
  }
  const mode = normalized.slice("/hooks".length).trim().toLowerCase();
  if (!mode) {
    return "summary";
  }
  if (mode === "detail" || mode === "deep") {
    return "detail";
  }
  if (mode === "json") {
    return "json";
  }
  return "invalid";
}

export const handleFilesInContextCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/files-in-context") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /files-in-context from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const report = await loadContextReport(params);
  const workspaceDir = report.workspaceDir ?? params.workspaceDir;
  const lines = [
    "📎 Files in context",
    `Workspace: ${formatDisplayPath(workspaceDir, workspaceDir)}`,
  ];

  if (report.injectedWorkspaceFiles.length === 0) {
    lines.push("", "No workspace files are currently injected into the prompt.");
  } else {
    lines.push("");
    for (const file of report.injectedWorkspaceFiles) {
      const status = file.missing ? "missing" : file.truncated ? "truncated" : "ok";
      const sizeLabel = file.missing ? "" : `, injected ${file.injectedChars} chars`;
      lines.push(`- ${formatDisplayPath(file.path, workspaceDir)} [${status}${sizeLabel}]`);
    }
    lines.push("", "More: /context detail");
  }

  return { shouldContinue: false, reply: { text: lines.join("\n") } };
};

export const handleHooksCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const mode = parseHooksMode(params.command.commandBodyNormalized);
  if (!mode) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /hooks from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (mode === "invalid") {
    return { shouldContinue: false, reply: { text: "⚙️ Usage: /hooks [detail|json]" } };
  }

  const report = buildWorkspaceHookStatus(params.workspaceDir, { config: params.cfg });
  if (mode === "json") {
    return { shouldContinue: false, reply: { text: JSON.stringify(report, null, 2) } };
  }

  const ready = report.hooks.filter((entry) => !entry.disabled && entry.eligible).length;
  const blocked = report.hooks.filter((entry) => !entry.disabled && !entry.eligible).length;
  const disabled = report.hooks.filter((entry) => entry.disabled).length;
  const lines = [
    "🪝 Hooks",
    `Workspace: ${formatDisplayPath(report.workspaceDir, report.workspaceDir)}`,
    `Managed dir: ${formatDisplayPath(report.managedHooksDir, report.workspaceDir)}`,
    `Hooks: ${report.hooks.length} total · ${ready} ready · ${blocked} blocked · ${disabled} disabled`,
  ];

  if (report.hooks.length === 0) {
    lines.push("", "No workspace hooks found.");
    return { shouldContinue: false, reply: { text: lines.join("\n") } };
  }

  lines.push("");
  for (const entry of report.hooks) {
    const status = entry.disabled ? "disabled" : entry.eligible ? "ready" : "blocked";
    const statusReason = entry.disabled
      ? "disabled in config"
      : entry.eligible
        ? null
        : (formatHookMissing(entry) ?? "requirements missing");
    const events = entry.events.length > 0 ? ` · events=${entry.events.join(",")}` : "";
    const source =
      mode === "detail"
        ? ` · source=${entry.pluginId ? `${entry.source}:${entry.pluginId}` : entry.source}`
        : "";
    const location =
      mode === "detail" ? ` · path=${formatDisplayPath(entry.filePath, report.workspaceDir)}` : "";
    const reason = statusReason ? ` · ${statusReason}` : "";
    lines.push(`- ${entry.hookKey} [${status}]${events}${source}${location}${reason}`);
  }

  if (mode !== "detail") {
    lines.push("", "More: /hooks detail");
  }

  return { shouldContinue: false, reply: { text: lines.join("\n") } };
};
