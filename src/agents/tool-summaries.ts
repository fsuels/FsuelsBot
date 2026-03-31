import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolInvocationContract } from "./tool-contract.js";

export function buildToolSummaryMap(tools: AgentTool[]): Record<string, string> {
  const summaries: Record<string, string> = {};
  for (const tool of tools) {
    const summary = tool.description?.trim() || tool.label?.trim();
    if (!summary) {
      continue;
    }
    summaries[tool.name.toLowerCase()] = summary;
  }
  return summaries;
}

type ToolWithOperatorManual = AgentTool & {
  operatorManual?: () => string;
  invocationContract?: ToolInvocationContract;
};

function buildInvocationContractManual(contract: ToolInvocationContract | undefined): string {
  if (!contract) {
    return "";
  }

  const lines = [
    `Usage policy: ${contract.usagePolicy}`,
    `Side effects: ${contract.sideEffectLevel}`,
    `Behavior: ${contract.behaviorSummary}`,
  ];

  if (contract.whenToUse.length > 0) {
    lines.push("When to use:");
    lines.push(...contract.whenToUse.map((entry) => `- ${entry}`));
  }

  if ((contract.whenNotToUse?.length ?? 0) > 0) {
    lines.push("When not to use:");
    lines.push(...(contract.whenNotToUse ?? []).map((entry) => `- ${entry}`));
  }

  if ((contract.preconditions?.length ?? 0) > 0) {
    lines.push("Requirements:");
    lines.push(...(contract.preconditions ?? []).map((entry) => `- ${entry}`));
  }

  if ((contract.parametersSummary?.length ?? 0) > 0) {
    lines.push("Parameters:");
    lines.push(...(contract.parametersSummary ?? []).map((entry) => `- ${entry}`));
  }

  return lines.join("\n");
}

export function buildToolOperatorManualMap(
  tools: ToolWithOperatorManual[],
): Record<string, string> {
  const manuals: Record<string, string> = {};
  for (const tool of tools) {
    const manual = tool.operatorManual?.().trim();
    const contractManual = buildInvocationContractManual(tool.invocationContract).trim();
    const combined = [manual, contractManual].filter(Boolean).join("\n\n");
    if (!combined) {
      continue;
    }
    manuals[tool.name.toLowerCase()] = combined;
  }
  return manuals;
}
