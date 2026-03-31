import type { Skill } from "@mariozechner/pi-coding-agent";

export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type OpenClawSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillInvocationPolicy = {
  userInvocable: boolean;
  disableModelInvocation: boolean;
};

export type SkillExecutionContextMode = "inline" | "fork";

export type SkillDefinitionMetadata = {
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  arguments?: string[];
  allowedTools?: string[];
  model?: string;
  effort?: string;
  context?: SkillExecutionContextMode;
  agent?: string;
  pathFilters?: string[];
};

export type SkillCommandDispatchSpec = {
  kind: "tool";
  /** Name of the tool to invoke (AnyAgentTool.name). */
  toolName: string;
  /**
   * How to forward user-provided args to the tool.
   * - raw: forward the raw args string (no core parsing).
   */
  argMode?: "raw";
};

export type SkillCommandSpec = {
  name: string;
  skillName: string;
  description: string;
  aliases?: string[];
  /** Optional deterministic dispatch behavior for this command. */
  dispatch?: SkillCommandDispatchSpec;
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};

export type ParsedSkillFrontmatter = Record<string, string>;

export type SkillEntry = {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  metadata?: OpenClawSkillMetadata;
  invocation?: SkillInvocationPolicy;
  definition?: SkillDefinitionMetadata;
  canonicalFilePath?: string;
};

export type SkillEligibilityContext = {
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
  activationPaths?: string[];
};

export type SkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string }>;
  resolvedSkills?: Skill[];
  version?: number;
};

export type SkillSourceCategory =
  | "bundled"
  | "workspace"
  | "managed"
  | "plugin"
  | "extra"
  | "unknown";

export type SkillsPromptTruncationMode = "full" | "truncated" | "names_only" | "omitted";

export type SkillPromptMetrics = {
  totalSkills: number;
  includedSkills: number;
  budgetChars: number;
  truncationMode: SkillsPromptTruncationMode;
  truncatedCount: number;
};

export type DiscoverableSkill = {
  entry: SkillEntry;
  name: string;
  description: string;
  whenToUse?: string;
  sourceCategory: SkillSourceCategory;
  promptPriority: number;
};
