import type { AgentTool } from "@mariozechner/pi-agent-core";

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
};

export function buildToolOperatorManualMap(
  tools: ToolWithOperatorManual[],
): Record<string, string> {
  const manuals: Record<string, string> = {};
  for (const tool of tools) {
    const manual = tool.operatorManual?.().trim();
    if (!manual) {
      continue;
    }
    manuals[tool.name.toLowerCase()] = manual;
  }
  return manuals;
}
