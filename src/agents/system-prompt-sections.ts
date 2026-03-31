import { createHash } from "node:crypto";

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "## Dynamic Runtime Context";

export type PromptSection = {
  name: string;
  text: string;
  cacheable: boolean;
  reason?: string;
};

export type PromptAssemblyCacheStatus = "hit" | "miss";

export type PromptAssemblyArtifact = {
  prompt: string;
  staticPrefix: string;
  dynamicTail: string;
  boundaryMarker: string;
  staticPrefixHash: string;
  staticPrefixCacheStatus: PromptAssemblyCacheStatus;
  staticPrefixSeenCount: number;
  recomputedSectionCount: number;
  staticSectionNames: string[];
  dynamicSectionNames: string[];
  sections: Array<{
    name: string;
    cacheable: boolean;
    chars: number;
    reason?: string;
  }>;
};

const observedStaticPrefixHashes = new Map<string, number>();

function normalizeSectionText(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => String(entry))
      .join("\n")
      .trim();
  }
  return value.trim();
}

export function promptSection(
  name: string,
  compute: () => string | string[],
): PromptSection | null {
  const text = normalizeSectionText(compute());
  if (!text) {
    return null;
  }
  return {
    name,
    text,
    cacheable: true,
  };
}

export function uncachedPromptSection(
  name: string,
  compute: () => string | string[],
  reason: string,
): PromptSection | null {
  const text = normalizeSectionText(compute());
  if (!text) {
    return null;
  }
  return {
    name,
    text,
    cacheable: false,
    reason,
  };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function assemblePromptSections(
  sections: Array<PromptSection | null | undefined>,
): PromptAssemblyArtifact {
  const normalized = sections.filter((section): section is PromptSection => Boolean(section));
  const staticSections = normalized.filter((section) => section.cacheable);
  const dynamicSections = normalized.filter((section) => !section.cacheable);
  const staticPrefix = staticSections
    .map((section) => section.text)
    .join("\n\n")
    .trim();
  const dynamicTail = dynamicSections
    .map((section) => section.text)
    .join("\n\n")
    .trim();
  const prompt = dynamicTail
    ? [staticPrefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, dynamicTail].filter(Boolean).join("\n\n")
    : staticPrefix;
  const staticPrefixHash = shortHash(staticPrefix);
  const seenCount = observedStaticPrefixHashes.get(staticPrefixHash) ?? 0;
  observedStaticPrefixHashes.set(staticPrefixHash, seenCount + 1);
  const staticPrefixCacheStatus: PromptAssemblyCacheStatus = seenCount > 0 ? "hit" : "miss";
  const recomputedSectionCount =
    dynamicSections.length + (staticPrefixCacheStatus === "miss" ? staticSections.length : 0);

  return {
    prompt,
    staticPrefix,
    dynamicTail,
    boundaryMarker: SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    staticPrefixHash,
    staticPrefixCacheStatus,
    staticPrefixSeenCount: seenCount + 1,
    recomputedSectionCount,
    staticSectionNames: staticSections.map((section) => section.name),
    dynamicSectionNames: dynamicSections.map((section) => section.name),
    sections: normalized.map((section) => ({
      name: section.name,
      cacheable: section.cacheable,
      chars: section.text.length,
      reason: section.reason,
    })),
  };
}

export function resetPromptSectionAssemblyCacheForTests() {
  observedStaticPrefixHashes.clear();
}
