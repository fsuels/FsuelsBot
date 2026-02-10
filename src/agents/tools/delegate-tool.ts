import { Type } from "@sinclair/typebox";
import { completeSimple, type TextContent } from "@mariozechner/pi-ai";

import type { MoltbotConfig } from "../../config/config.js";
import { getApiKeyForModel, requireApiKey } from "../model-auth.js";
import { resolveModel } from "../pi-embedded-runner/model.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const DEFAULT_DELEGATE_MODEL = "anthropic/claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 30_000;

const DelegateToolSchema = Type.Object({
  task: Type.String({
    description:
      "The prompt/task to send to the delegate model. Include all necessary context inline — " +
      "the delegate has NO conversation history and NO tools.",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Override delegate model (provider/model, e.g. 'anthropic/claude-sonnet-4-5'). " +
        "Uses configured default if omitted.",
    }),
  ),
  maxTokens: Type.Optional(
    Type.Number({
      description: "Max output tokens for the delegate response.",
      minimum: 1,
      maximum: 16384,
    }),
  ),
  systemPrompt: Type.Optional(
    Type.String({
      description: "Optional system prompt for the delegate (e.g. role-specific instructions).",
    }),
  ),
});

function splitModelRef(ref: string): { provider: string; model: string } {
  const trimmed = ref.trim();
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0) {
    return { provider: trimmed.slice(0, slashIdx), model: trimmed.slice(slashIdx + 1) };
  }
  return { provider: "anthropic", model: trimmed };
}

function isTextContent(block: { type: string }): block is TextContent {
  return block.type === "text";
}

export function createDelegateTool(opts?: {
  config?: MoltbotConfig;
  agentDir?: string;
}): AnyAgentTool {
  const cfg = opts?.config;
  const delegateCfg = cfg?.agents?.defaults?.delegate;

  return {
    name: "delegate",
    label: "Delegate",
    description:
      "MANDATORY ROUTING: You MUST use this tool for these task types instead of answering directly: " +
      "translation, summarization, formatting/reformatting, data extraction, simple factual Q&A, " +
      "list generation, code explanation, grammar correction, format conversion, and boilerplate text. " +
      "This delegates to a faster, cheaper model (Sonnet) and returns the result inline. " +
      "Only answer directly when the task requires YOUR judgment, multi-step reasoning, tool use, or conversation context. " +
      "The delegate has NO tools and NO history — include all context in the task field. " +
      "Relay the result naturally to the user without mentioning delegation.",
    parameters: DelegateToolSchema,
    execute: async (_toolCallId, rawParams, signal) => {
      const params = rawParams as Record<string, unknown>;
      const startTime = Date.now();

      try {
        const task = readStringParam(params, "task", { required: true });
        const modelParam = readStringParam(params, "model");
        const maxTokensParam = readNumberParam(params, "maxTokens", { integer: true });
        const systemPromptParam = readStringParam(params, "systemPrompt");

        const modelRef = modelParam ?? delegateCfg?.model ?? DEFAULT_DELEGATE_MODEL;
        const { provider, model: modelId } = splitModelRef(modelRef);
        const maxTokens = maxTokensParam ?? delegateCfg?.maxTokens ?? DEFAULT_MAX_TOKENS;
        const temperature = delegateCfg?.temperature ?? DEFAULT_TEMPERATURE;
        const timeoutMs = delegateCfg?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        const resolved = resolveModel(provider, modelId, opts?.agentDir, cfg);
        if (!resolved.model) {
          return jsonResult({
            status: "error",
            error: resolved.error ?? `Unknown model: ${provider}/${modelId}`,
          });
        }

        const auth = await getApiKeyForModel({
          model: resolved.model,
          cfg,
          agentDir: opts?.agentDir,
        });
        const apiKey = requireApiKey(auth, provider);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        // Chain parent signal if available
        if (signal?.aborted) {
          controller.abort();
        } else {
          signal?.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
          const res = await completeSimple(
            resolved.model,
            {
              ...(systemPromptParam ? { systemPrompt: systemPromptParam } : {}),
              messages: [
                {
                  role: "user" as const,
                  content: task,
                  timestamp: Date.now(),
                },
              ],
            },
            {
              apiKey,
              maxTokens,
              temperature,
              signal: controller.signal,
            },
          );

          const text = res.content
            .filter(isTextContent)
            .map((block) => block.text.trim())
            .filter(Boolean)
            .join("\n\n")
            .trim();

          if (!text) {
            return jsonResult({
              status: "error",
              error: "Delegate model returned no text content",
              model: `${provider}/${modelId}`,
              latencyMs: Date.now() - startTime,
            });
          }

          return jsonResult({
            status: "ok",
            model: `${provider}/${modelId}`,
            text,
            usage: {
              inputTokens: (res as { usage?: { input?: number } }).usage?.input,
              outputTokens: (res as { usage?: { output?: number } }).usage?.output,
            },
            latencyMs: Date.now() - startTime,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        const error = err as Error;
        const isAbort = error.name === "AbortError";
        return jsonResult({
          status: "error",
          error: isAbort ? "Delegate call timed out" : error.message,
          latencyMs: Date.now() - startTime,
        });
      }
    },
  };
}
