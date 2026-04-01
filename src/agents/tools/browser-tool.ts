import crypto from "node:crypto";
import {
  browserAct,
  browserArmDialog,
  browserArmFileChooser,
  browserConsoleMessages,
  browserNavigate,
  browserPdfSave,
  browserScreenshotAction,
} from "../../browser/client-actions.js";
import {
  browserCloseTab,
  browserFocusTab,
  browserOpenTab,
  browserProfiles,
  browserSnapshot,
  browserStart,
  browserStatus,
  browserStop,
  browserTabs,
} from "../../browser/client.js";
import { resolveBrowserConfig } from "../../browser/config.js";
import { DEFAULT_AI_SNAPSHOT_MAX_CHARS } from "../../browser/constants.js";
import { parseClickButton, parseClickModifiers } from "../../browser/routes/agent.act.shared.js";
import { loadConfig } from "../../config/config.js";
import { saveMediaBuffer } from "../../media/store.js";
import { validateFlatActionInput, type ActionValidationRule } from "./action-validation.js";
import { BrowserToolSchema } from "./browser-tool.schema.js";
import { type AnyAgentTool, imageResultFromFile, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";
import { listNodes, resolveNodeIdFromList, type NodeListNode } from "./nodes-utils.js";

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;
const REQUEST_REQUIRED = { key: "request", label: "request", presence: "defined" } as const;
const PATHS_REQUIRED = { key: "paths", label: "paths", presence: "defined" } as const;
const TEXT_DEFINED = { key: "text", label: "text", presence: "defined" } as const;
const VALUES_DEFINED = { key: "values", label: "values", presence: "defined" } as const;
const FIELDS_DEFINED = { key: "fields", label: "fields", presence: "defined" } as const;
const WIDTH_DEFINED = { key: "width", label: "width", presence: "defined" } as const;
const HEIGHT_DEFINED = { key: "height", label: "height", presence: "defined" } as const;
const WAIT_MESSAGE =
  "wait requires at least one of: timeMs, text, textGone, selector, url, loadState, fn";

const BROWSER_ACTION_RULES: Record<string, ActionValidationRule> = {
  status: {},
  start: {},
  stop: {},
  profiles: {},
  tabs: {},
  open: {
    required: ["targetUrl"],
  },
  focus: {
    required: ["targetId"],
  },
  close: {},
  snapshot: {},
  screenshot: {},
  navigate: {
    required: ["targetUrl"],
  },
  console: {},
  pdf: {},
  upload: {
    required: [PATHS_REQUIRED],
    custom: (input) =>
      Array.isArray(input.paths) && input.paths.length > 0
        ? undefined
        : "paths required for action=upload",
  },
  dialog: {},
  act: {
    required: [REQUEST_REQUIRED],
  },
};

const BROWSER_ACT_REQUEST_RULES: Record<string, ActionValidationRule> = {
  click: {
    required: ["ref"],
  },
  type: {
    required: ["ref", TEXT_DEFINED],
  },
  press: {
    required: ["key"],
  },
  hover: {
    required: ["ref"],
  },
  scrollIntoView: {
    required: ["ref"],
  },
  drag: {
    required: ["startRef", "endRef"],
  },
  select: {
    required: ["ref", VALUES_DEFINED],
  },
  fill: {
    required: [FIELDS_DEFINED],
  },
  resize: {
    required: [WIDTH_DEFINED, HEIGHT_DEFINED],
  },
  wait: {},
  evaluate: {
    required: ["fn"],
  },
  close: {},
};

function hasValidFillField(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.ref === "string" &&
    record.ref.trim().length > 0 &&
    typeof record.type === "string" &&
    record.type.trim().length > 0
  );
}

