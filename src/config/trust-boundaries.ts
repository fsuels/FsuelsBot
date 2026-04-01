export const CONFIG_RUNTIME_SAFETY_DOC = "docs/security/config-runtime-safety.md";

const ROOT_ONLY_CONFIG_PATHS = [
  "env.shellEnv",
  "browser.noSandbox",
  "tools.exec.ask",
  "tools.exec.security",
  "gateway.controlUi.allowInsecureAuth",
  "gateway.controlUi.dangerouslyDisableDeviceAuth",
  "gateway.nodes.allowCommands",
  "skills.invoke.trusted",
] as const;

type PathHint = {
  prefix: string;
  suggestion: string;
};

const PATH_HINTS: PathHint[] = [
  {
    prefix: "ui.tui",
    suggestion: 'Use key ids like "ctrl+p", "shift+enter", or null to unbind.',
  },
  {
    prefix: "tools.exec.ask",
    suggestion: 'Use "always" to always prompt, or "on-miss" to prompt when allowlists miss.',
  },
  {
    prefix: "tools.exec.security",
    suggestion: 'Prefer "deny" or "allowlist"; reserve "full" for tightly controlled local setups.',
  },
  {
    prefix: "browser.noSandbox",
    suggestion:
      "Keep browser.noSandbox disabled unless Chromium is running inside a constrained container that requires it.",
  },
  {
    prefix: "gateway.controlUi.allowInsecureAuth",
    suggestion:
      "Leave insecure Control UI auth disabled unless you are terminating TLS elsewhere on a trusted local path.",
  },
  {
    prefix: "gateway.controlUi.dangerouslyDisableDeviceAuth",
    suggestion:
      "Prefer device-based auth; only disable it for short-lived local testing in a controlled environment.",
  },
  {
    prefix: "gateway.nodes.allowCommands",
    suggestion:
      "Keep the gateway node allowlist tight; add only the exact commands you expect remote nodes to run.",
  },
  {
    prefix: "skills.invoke.trusted",
    suggestion:
      "Use skills.invoke.allow or deny first; reserve trusted rules for pre-approved skills that should skip extra approval.",
  },
  {
    prefix: "plugins.load.paths",
    suggestion: "Check that the plugin directory exists and contains a valid OpenClaw plugin manifest.",
  },
  {
    prefix: "agents.defaults.heartbeat.target",
    suggestion: 'Use "last", "none", a built-in channel id, or a loaded plugin channel id.',
  },
  {
    prefix: "agents.list",
    suggestion: "Check agent ids, workspace paths, and per-agent tool selectors for typos.",
  },
  {
    prefix: "tools",
    suggestion:
      "Use known tool ids, tool groups, plugin ids, or wildcard patterns that match currently available tools.",
  },
];

function normalizePath(pathRaw: string): string {
  return pathRaw
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(".");
}

function matchesPathPrefix(pathRaw: string, prefix: string): boolean {
  const path = normalizePath(pathRaw);
  const normalizedPrefix = normalizePath(prefix);
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}.`);
}

export function listRootOnlyConfigPaths(): string[] {
  return [...ROOT_ONLY_CONFIG_PATHS];
}

export function isRootOnlyConfigPath(pathRaw: string): boolean {
  return ROOT_ONLY_CONFIG_PATHS.some((prefix) => matchesPathPrefix(pathRaw, prefix));
}

export function getConfigIssueDocLink(pathRaw?: string): string {
  if (pathRaw && isRootOnlyConfigPath(pathRaw)) {
    return `${CONFIG_RUNTIME_SAFETY_DOC}#trust-boundaries`;
  }
  return `${CONFIG_RUNTIME_SAFETY_DOC}#validation-errors`;
}

export function getConfigIssueSuggestion(params: {
  path?: string;
  message?: string;
  expected?: string;
  rootOnly?: boolean;
}): string | undefined {
  if (params.rootOnly) {
    return "Set this directly in the main config file instead of an included fragment.";
  }

  const pathRaw = params.path ?? "";
  for (const hint of PATH_HINTS) {
    if (matchesPathPrefix(pathRaw, hint.prefix)) {
      return hint.suggestion;
    }
  }

  const message = params.message?.toLowerCase() ?? "";
  if (message.includes("unrecognized key")) {
    return "Remove unsupported keys or move them to the closest supported config section.";
  }
  if (message.includes("plugin not found")) {
    return "Install the plugin first, or correct the plugin id/path.";
  }
  if (message.includes("unknown heartbeat target")) {
    return 'Use "last", "none", a built-in channel id, or a loaded plugin channel id.';
  }
  if (message.includes("tool selector")) {
    return "Use known tool ids, tool groups, plugin ids, or wildcard patterns that match available tools.";
  }
  if (message.includes("invalid")) {
    if (params.expected) {
      return `Update this value to match the expected shape: ${params.expected}.`;
    }
    return "Update this value to match the expected config schema.";
  }
  return undefined;
}
