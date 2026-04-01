export type KnownModelFamily =
  | "anthropic-opus"
  | "anthropic-sonnet"
  | "openai-gpt"
  | "openai-gpt-mini"
  | "openai-codex"
  | "google-gemini"
  | "google-gemini-flash";

const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  "z.ai": "zai",
  "z-ai": "zai",
  "opencode-zen": "opencode",
  qwen: "qwen-portal",
  "kimi-code": "kimi-coding",
};

const PROVIDER_MODEL_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  anthropic: {
    "opus-4.6": "claude-opus-4-6",
    "opus-4.5": "claude-opus-4-5",
    "sonnet-4.5": "claude-sonnet-4-5",
  },
  google: {
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
  },
};

const DEFAULT_MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: "anthropic/claude-opus-4-6",
  sonnet: "anthropic/claude-sonnet-4-5",
  gpt: "openai/gpt-5.2",
  "gpt-mini": "openai/gpt-5-mini",
  gemini: "google/gemini-3-pro-preview",
  "gemini-flash": "google/gemini-3-flash-preview",
};

function normalizeComparableModelId(provider: string, model: string): string {
  const normalizedProvider = normalizeKnownProviderId(provider);
  return normalizeKnownModelId(normalizedProvider, model).toLowerCase();
}

export function getDefaultModelAliases(): Readonly<Record<string, string>> {
  return DEFAULT_MODEL_ALIASES;
}

export function normalizeKnownProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

export function normalizeKnownModelId(provider: string, model: string): string {
  const normalizedProvider = normalizeKnownProviderId(provider);
  const trimmed = model.trim();
  if (!trimmed) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  return PROVIDER_MODEL_ALIASES[normalizedProvider]?.[lower] ?? trimmed;
}

export function resolveKnownModelFamily(
  provider: string,
  model: string,
): KnownModelFamily | undefined {
  const lower = normalizeComparableModelId(provider, model);

  if (/(^|\/)claude-opus-/.test(lower)) {
    return "anthropic-opus";
  }
  if (/(^|\/)claude-sonnet-/.test(lower)) {
    return "anthropic-sonnet";
  }
  if (/(^|\/)gpt-.*codex/.test(lower) || /(^|\/)codex($|-)/.test(lower)) {
    return "openai-codex";
  }
  if (/(^|\/)gpt-.*mini/.test(lower)) {
    return "openai-gpt-mini";
  }
  if (/(^|\/)gpt-/.test(lower)) {
    return "openai-gpt";
  }
  if (/(^|\/)gemini-.*flash/.test(lower)) {
    return "google-gemini-flash";
  }
  if (/(^|\/)gemini-/.test(lower)) {
    return "google-gemini";
  }
  return undefined;
}