function validateBrowserActRequest(request: unknown): string | undefined {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return "request required for action=act";
  }

  const input = request as Record<string, unknown>;
  const kind = typeof input.kind === "string" ? input.kind : "";
  if (!kind) {
    return "request.kind required for action=act";
  }

  const validation = validateFlatActionInput({
    toolName: "browser",
    action: kind,
    input,
    rules: BROWSER_ACT_REQUEST_RULES,
  });
  if (!validation.result) {
    return validation.message;
  }

  if (Object.hasOwn(input, "selector") && kind !== "wait") {
    return "selector is only supported for action=wait";
  }

  switch (kind) {
    case "click": {
      const button = typeof input.button === "string" ? input.button : "";
      if (button && !parseClickButton(button)) {
        return "button must be left|right|middle for action=click";
      }
      if (Array.isArray(input.modifiers)) {
        const modifiers = input.modifiers.filter(
          (value): value is string => typeof value === "string",
        );
        const parsed = parseClickModifiers(modifiers);
        if (parsed.error) {
          return `${parsed.error} for action=click`;
        }
      }
      return undefined;
    }
    case "select":
      return Array.isArray(input.values) && input.values.length > 0
        ? undefined
        : "values required for action=select";
    case "fill":
      return Array.isArray(input.fields) && input.fields.some((field) => hasValidFillField(field))
        ? undefined
        : "fields required for action=fill";
    case "resize": {
      const width = input.width;
      const height = input.height;
      return typeof width === "number" &&
        Number.isFinite(width) &&
        width > 0 &&
        typeof height === "number" &&
        Number.isFinite(height) &&
        height > 0
        ? undefined
        : "width and height required for action=resize";
    }
    case "wait": {
      const hasWaitCondition =
        (typeof input.timeMs === "number" && Number.isFinite(input.timeMs)) ||
        (typeof input.text === "string" && input.text.trim().length > 0) ||
        (typeof input.textGone === "string" && input.textGone.trim().length > 0) ||
        (typeof input.selector === "string" && input.selector.trim().length > 0) ||
        (typeof input.url === "string" && input.url.trim().length > 0) ||
        (typeof input.loadState === "string" && input.loadState.trim().length > 0) ||
        (typeof input.fn === "string" && input.fn.trim().length > 0);
      return hasWaitCondition ? undefined : WAIT_MESSAGE;
    }
    default:
      return undefined;
  }
}

type BrowserNodeTarget = {
  nodeId: string;
  label?: string;
};

function isBrowserNode(node: NodeListNode) {
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return caps.includes("browser") || commands.includes("browser.proxy");
}

async function resolveBrowserNodeTarget(params: {
  requestedNode?: string;
  target?: "sandbox" | "host" | "node";
  sandboxBridgeUrl?: string;
}): Promise<BrowserNodeTarget | null> {
  const cfg = loadConfig();
  const policy = cfg.gateway?.nodes?.browser;
  const mode = policy?.mode ?? "auto";
  if (mode === "off") {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("Node browser proxy is disabled (gateway.nodes.browser.mode=off).");
    }
    return null;
  }
  if (params.sandboxBridgeUrl?.trim() && params.target !== "node" && !params.requestedNode) {
    return null;
  }
  if (params.target && params.target !== "node") {
    return null;
  }
  if (mode === "manual" && params.target !== "node" && !params.requestedNode) {
    return null;
  }

  const nodes = await listNodes({});
  const browserNodes = nodes.filter((node) => node.connected && isBrowserNode(node));
  if (browserNodes.length === 0) {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("No connected browser-capable nodes.");
    }
    return null;
  }

  const requested = params.requestedNode?.trim() || policy?.node?.trim();
  if (requested) {
    const nodeId = resolveNodeIdFromList(browserNodes, requested, false);
    const node = browserNodes.find((entry) => entry.nodeId === nodeId);
    return { nodeId, label: node?.displayName ?? node?.remoteIp ?? nodeId };
  }

  if (params.target === "node") {
    if (browserNodes.length === 1) {
      const node = browserNodes[0];
      return { nodeId: node.nodeId, label: node.displayName ?? node.remoteIp ?? node.nodeId };
    }
    throw new Error(
      `Multiple browser-capable nodes connected (${browserNodes.length}). Set gateway.nodes.browser.node or pass node=<id>.`,
    );
  }

  if (mode === "manual") {
    return null;
  }

  if (browserNodes.length === 1) {
    const node = browserNodes[0];
    return { nodeId: node.nodeId, label: node.displayName ?? node.remoteIp ?? node.nodeId };
  }
  return null;
}

