import {
  DEFAULT_EDITOR_KEYBINDINGS,
  EditorKeybindingsManager,
  Key,
  matchesKey,
  type EditorAction,
  type EditorKeybindingsConfig,
  type KeyId,
} from "@mariozechner/pi-tui";

const MODIFIER_ORDER = ["ctrl", "shift", "alt"] as const;
const SPECIAL_KEY_ALIASES: Record<string, KeyId> = {
  escape: "escape",
  esc: "esc",
  enter: "enter",
  return: "return",
  tab: "tab",
  space: "space",
  backspace: "backspace",
  delete: "delete",
  insert: "insert",
  clear: "clear",
  home: "home",
  end: "end",
  pageup: "pageUp",
  pagedown: "pageDown",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  f1: "f1",
  f2: "f2",
  f3: "f3",
  f4: "f4",
  f5: "f5",
  f6: "f6",
  f7: "f7",
  f8: "f8",
  f9: "f9",
  f10: "f10",
  f11: "f11",
  f12: "f12",
};

const SYMBOL_KEYS = new Set([
  "`",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "|",
  "~",
  "{",
  "}",
  ":",
  "<",
  ">",
  "?",
]);

export const EDITOR_ACTIONS = Object.keys(DEFAULT_EDITOR_KEYBINDINGS) as EditorAction[];

export const TUI_SHORTCUT_ACTIONS = [
  "abortRun",
  "clearInputOrExit",
  "exit",
  "openModelPicker",
  "openAgentPicker",
  "openSessionPicker",
  "toggleToolOutput",
  "toggleThinking",
] as const;

export type TuiShortcutAction = (typeof TUI_SHORTCUT_ACTIONS)[number];
export type TuiKeybindingValue = KeyId | KeyId[] | null;
export type TuiEditorKeybindingsConfig = { [K in EditorAction]?: TuiKeybindingValue };
export type TuiShortcutBindingsConfig = { [K in TuiShortcutAction]?: TuiKeybindingValue };

export const DEFAULT_TUI_SHORTCUTS: Record<TuiShortcutAction, KeyId | KeyId[]> = {
  abortRun: Key.escape,
  clearInputOrExit: Key.ctrl("c"),
  exit: Key.ctrl("d"),
  openModelPicker: Key.ctrl("l"),
  openAgentPicker: Key.ctrl("g"),
  openSessionPicker: Key.ctrl("p"),
  toggleToolOutput: Key.ctrl("o"),
  toggleThinking: Key.ctrl("t"),
};

function normalizeBaseKey(raw: string): KeyId | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length === 1) {
    if (/^[a-z]$/i.test(trimmed)) {
      return trimmed.toLowerCase() as KeyId;
    }
    if (SYMBOL_KEYS.has(trimmed)) {
      return trimmed as KeyId;
    }
    return null;
  }

  return SPECIAL_KEY_ALIASES[trimmed.toLowerCase()] ?? null;
}

export function normalizeTuiKeyId(raw: string): KeyId | null {
  let rest = raw.trim();
  if (!rest) {
    return null;
  }

  const modifiers: Array<(typeof MODIFIER_ORDER)[number]> = [];
  while (rest.includes("+")) {
    const lower = rest.toLowerCase();
    let matched = false;
    for (const modifier of MODIFIER_ORDER) {
      const prefix = `${modifier}+`;
      if (lower.startsWith(prefix)) {
        if (modifiers.includes(modifier)) {
          return null;
        }
        modifiers.push(modifier);
        rest = rest.slice(prefix.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      break;
    }
  }

  const base = normalizeBaseKey(rest);
  if (!base) {
    return null;
  }

  return (modifiers.length > 0 ? `${modifiers.join("+")}+${base}` : base) as KeyId;
}

export function normalizeTuiKeybindingValue(value: TuiKeybindingValue | undefined): KeyId[] | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return [];
  }

  const entries = Array.isArray(value) ? value : [value];
  const normalized: KeyId[] = [];
  const seen = new Set<KeyId>();

  for (const entry of entries) {
    const keyId = normalizeTuiKeyId(String(entry));
    if (!keyId || seen.has(keyId)) {
      continue;
    }
    seen.add(keyId);
    normalized.push(keyId);
  }

  return normalized;
}

export function isValidTuiKeybindingValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === "string") {
    return normalizeTuiKeyId(value) !== null;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }
  return value.every((entry) => typeof entry === "string" && normalizeTuiKeyId(entry) !== null);
}

export class TuiShortcutManager {
  private actionToKeys = new Map<TuiShortcutAction, KeyId[]>();

  constructor(config: TuiShortcutBindingsConfig = {}) {
    this.buildMaps(config);
  }

  private buildMaps(config: TuiShortcutBindingsConfig) {
    this.actionToKeys.clear();

    for (const action of TUI_SHORTCUT_ACTIONS) {
      this.actionToKeys.set(
        action,
        normalizeTuiKeybindingValue(DEFAULT_TUI_SHORTCUTS[action]) ?? [],
      );
    }

    for (const action of TUI_SHORTCUT_ACTIONS) {
      if (!(action in config)) {
        continue;
      }
      this.actionToKeys.set(action, normalizeTuiKeybindingValue(config[action]) ?? []);
    }
  }

  matches(data: string, action: TuiShortcutAction): boolean {
    const keys = this.actionToKeys.get(action) ?? [];
    return keys.some((key) => matchesKey(data, key));
  }

  getKeys(action: TuiShortcutAction): KeyId[] {
    return [...(this.actionToKeys.get(action) ?? [])];
  }

  setConfig(config: TuiShortcutBindingsConfig): void {
    this.buildMaps(config);
  }
}

export function createEditorKeybindingsManager(
  config: TuiEditorKeybindingsConfig = {},
): EditorKeybindingsManager {
  const normalized: EditorKeybindingsConfig = {};

  for (const action of EDITOR_ACTIONS) {
    if (!(action in config)) {
      continue;
    }
    normalized[action] = normalizeTuiKeybindingValue(config[action]) ?? [];
  }

  return new EditorKeybindingsManager(normalized);
}
