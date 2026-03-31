export type SkillConfig = {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
};

export type SkillsLoadConfig = {
  /**
   * Additional skill folders to scan (lowest precedence).
   * Each directory should contain skill subfolders with `SKILL.md`.
   */
  extraDirs?: string[];
  /** Watch skill folders for changes and refresh the skills snapshot. */
  watch?: boolean;
  /** Debounce for the skills watcher (ms). */
  watchDebounceMs?: number;
  /** Optional hard cap for the discoverable skill prompt text (characters). */
  promptBudgetChars?: number;
  /** Optional hard cap for per-skill prompt descriptions (characters). */
  descriptionMaxChars?: number;
};

export type SkillsInstallConfig = {
  preferBrew?: boolean;
  nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
};

export type SkillInvokeConfig = {
  /** Explicit allowlist for user-invocable skills. Supports exact names and prefix wildcards (e.g. "review:*"). */
  allow?: string[];
  /** Explicit denylist for user-invocable skills. Supports exact names and prefix wildcards (e.g. "review:*"). */
  deny?: string[];
  /** Explicit trusted auto-allow rules for user-invocable skills. Supports exact names and prefix wildcards. */
  trusted?: string[];
};

export type SkillsConfig = {
  /** Optional bundled-skill allowlist (only affects bundled skills). */
  allowBundled?: string[];
  load?: SkillsLoadConfig;
  install?: SkillsInstallConfig;
  invoke?: SkillInvokeConfig;
  entries?: Record<string, SkillConfig>;
};