async function callBrowserProxy(params: {
  nodeId: string;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
}): Promise<BrowserProxyResult> {
  const gatewayTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1, Math.floor(params.timeoutMs))
      : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
  const payload = await callGatewayTool<{ payloadJSON?: string; payload?: string }>(
    "node.invoke",
    { timeoutMs: gatewayTimeoutMs },
    {
      nodeId: params.nodeId,
      command: "browser.proxy",
      params: {
        method: params.method,
        path: params.path,
        query: params.query,
        body: params.body,
        timeoutMs: params.timeoutMs,
        profile: params.profile,
      },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const parsed =
    payload?.payload ??
    (typeof payload?.payloadJSON === "string" && payload.payloadJSON
      ? (JSON.parse(payload.payloadJSON) as BrowserProxyResult)
      : null);
  if (!parsed || typeof parsed !== "object" || !("result" in parsed)) {
    throw new Error("browser proxy failed");
  }
  return parsed;
}

async function persistProxyFiles(files: BrowserProxyFile[] | undefined) {
  if (!files || files.length === 0) {
    return new Map<string, string>();
  }
  const mapping = new Map<string, string>();
  for (const file of files) {
    const buffer = Buffer.from(file.base64, "base64");
    const saved = await saveMediaBuffer(buffer, file.mimeType, "browser", buffer.byteLength);
    mapping.set(file.path, saved.path);
  }
  return mapping;
}

function applyProxyPaths(result: unknown, mapping: Map<string, string>) {
  if (!result || typeof result !== "object") {
    return;
  }
  const obj = result as Record<string, unknown>;
  if (typeof obj.path === "string" && mapping.has(obj.path)) {
    obj.path = mapping.get(obj.path);
  }
  if (typeof obj.imagePath === "string" && mapping.has(obj.imagePath)) {
    obj.imagePath = mapping.get(obj.imagePath);
  }
  const download = obj.download;
  if (download && typeof download === "object") {
    const d = download as Record<string, unknown>;
    if (typeof d.path === "string" && mapping.has(d.path)) {
      d.path = mapping.get(d.path);
    }
  }
}

function resolveBrowserBaseUrl(params: {
  target?: "sandbox" | "host";
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): string | undefined {
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const normalizedSandbox = params.sandboxBridgeUrl?.trim() ?? "";
  const target = params.target ?? (normalizedSandbox ? "sandbox" : "host");

  if (target === "sandbox") {
    if (!normalizedSandbox) {
      throw new Error(
        'Sandbox browser is unavailable. Enable agents.defaults.sandbox.browser.enabled or use target="host" if allowed.',
      );
    }
    return normalizedSandbox.replace(/\/$/, "");
  }

  if (params.allowHostControl === false) {
    throw new Error("Host browser control is disabled by sandbox policy.");
  }
  if (!resolved.enabled) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.openclaw/openclaw.json.",
    );
  }
  return undefined;
}

