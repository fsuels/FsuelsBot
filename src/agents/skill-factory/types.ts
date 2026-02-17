export type SkillFactoryOutcome = "success" | "error" | "aborted";

export type SkillFactoryEpisode = {
  id: string;
  ts: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  agentId: string;
  workspaceHash: string;
  workspaceLabel?: string;
  sessionKeyHash?: string;
  sessionIdHash?: string;
  taskIdHash?: string;
  runIdHash?: string;
  source: "embedded" | "cli" | "skill-command" | "backfill";
  intentSummary: string;
  intentHash: string;
  intentSignature: string;
  toolNames: string[];
  toolCount: number;
  provider?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  outcome: SkillFactoryOutcome;
  errorKind?: string;
  errorMessage?: string;
  generatedSkillKey?: string;
};

export type SkillFactoryRepeatEntry = {
  scopedSignature: string;
  signature: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  episodeIds: string[];
  intentSummary: string;
  toolNames: string[];
};

export type SkillFactoryRepeatIndex = {
  version: 1;
  updatedAt: number;
  entries: Record<string, SkillFactoryRepeatEntry>;
};

export type SkillFactorySafetyRiskClass = "read_only" | "writes" | "send" | "transaction";

export type SkillFactorySafetyManifest = {
  version: 1;
  permissions: {
    tools: string[];
    networkDomains?: string[];
    fileReadGlobs?: string[];
    fileWriteGlobs?: string[];
    execAllowlist?: string[];
  };
  risk: {
    sideEffects: SkillFactorySafetyRiskClass;
    requiresConfirmation?: boolean;
  };
};

export type SkillFactoryVersionStatus = "draft" | "candidate" | "trusted" | "rejected";

export type SkillFactorySkillVersion = {
  hash: string;
  createdAt: number;
  sourceSignature: string;
  status: SkillFactoryVersionStatus;
  generated: boolean;
  skillName: string;
  dispatchTool: string;
  draftDir: string;
  managedDir?: string;
  manifestHash: string;
  lastEvalKey?: string;
};

export type SkillFactorySkillRecord = {
  skillKey: string;
  skillName: string;
  trustedHash?: string;
  versions: Record<string, SkillFactorySkillVersion>;
  updatedAt: number;
};

export type SkillFactoryRegistry = {
  version: 1;
  updatedAt: number;
  skills: Record<string, SkillFactorySkillRecord>;
};

export type SkillFactoryEvalRecord = {
  key: string;
  ts: number;
  skillKey: string;
  skillHash: string;
  suiteId: string;
  datasetHash: string;
  runtimeHash: string;
  passed: boolean;
  metrics: {
    samples: number;
    baselineSuccessRate: number;
    candidateSuccessRate: number;
    baselineMedianDurationMs: number;
    candidateMedianDurationMs: number;
  };
  reason?: string;
};

export type SkillFactoryBackfillState = {
  version: 1;
  updatedAt: number;
  files: Record<string, { hash: string; updatedAt: number }>;
};

export type SkillFactoryRuntimeProfile = {
  provider?: string;
  model?: string;
  toolPolicyHash: string;
  surface: "embedded" | "cli" | "skill-command";
};
