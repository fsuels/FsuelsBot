import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ChannelThreadingToolContext } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { resolveStorePath } from "../../config/sessions.js";
import { runMessageAction } from "../../infra/outbound/message-action-runner.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import {
  buildClarificationPromptId,
  buildClarificationPromptText,
  buildClarificationTelegramButtons,
  buildDefaultClarificationAnswers,
  computeChangedExecutionPath,
  normalizeClarificationQuestions,
  persistClarificationAssumption,
  persistPendingClarification,
  resolveClarificationTransport,
  type ClarificationInput,
} from "../clarification.js";
import {
  defineOpenClawTool,
  toolValidationError,
  toolValidationOk,
} from "../tool-contract.js";

const ClarificationOptionSchema = Type.Object(
  {
    id: Type.String(),
    label: Type.String(),
    description: Type.String(),
    preview: Type.Optional(Type.String()),
    previewFormat: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("html")])),
  },
  { additionalProperties: false },
);

const ClarificationQuestionSchema = Type.Object(
  {
    id: Type.String(),
    header: Type.String(),
    question: Type.String(),
    multiSelect: Type.Optional(Type.Boolean()),
    allowOther: Type.Optional(Type.Boolean()),
    recommendedOptionId: Type.Optional(Type.String()),
    metadata: Type.Optional(
      Type.Object(
        {
          source: Type.Optional(Type.String()),
          reason: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    options: Type.Array(ClarificationOptionSchema),
  },
  { additionalProperties: false },
);

const AskUserQuestionSchema = Type.Object(
  {
    questions: Type.Array(ClarificationQuestionSchema),
  },
  { additionalProperties: false },
);

function buildThreadingToolContext(opts: {
  agentChannel?: GatewayMessageChannel;
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
}): ChannelThreadingToolContext | undefined {
  if (
    !opts.agentChannel &&
    !opts.currentChannelId &&
    !opts.currentThreadTs &&
    !opts.replyToMode &&
    !opts.hasRepliedRef
  ) {
    return undefined;
  }
  return {
    currentChannelProvider:
      opts.agentChannel as ChannelThreadingToolContext["currentChannelProvider"],
    currentChannelId: opts.currentChannelId,
    currentThreadTs: opts.currentThreadTs,
    replyToMode: opts.replyToMode,
    hasRepliedRef: opts.hasRepliedRef,
  };
}

function buildToolResult(params: {
  status: "asked" | "assumed";
  promptId: string;
  promptText: string;
  delivery: ReturnType<typeof resolveClarificationTransport>["delivery"];
  questions: ReturnType<typeof normalizeClarificationQuestions>;
  answers?: ReturnType<typeof buildDefaultClarificationAnswers>;
  message: string;
  error?: string;
}): AgentToolResult<unknown> {
  const payload = {
    status: params.status,
    promptId: params.promptId,
    delivery: params.delivery,
    promptText: params.promptText,
    questions: params.questions,
    ...(params.answers ? { answers: params.answers } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
  return {
    content: [{ type: "text", text: params.message }],
    details: payload,
  };
}

export function createAskUserQuestionTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  currentChannelId?: string;
  currentThreadTs?: string;
  replyToMode?: "off" | "first" | "all";
  hasRepliedRef?: { value: boolean };
  config?: OpenClawConfig;
}) {
  return defineOpenClawTool({
    name: "ask_user_question",
    label: "Ask User",
    description:
      "Ask a bounded structured clarification question when a real user choice is needed before continuing.",
    parameters: AskUserQuestionSchema,
    inputSchema: AskUserQuestionSchema,
    operatorManual: () =>
      [
        "Purpose: collect structured clarification only when ambiguity would materially change the work.",
        "Use stable question/option ids. Keep it to 1-2 questions unless there is a strong reason.",
        "Do not use this for plan approval. If you call it and the tool reports `status: asked`, stop and wait for the user's reply.",
      ].join("\n"),
    isConcurrencySafe: () => true,
    validateInput: async (input) => {
      try {
        normalizeClarificationQuestions(input as ClarificationInput);
        return toolValidationOk();
      } catch (error) {
        return toolValidationError({
          code: "invalid_input",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    execute: async (_toolCallId, args) => {
      const sessionKey = opts?.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new Error("ask_user_question requires an active session.");
      }
      const config = opts?.config;
      if (!config) {
        throw new Error("ask_user_question requires runtime config.");
      }

      const questions = normalizeClarificationQuestions(args as ClarificationInput);
      const promptId = buildClarificationPromptId();
      const transportDecision = resolveClarificationTransport({
        sessionKey,
        channel: opts.agentChannel,
        target: opts.agentTo,
        questions,
      });
      const promptText = buildClarificationPromptText({
        promptId,
        questions,
        transport: transportDecision.delivery.transport,
      });
      const storePath = resolveStorePath(config.session?.store, {
        agentId: resolveAgentIdFromSessionKey(sessionKey),
      });

      if (transportDecision.delivery.transport === "assumption") {
        const answers = buildDefaultClarificationAnswers(questions);
        await persistClarificationAssumption({
          storePath,
          sessionKey,
          promptId,
          questions,
          delivery: transportDecision.delivery,
          changedExecutionPath: computeChangedExecutionPath({ questions, answers }),
        });
        return buildToolResult({
          status: "assumed",
          promptId,
          promptText,
          delivery: transportDecision.delivery,
          questions,
          answers,
          message:
            "Clarification fallback used because this session is non-interactive. Continuing with the safest default assumption.",
        });
      }

      if (
        transportDecision.delivery.transport === "plain_text" ||
        transportDecision.delivery.transport === "telegram_buttons"
      ) {
        try {
          await runMessageAction({
            cfg: config,
            action: "send",
            params: {
              to: opts.agentTo,
              message: promptText,
              ...(opts.agentThreadId != null ? { threadId: String(opts.agentThreadId) } : {}),
              ...(transportDecision.canUseTelegramButtons
                ? {
                    buttons: buildClarificationTelegramButtons({
                      promptId,
                      askedAt: Date.now(),
                      promptText,
                      delivery: transportDecision.delivery,
                      questions,
                    }),
                  }
                : {}),
            },
            defaultAccountId: opts.agentAccountId,
            toolContext: buildThreadingToolContext({
              agentChannel: opts.agentChannel,
              currentChannelId: opts.currentChannelId,
              currentThreadTs: opts.currentThreadTs,
              replyToMode: opts.replyToMode,
              hasRepliedRef: opts.hasRepliedRef,
            }),
          });
        } catch (error) {
          const answers = buildDefaultClarificationAnswers(questions);
          const assumptionDelivery = {
            ...transportDecision.delivery,
            transport: "assumption" as const,
            interactiveUi: false,
            fallbackUsed: true,
          };
          await persistClarificationAssumption({
            storePath,
            sessionKey,
            promptId,
            questions,
            delivery: assumptionDelivery,
            changedExecutionPath: computeChangedExecutionPath({ questions, answers }),
          });
          return buildToolResult({
            status: "assumed",
            promptId,
            promptText,
            delivery: assumptionDelivery,
            questions,
            answers,
            message:
              "Clarification could not be delivered interactively, so the tool recorded the safest default assumption and continued.",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const pending = {
        promptId,
        askedAt: Date.now(),
        promptText,
        delivery: transportDecision.delivery,
        questions,
      };
      await persistPendingClarification({
        storePath,
        sessionKey,
        pending,
      });

      return buildToolResult({
        status: "asked",
        promptId,
        promptText,
        delivery: transportDecision.delivery,
        questions,
        message:
          transportDecision.delivery.transport === "tool_result"
            ? promptText
            : "Clarification prompt sent. Wait for the user's reply before continuing.",
      });
    },
  });
}
