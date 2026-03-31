import { Type } from "@sinclair/typebox";
import type { ToolDiscoveryActivationRuntime } from "../tool-discovery.js";
import { defineOpenClawTool, type AnyOpenClawTool } from "../tool-contract.js";
import { resolveDeferredToolQuery } from "../tool-discovery.js";

export function createToolDiscoveryTool(options: {
  getDeferredTools: () => AnyOpenClawTool[];
  getActiveTools: () => AnyOpenClawTool[];
  runtimeRef?: { current: ToolDiscoveryActivationRuntime | null };
}): AnyOpenClawTool {
  return defineOpenClawTool({
    name: "tool_discovery",
    label: "Tool Discovery",
    description: "Load deferred tools by exact name, provider prefix, or keyword search.",
    searchSummary:
      "Discover and activate deferred tools by name, prefix, or keyword when a needed capability is missing.",
    alwaysLoad: true,
    shouldDefer: false,
    isProviderTool: false,
    parameters: Type.Object(
      {
        query: Type.String({
          minLength: 1,
          description:
            "Search query. Supports exact names, select:ToolA,ToolB, provider prefixes like mcp__server, and keyword search with +required terms.",
        }),
        maxResults: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 10,
            description: "Maximum number of matching deferred tools to activate (default: 5).",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    inputSchema: Type.Object(
      {
        query: Type.String({
          minLength: 1,
          description:
            "Search query. Supports exact names, select:ToolA,ToolB, provider prefixes like mcp__server, and keyword search with +required terms.",
        }),
        maxResults: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: 10,
            description: "Maximum number of matching deferred tools to activate (default: 5).",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, input, _signal, _onUpdate) => {
      const runtime = options.runtimeRef?.current ?? null;
      const resolution = resolveDeferredToolQuery({
        query: input.query,
        maxResults: input.maxResults,
        deferredTools: options.getDeferredTools(),
        activeTools: options.getActiveTools(),
        pendingProviders: runtime?.getPendingProviders?.(),
      });

      if (!runtime) {
        const details = {
          ...resolution,
          activated: [],
          alreadyLoaded: [],
          activationAvailable: false,
          message:
            resolution.message ??
            "Deferred tool discovery is available, but this runtime cannot activate matches.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
          details,
        };
      }

      const activation =
        resolution.matches.length > 0
          ? runtime.activateToolNames(resolution.matches)
          : {
              activated: [],
              alreadyLoaded: [],
              activeToolNames: runtime.getActiveToolNames(),
            };

      const details = {
        matches: resolution.matches,
        query: resolution.query,
        queryType: resolution.queryType,
        totalDeferredTools: resolution.totalDeferredTools,
        ...(resolution.pendingProviders ? { pendingProviders: resolution.pendingProviders } : {}),
        activated: activation.activated,
        alreadyLoaded: activation.alreadyLoaded,
        activationAvailable: true,
        message:
          resolution.message ??
          (resolution.matches.length > 0
            ? "Activated matching tools. They are available to call immediately in this run."
            : "No matching deferred tools found."),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
        details,
      };
    },
  });
}
