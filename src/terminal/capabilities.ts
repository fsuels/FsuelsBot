import { Chalk } from "chalk";
import { supportsOscProgress as envSupportsOscProgress } from "osc-progress";

export type TerminalColorLevel = 0 | 1 | 2 | 3;
export type TerminalTruecolorLevel = 0 | 2 | 3;

export type TerminalCapabilityOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  stream?: Pick<NodeJS.WriteStream, "isTTY">;
  isTTY?: boolean;
};

export type TerminalCapabilities = {
  isTTY: boolean;
  term: string | null;
  termProgram: string | null;
  termProgramVersion: string | null;
  isTmux: boolean;
  isScreen: boolean;
  isWindowsTerminal: boolean;
  isXtermJs: boolean;
  msystem: string | null;
  noColor: boolean;
  forceColor: string | null;
  colorLevel: TerminalColorLevel;
  truecolorLevel: TerminalTruecolorLevel;
  supportsHyperlinks: boolean;
  supportsOscProgress: boolean;
  supportsScrollbackErase: boolean;
  shouldClampTruecolorForTmux: boolean;
  shouldBoostTruecolorForVscodeXterm: boolean;
  needsSoftwareBidi: boolean;
};

function readLower(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value.toLowerCase() : null;
}

function readText(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function readBooleanOverride(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  return null;
}

function parseForcedColorLevel(value: string | null): TerminalColorLevel | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "false" || normalized === "0") {
    return 0;
  }
  if (normalized === "true") {
    return 1;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed)) {
    return 1;
  }
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 3) {
    return 3;
  }
  return parsed as TerminalColorLevel;
}

function supportsHyperlinksByEnv(env: NodeJS.ProcessEnv): boolean {
  const term = readLower(env, "TERM");
  const termProgram = readLower(env, "TERM_PROGRAM");
  const force = readBooleanOverride(env.FORCE_HYPERLINK);
  const disable = readBooleanOverride(env.NO_HYPERLINKS);
  if (force !== null) {
    return force;
  }
  if (disable === true || term === "dumb") {
    return false;
  }

  const vteVersion = Number.parseInt(env.VTE_VERSION ?? "", 10);
  return Boolean(
    env.WT_SESSION ||
    env.KITTY_WINDOW_ID ||
    env.WEZTERM_EXECUTABLE ||
    env.WEZTERM_PANE ||
    env.KONSOLE_VERSION ||
    env.DOMTERM ||
    termProgram === "iterm.app" ||
    termProgram === "wezterm" ||
    termProgram === "vscode" ||
    termProgram === "hyper" ||
    termProgram === "ghostty" ||
    term?.includes("kitty") ||
    term?.includes("ghostty") ||
    vteVersion >= 5000,
  );
}

function resolveBaseColorLevel(input: {
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  term: string | null;
  termProgram: string | null;
  isWindowsTerminal: boolean;
  isTmux: boolean;
}): TerminalColorLevel {
  const forcedLevel = parseForcedColorLevel(readText(input.env, "FORCE_COLOR"));
  if (forcedLevel !== null) {
    return forcedLevel;
  }
  if (readText(input.env, "NO_COLOR")) {
    return 0;
  }
  if (!input.isTTY) {
    return 0;
  }
  if (input.term === "dumb") {
    return 0;
  }

  const colorTerm = readLower(input.env, "COLORTERM");
  if (
    colorTerm === "truecolor" ||
    colorTerm === "24bit" ||
    input.isWindowsTerminal ||
    input.termProgram === "kitty" ||
    input.termProgram === "ghostty" ||
    input.termProgram === "wezterm" ||
    input.termProgram === "iterm.app"
  ) {
    return 3;
  }

  if (
    input.term?.includes("256color") ||
    input.isTmux ||
    Boolean(input.termProgram) ||
    Boolean(colorTerm)
  ) {
    return 2;
  }

  return 1;
}

export function resolveTerminalCapabilities(
  options: TerminalCapabilityOptions = {},
): TerminalCapabilities {
  const env = options.env ?? process.env;
  const stream = options.stream ?? process.stdout;
  const platform = options.platform ?? process.platform;
  const term = readLower(env, "TERM");
  const termProgram = readLower(env, "TERM_PROGRAM");
  const termProgramVersion = readText(env, "TERM_PROGRAM_VERSION");
  const isTTY = options.isTTY ?? Boolean(stream.isTTY);
  const isTmux = Boolean(env.TMUX);
  const isScreen = Boolean(term?.startsWith("screen"));
  const isWindowsTerminal = Boolean(env.WT_SESSION);
  const isXtermJs = Boolean(
    env.VSCODE_GIT_IPC_HANDLE || env.VSCODE_INJECTION || termProgram === "vscode",
  );
  const msystem = readText(env, "MSYSTEM");
  const noColor = Boolean(readText(env, "NO_COLOR"));
  const forceColor = readText(env, "FORCE_COLOR");

  let colorLevel = resolveBaseColorLevel({
    env,
    isTTY,
    term,
    termProgram,
    isWindowsTerminal,
    isTmux,
  });

  const forceDisabled = parseForcedColorLevel(forceColor) === 0;
  const shouldBoostTruecolorForVscodeXterm =
    termProgram === "vscode" && colorLevel === 2 && !noColor && !forceDisabled;
  if (shouldBoostTruecolorForVscodeXterm) {
    colorLevel = 3;
  }

  const shouldClampTruecolorForTmux =
    isTmux && colorLevel > 2 && readText(env, "OPENCLAW_TMUX_TRUECOLOR") !== "1";
  if (shouldClampTruecolorForTmux) {
    colorLevel = 2;
  }

  const truecolorLevel: TerminalTruecolorLevel = colorLevel >= 3 ? 3 : colorLevel >= 2 ? 2 : 0;
  const legacyWindowsConsole =
    platform === "win32" && !isWindowsTerminal && termProgram !== "vscode" && !msystem && !term;
  const supportsHyperlinks = isTTY && !legacyWindowsConsole && supportsHyperlinksByEnv(env);
  const supportsOscProgress = isTTY && envSupportsOscProgress(env, isTTY);

  return {
    isTTY,
    term,
    termProgram,
    termProgramVersion,
    isTmux,
    isScreen,
    isWindowsTerminal,
    isXtermJs,
    msystem,
    noColor,
    forceColor,
    colorLevel,
    truecolorLevel,
    supportsHyperlinks,
    supportsOscProgress,
    supportsScrollbackErase: !legacyWindowsConsole,
    shouldClampTruecolorForTmux,
    shouldBoostTruecolorForVscodeXterm,
    needsSoftwareBidi: platform === "win32" || isWindowsTerminal || termProgram === "vscode",
  };
}

export function getTerminalCapabilities(
  options: TerminalCapabilityOptions = {},
): TerminalCapabilities {
  return resolveTerminalCapabilities(options);
}

export function supportsTerminalHyperlinks(options?: TerminalCapabilityOptions): boolean {
  return getTerminalCapabilities(options).supportsHyperlinks;
}

export function createTerminalChalk(options: TerminalCapabilityOptions = {}): Chalk {
  return new Chalk({
    level: resolveTerminalCapabilities(options).colorLevel,
  });
}
