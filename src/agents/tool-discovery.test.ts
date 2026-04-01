import type { AgentTool } from "@mariozechner/pi-agent-core";
import "./test-helpers/fast-core-tools.js";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createOpenClawCodingTools } from "./pi-tools.js";
import {
  __testing,
  applyToolDiscoveryMetadata,
  createToolDiscoveryActivationRuntime,
  partitionToolDiscoverySurface,
  resolveDeferredToolQuery,
} from "./tool-discovery.js";

function makeTool(
  name: string,
  options?: Partial<{
    description: string;
    searchSummary: string;
    alwaysLoad: boolean;
    shouldDefer: boolean;
    isProviderTool: boolean;
  }>,
) {
  return {
    name,
    label: name,
    description: options?.description ?? `${name} tool`,
    ...(options?.searchSummary ? { searchSummary: options.searchSummary } : {}),
    ...(options?.alwaysLoad !== undefined ? { alwaysLoad: options.alwaysLoad } : {}),
    ...(options?.shouldDefer !== undefined ? { shouldDefer: options.shouldDefer } : {}),
    ...(options?.isProviderTool !== undefined ? { isProviderTool: options.isProviderTool } : {}),
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }),
  };
}

describe("tool discovery", () => {
  beforeEach(() => {
    __testing.clearDeferredToolCache();
  });

  it("alwaysLoad overrides deferral defaults", () => {
    const tool = applyToolDiscoveryMetadata(
      makeTool("web_search", {
        alwaysLoad: true,
      }),
    );

    expect(tool.alwaysLoad).toBe(true);
    expect(tool.shouldDefer).toBe(false);
  });

  it("provider-backed tools default to deferred", () => {
    const browser = applyToolDiscoveryMetadata(makeTool("browser"));
    expect(browser.isProviderTool).toBe(true);
    expect(browser.shouldDefer).toBe(true);
  });

  it("resolver metadata is never deferred", () => {
    const resolver = applyToolDiscoveryMetadata(
      makeTool("tool_discovery", {
        shouldDefer: true,
      }),
    );

    expect(resolver.alwaysLoad).toBe(true);
    expect(resolver.shouldDefer).toBe(false);
  });

  it("keeps coordinator and response tools in the bootstrap set", () => {
    const tools = createOpenClawCodingTools({
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });
    const { bootstrapTools, deferredTools } = partitionToolDiscoverySurface(tools);
    const bootstrapNames = bootstrapTools.map((tool) => tool.name);
    const deferredNames = deferredTools.map((tool) => tool.name);

    expect(bootstrapNames).toContain("sessions_spawn");
    expect(bootstrapNames).toContain("message");
    expect(bootstrapNames).toContain("task_tracker");
    expect(deferredNames).toContain("browser");
  });

  it("matches exact names", () => {
    const resolution = resolveDeferredToolQuery({
      query: "web_search",
      deferredTools: [makeTool("web_search"), makeTool("web_fetch")],
    });

    expect(resolution.queryType).toBe("exact");
    expect(resolution.matches).toEqual(["web_search"]);
  });

  it("supports select: queries", () => {
    const resolution = resolveDeferredToolQuery({
      query: "select:web_search,web_fetch",
      deferredTools: [makeTool("web_search"), makeTool("web_fetch"), makeTool("browser")],
    });

    expect(resolution.queryType).toBe("select");
    expect(resolution.matches).toEqual(["web_search", "web_fetch"]);
  });

  it("filters keyword queries by required terms", () => {
    const resolution = resolveDeferredToolQuery({
      query: "+browser screenshot",
      deferredTools: [
        makeTool("browser", {
          searchSummary: "Capture page screenshots and interact with browser tabs.",
        }),
        makeTool("image", {
          searchSummary: "Generate images from prompts.",
        }),
      ],
    });

    expect(resolution.queryType).toBe("keyword");
    expect(resolution.matches).toEqual(["browser"]);
  });

  it("supports provider-prefix matching", () => {
    const resolution = resolveDeferredToolQuery({
      query: "mcp__github",
      deferredTools: [makeTool("mcp__github__create_issue"), makeTool("web_search")],
    });

    expect(resolution.queryType).toBe("prefix");
    expect(resolution.matches).toEqual(["mcp__github__create_issue"]);
  });

  it("treats already-loaded tools as successful no-ops", () => {
    const resolution = resolveDeferredToolQuery({
      query: "select:web_search,read",
      deferredTools: [makeTool("web_search")],
      activeTools: [makeTool("read")],
    });

    expect(resolution.matches).toEqual(["web_search", "read"]);
  });

  it("truncates keyword matches to maxResults", () => {
    const resolution = resolveDeferredToolQuery({
      query: "search",
      maxResults: 2,
      deferredTools: [
        makeTool("web_search", { searchSummary: "Search the web." }),
        makeTool("memory_search", { searchSummary: "Search saved memory." }),
        makeTool("code_search", { searchSummary: "Search code." }),
      ],
    });

    expect(resolution.matches).toHaveLength(2);
  });

  it("invalidates the search cache when the deferred tool set changes", () => {
    resolveDeferredToolQuery({
      query: "browser",
      deferredTools: [makeTool("browser")],
    });
    const cacheSizeBefore = __testing.getDeferredToolCacheSize();

    const resolution = resolveDeferredToolQuery({
      query: "image",
      deferredTools: [makeTool("browser"), makeTool("image")],
    });

    expect(__testing.getDeferredToolCacheSize()).toBeGreaterThan(cacheSizeBefore);
    expect(resolution.matches).toEqual(["image"]);
  });

  it("logs telemetry for success and failure", () => {
    const logger = {
      info: vi.fn(),
    };

    resolveDeferredToolQuery({
      query: "browser",
      deferredTools: [makeTool("browser")],
      logger,
    });
    resolveDeferredToolQuery({
      query: "unmatched zebra",
      deferredTools: [makeTool("browser")],
      logger,
    });

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      "tool discovery resolved",
      expect.objectContaining({ hasMatches: true }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "tool discovery resolved",
      expect.objectContaining({ hasMatches: false }),
    );
  });

  it("distinguishes pending providers from plain no-match states", () => {
    const resolution = resolveDeferredToolQuery({
      query: "github issue",
      deferredTools: [makeTool("browser")],
      pendingProviders: ["github", "slack"],
    });

    expect(resolution.pendingProviders).toEqual(["github", "slack"]);
    expect(resolution.message).toContain("Providers still connecting");
  });

  it("activates deferred tools by mutating the active tool array in place", () => {
    const browserTool = {
      name: "browser",
      parameters: {},
      execute: async () => ({ content: [{ type: "text" as const, text: "browser" }] }),
    } satisfies AgentTool<unknown, unknown>;
    const readTool = {
      name: "read",
      parameters: {},
      execute: async () => ({ content: [{ type: "text" as const, text: "read" }] }),
    } satisfies AgentTool<unknown, unknown>;
    const initialTools = [readTool, browserTool];
    const session = {
      agent: {
        state: {
          tools: initialTools,
        },
        setSystemPrompt: vi.fn(),
      },
      _toolRegistry: new Map([
        ["read", readTool],
        ["browser", browserTool],
      ]),
    } as unknown as AgentSession;

    const runtime = createToolDiscoveryActivationRuntime({
      session,
      buildSystemPrompt: (toolNames) => toolNames.join(","),
    });

    const initialRef = session.agent.state.tools;
    const bootstrap = runtime.replaceActiveToolNames(["read"]);
    const activated = runtime.activateToolNames(["browser"]);

    expect(bootstrap.activeToolNames).toEqual(["read"]);
    expect(activated.activated).toEqual(["browser"]);
    expect(session.agent.state.tools).toBe(initialRef);
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["read", "browser"]);
    expect(session.agent.setSystemPrompt.mock.lastCall?.[0]).toBe("read,browser");
  });
});
