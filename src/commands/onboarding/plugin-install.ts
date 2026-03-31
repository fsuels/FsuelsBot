import fs from "node:fs";
import path from "node:path";
import type { ChannelPluginCatalogEntry } from "../../channels/plugins/catalog.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { WizardPrompter } from "../../wizard/prompts.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { runPluginConfigWizard } from "../../plugins/configure-wizard.js";
import { installPluginFromNpmSpec } from "../../plugins/install.js";
import { applyInstalledPluginState } from "../../plugins/lifecycle.js";
import { loadOpenClawPlugins } from "../../plugins/loader.js";

type InstallChoice = "npm" | "local" | "skip";

type InstallResult = {
  cfg: OpenClawConfig;
  installed: boolean;
};

function hasGitWorkspace(workspaceDir?: string): boolean {
  const candidates = new Set<string>();
  candidates.add(path.join(process.cwd(), ".git"));
  if (workspaceDir && workspaceDir !== process.cwd()) {
    candidates.add(path.join(workspaceDir, ".git"));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return true;
    }
  }
  return false;
}

function resolveLocalPath(
  entry: ChannelPluginCatalogEntry,
  workspaceDir: string | undefined,
  allowLocal: boolean,
): string | null {
  if (!allowLocal) {
    return null;
  }
  const raw = entry.install.localPath?.trim();
  if (!raw) {
    return null;
  }
  const candidates = new Set<string>();
  candidates.add(path.resolve(process.cwd(), raw));
  if (workspaceDir && workspaceDir !== process.cwd()) {
    candidates.add(path.resolve(workspaceDir, raw));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function promptInstallChoice(params: {
  entry: ChannelPluginCatalogEntry;
  localPath?: string | null;
  defaultChoice: InstallChoice;
  prompter: WizardPrompter;
}): Promise<InstallChoice> {
  const { entry, localPath, prompter, defaultChoice } = params;
  const localOptions: Array<{ value: InstallChoice; label: string; hint?: string }> = localPath
    ? [
        {
          value: "local",
          label: "Use local plugin path",
          hint: localPath,
        },
      ]
    : [];
  const options: Array<{ value: InstallChoice; label: string; hint?: string }> = [
    { value: "npm", label: `Download from npm (${entry.install.npmSpec})` },
    ...localOptions,
    { value: "skip", label: "Skip for now" },
  ];
  const initialValue: InstallChoice =
    defaultChoice === "local" && !localPath ? "npm" : defaultChoice;
  return await prompter.select<InstallChoice>({
    message: `Install ${entry.meta.label} plugin?`,
    options,
    initialValue,
  });
}

function resolveInstallDefaultChoice(params: {
  cfg: OpenClawConfig;
  entry: ChannelPluginCatalogEntry;
  localPath?: string | null;
}): InstallChoice {
  const { cfg, entry, localPath } = params;
  const updateChannel = cfg.update?.channel;
  if (updateChannel === "dev") {
    return localPath ? "local" : "npm";
  }
  if (updateChannel === "stable" || updateChannel === "beta") {
    return "npm";
  }
  const entryDefault = entry.install.defaultChoice;
  if (entryDefault === "local") {
    return localPath ? "local" : "npm";
  }
  if (entryDefault === "npm") {
    return "npm";
  }
  return localPath ? "local" : "npm";
}

async function finalizeOnboardingPlugin(params: {
  cfg: OpenClawConfig;
  pluginId: string;
  runtime: RuntimeEnv;
  prompter: WizardPrompter;
  workspaceDir?: string;
  loadPath?: string;
  install?: {
    source: "npm" | "path";
    spec?: string;
    sourcePath?: string;
    installPath?: string;
    version?: string;
  };
}): Promise<InstallResult> {
  const lifecycle = applyInstalledPluginState({
    config: params.cfg,
    pluginId: params.pluginId,
    loadPath: params.loadPath,
    workspaceDir: params.workspaceDir,
    install: params.install
      ? {
          pluginId: params.pluginId,
          ...params.install,
        }
      : undefined,
  });

  if (lifecycle.status === "not_found" || lifecycle.status === "blocked") {
    await params.prompter.note(lifecycle.message, "Plugin install");
    params.runtime.error?.(lifecycle.message);
    return { cfg: lifecycle.config, installed: false };
  }

  let next = lifecycle.config;
  const wizardResult = await runPluginConfigWizard({
    config: next,
    pluginId: params.pluginId,
    workspaceDir: params.workspaceDir,
    prompter: params.prompter,
    mode: "required",
  });
  if (wizardResult.status === "configured") {
    next = wizardResult.config;
  } else if (wizardResult.status === "error") {
    await params.prompter.note(wizardResult.message, "Plugin config");
  }

  return { cfg: next, installed: true };
}

export async function ensureOnboardingPluginInstalled(params: {
  cfg: OpenClawConfig;
  entry: ChannelPluginCatalogEntry;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  workspaceDir?: string;
}): Promise<InstallResult> {
  const { entry, prompter, runtime, workspaceDir } = params;
  let next = params.cfg;
  const allowLocal = hasGitWorkspace(workspaceDir);
  const localPath = resolveLocalPath(entry, workspaceDir, allowLocal);
  const defaultChoice = resolveInstallDefaultChoice({
    cfg: next,
    entry,
    localPath,
  });
  const choice = await promptInstallChoice({
    entry,
    localPath,
    defaultChoice,
    prompter,
  });

  if (choice === "skip") {
    return { cfg: next, installed: false };
  }

  if (choice === "local" && localPath) {
    return await finalizeOnboardingPlugin({
      cfg: next,
      pluginId: entry.id,
      runtime,
      prompter,
      workspaceDir,
      loadPath: localPath,
      install: {
        source: "path",
        sourcePath: localPath,
        installPath: localPath,
      },
    });
  }

  const result = await installPluginFromNpmSpec({
    spec: entry.install.npmSpec,
    logger: {
      info: (msg) => runtime.log?.(msg),
      warn: (msg) => runtime.log?.(msg),
    },
  });

  if (result.ok) {
    return await finalizeOnboardingPlugin({
      cfg: next,
      pluginId: result.pluginId,
      runtime,
      prompter,
      workspaceDir,
      install: {
        source: "npm",
        spec: entry.install.npmSpec,
        installPath: result.targetDir,
        version: result.version,
      },
    });
  }

  await prompter.note(
    `Failed to install ${entry.install.npmSpec}: ${result.error}`,
    "Plugin install",
  );

  if (localPath) {
    const fallback = await prompter.confirm({
      message: `Use local plugin path instead? (${localPath})`,
      initialValue: true,
    });
    if (fallback) {
      return await finalizeOnboardingPlugin({
        cfg: next,
        pluginId: entry.id,
        runtime,
        prompter,
        workspaceDir,
        loadPath: localPath,
        install: {
          source: "path",
          sourcePath: localPath,
          installPath: localPath,
        },
      });
    }
  }

  runtime.error?.(`Plugin install failed: ${result.error}`);
  return { cfg: next, installed: false };
}

export function reloadOnboardingPluginRegistry(params: {
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  workspaceDir?: string;
}): void {
  const workspaceDir =
    params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, resolveDefaultAgentId(params.cfg));
  const log = createSubsystemLogger("plugins");
  loadOpenClawPlugins({
    config: params.cfg,
    workspaceDir,
    cache: false,
    logger: {
      info: (msg) => log.info(msg),
      warn: (msg) => log.warn(msg),
      error: (msg) => log.error(msg),
      debug: (msg) => log.debug(msg),
    },
  });
}