function buildBrowserToolDescription(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}) {
  const targetDefault = opts?.sandboxBridgeUrl ? "sandbox" : "host";
  return [
    "Use the real browser for authenticated, session-bound, or interactive web tasks.",
    "Prefer web_search/web_fetch for public docs, search, or read-only web research.",
    'Profiles: use profile="chrome" for Chrome extension relay takeover (your existing Chrome tabs). Use profile="openclaw" for the isolated openclaw-managed browser.',
    'If the user mentions the Chrome extension / Browser Relay / toolbar button / “attach tab”, ALWAYS use profile="chrome" (do not ask which profile).',
    'When a node-hosted browser proxy is available, the tool may auto-route to it. Pin a node with node=<id|name> or target="node".',
    `Default target: ${targetDefault}.`,
    opts?.allowHostControl === false ? "Host target may be blocked by sandbox policy." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildBrowserOperatorManual(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}) {
  const runtimeLines = [
    `Default target: ${opts?.sandboxBridgeUrl ? "sandbox" : "host"}.`,
    opts?.sandboxBridgeUrl ? "Sandbox target is available in this session." : "",
    opts?.allowHostControl === false ? "Host target is blocked in this session." : "",
  ].filter(Boolean);

  return [
    "Purpose: use the real browser for authenticated, session-bound, or interactive UI work. Prefer `web_search`/`web_fetch` for public docs, search, or read-only web research.",
    "",
    "Workflow:",
    "- Start each browser task by refreshing current context with `action=tabs` or `action=snapshot`.",
    "- Treat `targetId` and snapshot refs as short-lived. After navigation, tab switches, or a new session, refresh before reusing them.",
    "- Keep the same `targetId` from snapshot results when chaining `act` calls on the same tab.",
    '- Prefer `snapshot` with `refs="aria"` when you need refs that survive across multiple calls.',
    "- If you see `tab not found`, `not found or not visible`, or ref/locator errors, refresh with `tabs` or `snapshot` before retrying.",
    "- After 2 consecutive failures in the same browser action family, stop retrying and summarize the blocker plus the best recovery step.",
    '- Avoid `action=dialog` and `request.kind="wait"` unless unavoidable; prefer explicit page-state checks via `snapshot`.',
    "- If a blocking dialog or modal is unavoidable, warn first and include a recovery step.",
    "- Stay on the user's requested task; do not rabbit-hole through unrelated pages or flows.",
    "- If the browser service times out or becomes unreachable, stop and report what you attempted instead of blind retries.",
    "",
    "Profiles & routing:",
    '- If the user mentions the Chrome extension, Browser Relay, toolbar button, or “attach tab”, use `profile="chrome"`.',
    '- `profile="chrome"` needs an attached tab: the user must click the OpenClaw Browser Relay toolbar icon on that tab (badge ON).',
    '- Use `profile="openclaw"` for the isolated OpenClaw-managed browser when you do not need the user\'s existing Chrome session.',
    '- Use `target="node"` or `node="<id|name>"` when the task must run against a paired node-hosted browser.',
    "",
    "Runtime addenda:",
    ...runtimeLines,
  ].join("\n");
}

export function createBrowserTool(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): AnyAgentTool {
  return {
    label: "Browser",
    name: "browser",
    description: buildBrowserToolDescription(opts),
    searchSummary:
      "Use the real browser for interactive/authenticated web work; prefer web_search/web_fetch for public pages.",
    operatorManual: () => buildBrowserOperatorManual(opts),
    invocationContract: {
      usagePolicy: "semantic_ok",
      sideEffectLevel: "medium",
      whenToUse: [
        "The task needs a real browser session, live DOM state, login context, or interactive UI steps.",
        "The user explicitly asks you to drive a browser, inspect a tab, or work through a web flow.",
      ],
      whenNotToUse: [
        "Prefer web_search/web_fetch for public pages, docs, or read-only research that does not need a live browser session.",
        "Do not use it for unrelated exploration outside the requested workflow.",
      ],
      preconditions: [
        "Refresh context with action=tabs or action=snapshot before acting on a page.",
        "Reuse targetId and refs only within the current, freshly inspected page state.",
      ],
      behaviorSummary:
        "Controls OpenClaw's managed browser, host Chrome relay, or a node-hosted browser proxy.",
      parametersSummary: [
        "action: browser operation (status/start/tabs/open/snapshot/screenshot/navigate/act/etc).",
        "profile: browser profile; use chrome for Browser Relay, openclaw for the isolated browser.",
        "target/node: pick sandbox, host, or a specific paired node when needed.",
        "targetId + request.ref: chain actions against the current tab and fresh snapshot refs.",
      ],
    },
    parameters: BrowserToolSchema,
    validateInput: async (input, _context) => {
      const validation = validateFlatActionInput({
        toolName: "browser",
        action: typeof input.action === "string" ? input.action : "",
        input: input as Record<string, unknown>,
        rules: BROWSER_ACTION_RULES,
      });
      if (!validation.result) {
        return validation;
      }
      if (
        typeof input.node === "string" &&
        input.node.trim() &&
        typeof input.target === "string" &&
        input.target.trim() &&
        input.target !== "node"
      ) {
        return {
          result: false,
          errorCode: 400,
          message: 'node is only supported with target="node".',
        };
      }
      if (input.action === "act") {
        const error = validateBrowserActRequest(input.request);
        if (error) {
          return {
            result: false,
            errorCode: 400,
            message: error,
          };
        }
      }
      return { result: true };
    },
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const profile = readStringParam(params, "profile");
      const requestedNode = readStringParam(params, "node");
      let target = readStringParam(params, "target") as "sandbox" | "host" | "node" | undefined;

      if (requestedNode && target && target !== "node") {
        throw new Error('node is only supported with target="node".');
      }

      if (!target && !requestedNode && profile === "chrome") {
        // Chrome extension relay takeover is a host Chrome feature; prefer host unless explicitly targeting a node.
        target = "host";
      }

      const nodeTarget = await resolveBrowserNodeTarget({
        requestedNode: requestedNode ?? undefined,
        target,
        sandboxBridgeUrl: opts?.sandboxBridgeUrl,
      });

      const resolvedTarget = target === "node" ? undefined : target;
      const baseUrl = nodeTarget
        ? undefined
        : resolveBrowserBaseUrl({
            target: resolvedTarget,
            sandboxBridgeUrl: opts?.sandboxBridgeUrl,
            allowHostControl: opts?.allowHostControl,
          });

      const proxyRequest = nodeTarget
        ? async (opts: {
            method: string;
            path: string;
            query?: Record<string, string | number | boolean | undefined>;
            body?: unknown;
            timeoutMs?: number;
            profile?: string;
          }) => {
            const proxy = await callBrowserProxy({
              nodeId: nodeTarget.nodeId,
              method: opts.method,
              path: opts.path,
              query: opts.query,
              body: opts.body,
              timeoutMs: opts.timeoutMs,
              profile: opts.profile,
            });
            const mapping = await persistProxyFiles(proxy.files);
            applyProxyPaths(proxy.result, mapping);
            return proxy.result;
          }
        : null;

      switch (action) {
        case "status":
          if (proxyRequest) {
            return jsonResult(
              await proxyRequest({
                method: "GET",
                path: "/",
                profile,
              }),
            );
          }
          return jsonResult(await browserStatus(baseUrl, { profile }));
        case "start":
          if (proxyRequest) {
            await proxyRequest({
              method: "POST",
              path: "/start",
              profile,
            });
            return jsonResult(
              await proxyRequest({
                method: "GET",
                path: "/",
                profile,
              }),
            );
          }
          await browserStart(baseUrl, { profile });
          return jsonResult(await browserStatus(baseUrl, { profile }));
        case "stop":
          if (proxyRequest) {
            await proxyRequest({
              method: "POST",
              path: "/stop",
              profile,
            });
            return jsonResult(
              await proxyRequest({
                method: "GET",
                path: "/",
                profile,
              }),
            );
          }
          await browserStop(baseUrl, { profile });
          return jsonResult(await browserStatus(baseUrl, { profile }));
        case "profiles":
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "GET",
              path: "/profiles",
            });
            return jsonResult(result);
          }
          return jsonResult({ profiles: await browserProfiles(baseUrl) });
        case "tabs":
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "GET",
              path: "/tabs",
              profile,
            });
            const tabs = (result as { tabs?: unknown[] }).tabs ?? [];
            return jsonResult({ tabs });
          }
          return jsonResult({ tabs: await browserTabs(baseUrl, { profile }) });
        case "open": {
          const targetUrl = readStringParam(params, "targetUrl", {
            required: true,
          });
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/tabs/open",
              profile,
              body: { url: targetUrl },
            });
            return jsonResult(result);
          }
          return jsonResult(await browserOpenTab(baseUrl, targetUrl, { profile }));
        }
        case "focus": {
          const targetId = readStringParam(params, "targetId", {
            required: true,
          });
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/tabs/focus",
              profile,
              body: { targetId },
            });
            return jsonResult(result);
          }
          await browserFocusTab(baseUrl, targetId, { profile });
          return jsonResult({ ok: true });
        }
        case "close": {
          const targetId = readStringParam(params, "targetId");
          if (proxyRequest) {
            const result = targetId
              ? await proxyRequest({
                  method: "DELETE",
                  path: `/tabs/${encodeURIComponent(targetId)}`,
                  profile,
                })
              : await proxyRequest({
                  method: "POST",
                  path: "/act",
                  profile,
                  body: { kind: "close" },
                });
            return jsonResult(result);
          }
          if (targetId) {
            await browserCloseTab(baseUrl, targetId, { profile });
          } else {
            await browserAct(baseUrl, { kind: "close" }, { profile });
          }
          return jsonResult({ ok: true });
        }
        case "snapshot": {
          const snapshotDefaults = loadConfig().browser?.snapshotDefaults;
          const format =
            params.snapshotFormat === "ai" || params.snapshotFormat === "aria"
              ? params.snapshotFormat
              : "ai";
          const mode =
            params.mode === "efficient"
              ? "efficient"
              : format === "ai" && snapshotDefaults?.mode === "efficient"
                ? "efficient"
                : undefined;
          const labels = typeof params.labels === "boolean" ? params.labels : undefined;
          const refs = params.refs === "aria" || params.refs === "role" ? params.refs : undefined;
          const hasMaxChars = Object.hasOwn(params, "maxChars");
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const limit =
            typeof params.limit === "number" && Number.isFinite(params.limit)
              ? params.limit
              : undefined;
          const maxChars =
            typeof params.maxChars === "number" &&
            Number.isFinite(params.maxChars) &&
            params.maxChars > 0
              ? Math.floor(params.maxChars)
              : undefined;
          const resolvedMaxChars =
            format === "ai"
              ? hasMaxChars
                ? maxChars
                : mode === "efficient"
                  ? undefined
                  : DEFAULT_AI_SNAPSHOT_MAX_CHARS
              : undefined;
          const interactive =
            typeof params.interactive === "boolean" ? params.interactive : undefined;
          const compact = typeof params.compact === "boolean" ? params.compact : undefined;
          const depth =
            typeof params.depth === "number" && Number.isFinite(params.depth)
              ? params.depth
              : undefined;
          const selector = typeof params.selector === "string" ? params.selector.trim() : undefined;
          const frame = typeof params.frame === "string" ? params.frame.trim() : undefined;
          const snapshot = proxyRequest
            ? ((await proxyRequest({
                method: "GET",
                path: "/snapshot",
                profile,
                query: {
                  format,
                  targetId,
                  limit,
                  ...(typeof resolvedMaxChars === "number" ? { maxChars: resolvedMaxChars } : {}),
                  refs,
                  interactive,
                  compact,
                  depth,
                  selector,
                  frame,
                  labels,
                  mode,
                },
              })) as Awaited<ReturnType<typeof browserSnapshot>>)
            : await browserSnapshot(baseUrl, {
                format,
                targetId,
                limit,
                ...(typeof resolvedMaxChars === "number" ? { maxChars: resolvedMaxChars } : {}),
                refs,
                interactive,
                compact,
                depth,
                selector,
                frame,
                labels,
                mode,
                profile,
              });
          if (snapshot.format === "ai") {
            if (labels && snapshot.imagePath) {
              return await imageResultFromFile({
                label: "browser:snapshot",
                path: snapshot.imagePath,
                extraText: snapshot.snapshot,
                details: snapshot,
              });
            }
            return {
              content: [{ type: "text", text: snapshot.snapshot }],
              details: snapshot,
            };
          }
          return jsonResult(snapshot);
        }
        case "screenshot": {
          const targetId = readStringParam(params, "targetId");
          const fullPage = Boolean(params.fullPage);
          const ref = readStringParam(params, "ref");
          const element = readStringParam(params, "element");
          const type = params.type === "jpeg" ? "jpeg" : "png";
          const result = proxyRequest
            ? ((await proxyRequest({
                method: "POST",
                path: "/screenshot",
                profile,
                body: {
                  targetId,
                  fullPage,
                  ref,
                  element,
                  type,
                },
              })) as Awaited<ReturnType<typeof browserScreenshotAction>>)
            : await browserScreenshotAction(baseUrl, {
                targetId,
                fullPage,
                ref,
                element,
                type,
                profile,
              });
          return await imageResultFromFile({
            label: "browser:screenshot",
            path: result.path,
            details: result,
          });
        }
        case "navigate": {
          const targetUrl = readStringParam(params, "targetUrl", {
            required: true,
          });
          const targetId = readStringParam(params, "targetId");
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/navigate",
              profile,
              body: {
                url: targetUrl,
                targetId,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(
            await browserNavigate(baseUrl, {
              url: targetUrl,
              targetId,
              profile,
            }),
          );
        }
        case "console": {
          const level = typeof params.level === "string" ? params.level.trim() : undefined;
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "GET",
              path: "/console",
              profile,
              query: {
                level,
                targetId,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(await browserConsoleMessages(baseUrl, { level, targetId, profile }));
        }
        case "pdf": {
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const result = proxyRequest
            ? ((await proxyRequest({
                method: "POST",
                path: "/pdf",
                profile,
                body: { targetId },
              })) as Awaited<ReturnType<typeof browserPdfSave>>)
            : await browserPdfSave(baseUrl, { targetId, profile });
          return {
            content: [{ type: "text", text: `FILE:${result.path}` }],
            details: result,
          };
        }
        case "upload": {
          const paths = Array.isArray(params.paths) ? params.paths.map((p) => String(p)) : [];
          if (paths.length === 0) {
            throw new Error("paths required");
          }
          const ref = readStringParam(params, "ref");
          const inputRef = readStringParam(params, "inputRef");
          const element = readStringParam(params, "element");
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const timeoutMs =
            typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
              ? params.timeoutMs
              : undefined;
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/hooks/file-chooser",
              profile,
              body: {
                paths,
                ref,
                inputRef,
                element,
                targetId,
                timeoutMs,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(
            await browserArmFileChooser(baseUrl, {
              paths,
              ref,
              inputRef,
              element,
              targetId,
              timeoutMs,
              profile,
            }),
          );
        }
        case "dialog": {
          const accept = Boolean(params.accept);
          const promptText = typeof params.promptText === "string" ? params.promptText : undefined;
          const targetId = typeof params.targetId === "string" ? params.targetId.trim() : undefined;
          const timeoutMs =
            typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
              ? params.timeoutMs
              : undefined;
          if (proxyRequest) {
            const result = await proxyRequest({
              method: "POST",
              path: "/hooks/dialog",
              profile,
              body: {
                accept,
                promptText,
                targetId,
                timeoutMs,
              },
            });
            return jsonResult(result);
          }
          return jsonResult(
            await browserArmDialog(baseUrl, {
              accept,
              promptText,
              targetId,
              timeoutMs,
              profile,
            }),
          );
        }
        case "act": {
          const request = params.request as Record<string, unknown> | undefined;
          if (!request || typeof request !== "object") {
            throw new Error("request required");
          }
          try {
            const result = proxyRequest
              ? await proxyRequest({
                  method: "POST",
                  path: "/act",
                  profile,
                  body: request,
                })
              : await browserAct(baseUrl, request as Parameters<typeof browserAct>[1], {
                  profile,
                });
            return jsonResult(result);
          } catch (err) {
            const msg = String(err);
            if (msg.includes("404:") && msg.includes("tab not found") && profile === "chrome") {
              const tabs = proxyRequest
                ? ((
                    (await proxyRequest({
                      method: "GET",
                      path: "/tabs",
                      profile,
                    })) as { tabs?: unknown[] }
                  ).tabs ?? [])
                : await browserTabs(baseUrl, { profile }).catch(() => []);
              if (!tabs.length) {
                throw new Error(
                  "No Chrome tabs are attached via the OpenClaw Browser Relay extension. Click the toolbar icon on the tab you want to control (badge ON), then retry.",
                  { cause: err },
                );
              }
              throw new Error(
                `Chrome tab not found (stale targetId?). Run action=tabs profile="chrome" and use one of the returned targetIds.`,
                { cause: err },
              );
            }
            throw err;
          }
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
