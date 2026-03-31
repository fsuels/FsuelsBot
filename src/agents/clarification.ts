import { parseHTML } from "linkedom";
import crypto from "node:crypto";
import {
  updateSessionStoreEntry,
  type SessionClarificationAnswer,
  type SessionClarificationDelivery,
  type SessionClarificationPending,
  type SessionClarificationQuestion,
  type SessionClarificationTelemetry,
} from "../config/sessions.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { htmlToMarkdown, markdownToText } from "./tools/web-fetch-utils.js";

export type ClarificationPreviewInputFormat = "markdown" | "html";

export type ClarificationOptionInput = {
  id: string;
  label: string;
  description: string;
  preview?: string;
  previewFormat?: ClarificationPreviewInputFormat;
};

export type ClarificationQuestionInput = {
  id: string;
  header: string;
  question: string;
  multiSelect?: boolean;
  allowOther?: boolean;
  recommendedOptionId?: string;
  metadata?: {
    source?: string;
    reason?: string;
  };
  options: ClarificationOptionInput[];
};

export type ClarificationInput = {
  questions: ClarificationQuestionInput[];
};

export type ClarificationResolution =
  | {
      kind: "answered";
      answers: SessionClarificationAnswer[];
    }
  | {
      kind: "declined";
      notes?: string;
    };

export type ClarificationTransportDecision = {
  delivery: SessionClarificationDelivery;
  canUseTelegramButtons: boolean;
};

const DECLINE_PATTERNS = new Set([
  "decline",
  "skip",
  "cancel",
  "you decide",
  "your call",
  "no preference",
]);
const UNSAFE_URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_URI_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const STRIP_ELEMENT_NAMES = new Set(["script", "style", "iframe", "object", "embed", "noscript"]);
const BLOCKED_FRAGMENT_TAGS = new Set(["html", "body", "head"]);
const CALLBACK_PREFIX = "clarify";

type MatchSelectionResult = {
  selectedOptionIds: string[];
  selectedPreview?: string;
};

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function looksDeclined(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return DECLINE_PATTERNS.has(normalized);
}

function extractQuestionMetadata(
  questions: SessionClarificationQuestion[],
): Pick<SessionClarificationTelemetry, "source" | "reason"> {
  const sources = unique(
    questions.map((question) => question.metadata?.source?.trim()).filter(Boolean) as string[],
  );
  const reasons = unique(
    questions.map((question) => question.metadata?.reason?.trim()).filter(Boolean) as string[],
  );
  return {
    source: sources.length === 1 ? sources[0] : undefined,
    reason: reasons.length === 1 ? reasons[0] : undefined,
  };
}

function normalizePreviewText(value: string): string | undefined {
  const trimmed = normalizeWhitespace(value);
  return trimmed || undefined;
}

function sanitizeHtmlPreview(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  const { document } = parseHTML(`<div id="clarification-root">${trimmed}</div>`);
  const root = document.getElementById("clarification-root");
  if (!root) {
    throw new Error("HTML preview must be a valid fragment.");
  }

  const disallowedFragmentNode = Array.from(root.querySelectorAll("html, body, head")).find(
    Boolean,
  );
  if (disallowedFragmentNode) {
    throw new Error("HTML previews must be fragments, not full HTML documents.");
  }

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }
    const element = node as {
      nodeType?: number;
      localName?: string;
      attributes?: Array<{ name: string; value: string }>;
      childNodes?: unknown[];
      parentNode?: { removeChild?: (child: unknown) => void };
      removeAttribute?: (name: string) => void;
      remove?: () => void;
    };
    if (element.nodeType !== 1) {
      for (const child of element.childNodes ?? []) {
        walk(child);
      }
      return;
    }
    const tagName = (element.localName ?? "").toLowerCase();
    if (BLOCKED_FRAGMENT_TAGS.has(tagName)) {
      throw new Error("HTML previews must be fragments, not full HTML documents.");
    }
    if (STRIP_ELEMENT_NAMES.has(tagName)) {
      if (typeof element.remove === "function") {
        element.remove();
      } else {
        element.parentNode?.removeChild?.(element);
      }
      return;
    }
    for (const attr of Array.from(element.attributes ?? [])) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute?.(attr.name);
        continue;
      }
      if (name === "href" || name === "src") {
        const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*):/i);
        if (schemeMatch) {
          const scheme = schemeMatch[1]?.toLowerCase() ?? "";
          if (!SAFE_URI_SCHEMES.has(scheme)) {
            element.removeAttribute?.(attr.name);
            continue;
          }
        } else if (UNSAFE_URI_SCHEME_RE.test(value)) {
          element.removeAttribute?.(attr.name);
          continue;
        }
      }
      if (name === "style") {
        element.removeAttribute?.(attr.name);
      }
    }
    for (const child of Array.from(element.childNodes ?? [])) {
      walk(child);
    }
  };

  walk(root);
  const sanitized = root.innerHTML ?? "";
  return normalizeWhitespace(htmlToMarkdown(sanitized).text);
}

export function buildClarificationPromptId(): string {
  return crypto.randomBytes(4).toString("hex");
}

export function normalizeClarificationQuestions(
  input: ClarificationInput,
): SessionClarificationQuestion[] {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  if (rawQuestions.length < 1 || rawQuestions.length > 4) {
    throw new Error("ask_user_question requires between 1 and 4 questions.");
  }

  const seenQuestionIds = new Set<string>();
  return rawQuestions.map((rawQuestion, questionIndex) => {
    const id = trimOptional(rawQuestion.id);
    const header = trimOptional(rawQuestion.header);
    const question = trimOptional(rawQuestion.question);
    if (!id) {
      throw new Error(`Question ${questionIndex + 1} is missing id.`);
    }
    if (seenQuestionIds.has(id)) {
      throw new Error(`Duplicate question id "${id}".`);
    }
    seenQuestionIds.add(id);
    if (!header) {
      throw new Error(`Question "${id}" is missing header.`);
    }
    if (!question) {
      throw new Error(`Question "${id}" is missing question text.`);
    }
    if (!question.endsWith("?")) {
      throw new Error(`Question "${id}" must end with "?".`);
    }

    const rawOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : [];
    if (rawOptions.length < 2 || rawOptions.length > 4) {
      throw new Error(`Question "${id}" must have between 2 and 4 options.`);
    }

    const multiSelect = rawQuestion.multiSelect === true;
    const seenOptionIds = new Set<string>();
    const seenOptionLabels = new Set<string>();
    const options = rawOptions.map((rawOption, optionIndex) => {
      const optionId = trimOptional(rawOption.id);
      const label = trimOptional(rawOption.label);
      const description = trimOptional(rawOption.description);
      if (!optionId) {
        throw new Error(`Question "${id}" option ${optionIndex + 1} is missing id.`);
      }
      if (seenOptionIds.has(optionId)) {
        throw new Error(`Question "${id}" has duplicate option id "${optionId}".`);
      }
      seenOptionIds.add(optionId);
      if (!label) {
        throw new Error(`Question "${id}" option "${optionId}" is missing label.`);
      }
      const labelKey = label.toLowerCase();
      if (seenOptionLabels.has(labelKey)) {
        throw new Error(`Question "${id}" has duplicate option label "${label}".`);
      }
      seenOptionLabels.add(labelKey);
      if (!description) {
        throw new Error(`Question "${id}" option "${optionId}" is missing description.`);
      }
      if (multiSelect && rawOption.preview) {
        throw new Error(`Question "${id}" cannot use previews with multiSelect=true.`);
      }
      const previewRaw = trimOptional(rawOption.preview);
      let preview = previewRaw;
      if (previewRaw) {
        const format = rawOption.previewFormat === "html" ? "html" : "markdown";
        preview =
          format === "html" ? sanitizeHtmlPreview(previewRaw) : normalizePreviewText(previewRaw);
      }
      return {
        id: optionId,
        label,
        description,
        preview,
        ...(preview ? { previewFormat: "markdown" as const } : {}),
      };
    });

    const recommendedOptionId = trimOptional(rawQuestion.recommendedOptionId);
    if (recommendedOptionId && !options.some((option) => option.id === recommendedOptionId)) {
      throw new Error(
        `Question "${id}" recommendedOptionId "${recommendedOptionId}" does not match an option.`,
      );
    }

    return {
      id,
      header,
      question,
      multiSelect,
      allowOther: rawQuestion.allowOther !== false,
      recommendedOptionId,
      metadata:
        rawQuestion.metadata &&
        (trimOptional(rawQuestion.metadata.source) || trimOptional(rawQuestion.metadata.reason))
          ? {
              ...(trimOptional(rawQuestion.metadata.source)
                ? { source: trimOptional(rawQuestion.metadata.source) }
                : {}),
              ...(trimOptional(rawQuestion.metadata.reason)
                ? { reason: trimOptional(rawQuestion.metadata.reason) }
                : {}),
            }
          : undefined,
      options,
    };
  });
}

export function resolveClarificationTransport(params: {
  sessionKey?: string;
  channel?: string;
  target?: string;
  questions: SessionClarificationQuestion[];
}): ClarificationTransportDecision {
  const normalizedChannel = normalizeMessageChannel(params.channel);
  const sessionKey = params.sessionKey?.trim() ?? "";
  const isNonInteractive =
    sessionKey.startsWith("cron:") ||
    sessionKey.includes(":cron:") ||
    sessionKey.startsWith("hook:") ||
    sessionKey.includes(":hook:");
  if (isNonInteractive) {
    return {
      delivery: {
        transport: "assumption",
        channel: normalizedChannel,
        target: params.target,
        interactiveUi: false,
        fallbackUsed: true,
      },
      canUseTelegramButtons: false,
    };
  }

  const canUseTelegramButtons =
    normalizedChannel === "telegram" &&
    !!params.target &&
    params.questions.length === 1 &&
    !params.questions[0]?.multiSelect;

  if (canUseTelegramButtons) {
    return {
      delivery: {
        transport: "telegram_buttons",
        channel: normalizedChannel,
        target: params.target,
        interactiveUi: true,
        fallbackUsed: false,
      },
      canUseTelegramButtons: true,
    };
  }

  if (normalizedChannel && params.target) {
    return {
      delivery: {
        transport: "plain_text",
        channel: normalizedChannel,
        target: params.target,
        interactiveUi: false,
        fallbackUsed: false,
      },
      canUseTelegramButtons: false,
    };
  }

  return {
    delivery: {
      transport: "tool_result",
      channel: normalizedChannel,
      target: params.target,
      interactiveUi: true,
      fallbackUsed: true,
    },
    canUseTelegramButtons: false,
  };
}

function buildQuestionOptionLine(
  question: SessionClarificationQuestion,
  optionIndex: number,
): string {
  const option = question.options[optionIndex];
  const recommended = option.id === question.recommendedOptionId ? " [recommended]" : "";
  return `${optionIndex + 1}. ${option.label}${recommended}: ${option.description}`;
}

export function buildClarificationPromptText(params: {
  promptId: string;
  questions: SessionClarificationQuestion[];
  transport: SessionClarificationDelivery["transport"];
}): string {
  const lines = ["I need a quick clarification so I don't guess.", ""];
  params.questions.forEach((question, questionIndex) => {
    lines.push(`${question.header}: ${question.question}`);
    question.options.forEach((_option, optionIndex) => {
      lines.push(buildQuestionOptionLine(question, optionIndex));
    });
    lines.push("");
    if (params.questions.length === 1) {
      if (question.multiSelect) {
        lines.push("Reply with the option numbers or ids separated by commas.");
      } else {
        lines.push("Reply with the option number or id.");
      }
      if (question.allowOther) {
        lines.push("If none fit, reply with `other: ...`.");
      }
      lines.push("Reply `decline` if you want me to choose the safest default.");
      lines.push("");
      return;
    }
    const answerExample = question.multiSelect ? "1,2" : "1";
    lines.push(`Reply using \`q${questionIndex + 1}: ${answerExample}\`.`);
    if (question.allowOther) {
      lines.push(`Use \`q${questionIndex + 1}: other: ...\` if needed.`);
    }
    lines.push("");
  });
  if (params.questions.length > 1) {
    lines.push("Reply `decline` if you want me to choose the safest defaults.");
    lines.push("You can add `notes: ...` on a separate line.");
    lines.push("");
  }
  lines.push(`Reference id: ${params.promptId}`);
  return lines.join("\n").trim();
}

export function buildClarificationTelegramButtons(
  pending: SessionClarificationPending,
): Array<Array<{ text: string; callback_data: string }>> {
  const question = pending.questions[0];
  if (!question || question.multiSelect) {
    return [];
  }
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let index = 0; index < question.options.length; index += 2) {
    const row = question.options.slice(index, index + 2).map((option, optionIndex) => ({
      text: option.label,
      callback_data: `${CALLBACK_PREFIX}:${pending.promptId}:0:${index + optionIndex}`,
    }));
    rows.push(row);
  }
  return rows;
}

function parseSelectionTokens(
  rawValue: string,
  question: SessionClarificationQuestion,
): MatchSelectionResult | null {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) {
    return null;
  }
  const tokens = normalizedValue
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const matches = tokens.map((token) => {
    const lower = token.toLowerCase();
    const byIndex = Number.parseInt(lower, 10);
    if (Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= question.options.length) {
      return question.options[byIndex - 1];
    }
    return question.options.find(
      (option) => option.id.toLowerCase() === lower || option.label.toLowerCase() === lower,
    );
  });
  if (matches.some((option) => !option)) {
    return null;
  }
  const selected = unique(matches.map((option) => option!.id));
  if (!question.multiSelect && selected.length !== 1) {
    return null;
  }
  const first = matches[0];
  return {
    selectedOptionIds: selected,
    selectedPreview:
      !question.multiSelect && first?.preview
        ? markdownToText(first.preview) || first.preview
        : undefined,
  };
}

function parseSingleQuestionResponse(
  question: SessionClarificationQuestion,
  rawText: string,
): ClarificationResolution | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }
  if (looksDeclined(text)) {
    return { kind: "declined" };
  }
  const callbackMatch = text.match(/^clarify:([a-f0-9]+):(\d+):(\d+)$/i);
  if (callbackMatch) {
    return null;
  }
  const explicitOther = text.match(/^other:\s*(.+)$/i);
  if (explicitOther && question.allowOther) {
    return {
      kind: "answered",
      answers: [
        {
          questionId: question.id,
          selectedOptionIds: [],
          otherText: explicitOther[1]?.trim(),
        },
      ],
    };
  }
  const explicitNotes = text.match(/^notes:\s*(.+)$/i);
  if (explicitNotes) {
    return {
      kind: "answered",
      answers: [
        {
          questionId: question.id,
          selectedOptionIds: [],
          notes: explicitNotes[1]?.trim(),
        },
      ],
    };
  }
  const matched = parseSelectionTokens(text, question);
  if (matched) {
    return {
      kind: "answered",
      answers: [
        {
          questionId: question.id,
          selectedOptionIds: matched.selectedOptionIds,
          selectedPreview: matched.selectedPreview,
        },
      ],
    };
  }
  return null;
}

function parseMultiQuestionResponse(
  questions: SessionClarificationQuestion[],
  rawText: string,
): ClarificationResolution | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }
  if (looksDeclined(text)) {
    return { kind: "declined" };
  }
  const segmentMap = new Map<string, string>();
  const lines = text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  let notes: string | undefined;
  for (const line of lines) {
    const notesMatch = line.match(/^notes:\s*(.+)$/i);
    if (notesMatch) {
      notes = notesMatch[1]?.trim() || notes;
      continue;
    }
    const match = line.match(/^([a-z0-9_-]+)\s*:\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim();
    if (!key || !value) {
      continue;
    }
    segmentMap.set(key, value);
  }

  const answers: SessionClarificationAnswer[] = [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const questionKeys = [`q${index + 1}`, question.id.toLowerCase()];
    const segment = questionKeys.map((key) => segmentMap.get(key)).find(Boolean);
    if (!segment) {
      return null;
    }
    const otherMatch = segment.match(/^other:\s*(.+)$/i);
    if (otherMatch) {
      if (!question.allowOther) {
        return null;
      }
      answers.push({
        questionId: question.id,
        selectedOptionIds: [],
        otherText: otherMatch[1]?.trim(),
        ...(index === 0 && notes ? { notes } : {}),
      });
      continue;
    }
    const matched = parseSelectionTokens(segment, question);
    if (!matched) {
      return null;
    }
    answers.push({
      questionId: question.id,
      selectedOptionIds: matched.selectedOptionIds,
      selectedPreview: matched.selectedPreview,
      ...(index === 0 && notes ? { notes } : {}),
    });
  }

  return {
    kind: "answered",
    answers,
  };
}

export function parseClarificationResponse(params: {
  pending: SessionClarificationPending;
  message: string;
}): ClarificationResolution | null {
  const text = params.message.trim();
  if (!text) {
    return null;
  }
  const callbackMatch = text.match(/^clarify:([a-f0-9]+):(\d+):(\d+)$/i);
  if (callbackMatch) {
    const [, promptId, rawQuestionIndex, rawOptionIndex] = callbackMatch;
    if (promptId !== params.pending.promptId) {
      return null;
    }
    const questionIndex = Number.parseInt(rawQuestionIndex ?? "", 10);
    const optionIndex = Number.parseInt(rawOptionIndex ?? "", 10);
    const question = params.pending.questions[questionIndex];
    const option = question?.options[optionIndex];
    if (!question || !option || question.multiSelect) {
      return null;
    }
    return {
      kind: "answered",
      answers: [
        {
          questionId: question.id,
          selectedOptionIds: [option.id],
          selectedPreview: option.preview
            ? markdownToText(option.preview) || option.preview
            : undefined,
        },
      ],
    };
  }

  if (params.pending.questions.length === 1) {
    return parseSingleQuestionResponse(params.pending.questions[0], text);
  }
  return parseMultiQuestionResponse(params.pending.questions, text);
}

export function buildDefaultClarificationAnswers(
  questions: SessionClarificationQuestion[],
): SessionClarificationAnswer[] {
  return questions.map((question) => {
    const selected = question.recommendedOptionId ?? question.options[0]?.id;
    const option = question.options.find((entry) => entry.id === selected) ?? question.options[0];
    return {
      questionId: question.id,
      selectedOptionIds: option ? [option.id] : [],
      ...(option?.preview
        ? { selectedPreview: markdownToText(option.preview) || option.preview }
        : {}),
    };
  });
}

export function computeChangedExecutionPath(params: {
  questions: SessionClarificationQuestion[];
  answers: SessionClarificationAnswer[];
}): boolean {
  const answerByQuestionId = new Map(params.answers.map((answer) => [answer.questionId, answer]));
  return params.questions.some((question) => {
    if (!question.recommendedOptionId) {
      return false;
    }
    const answer = answerByQuestionId.get(question.id);
    if (!answer) {
      return false;
    }
    return !answer.selectedOptionIds.includes(question.recommendedOptionId);
  });
}

export function buildClarificationModelInjection(params: {
  pending: SessionClarificationPending;
  resolution: ClarificationResolution;
}): { json: string; summary: string } {
  const payload = {
    type: "ask_user_question_result",
    promptId: params.pending.promptId,
    askedAt: params.pending.askedAt,
    status: params.resolution.kind === "declined" ? "declined" : "answered",
    questions: params.pending.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      recommendedOptionId: question.recommendedOptionId,
    })),
    ...(params.resolution.kind === "answered"
      ? { answers: params.resolution.answers }
      : { answers: [] }),
    ...(params.resolution.kind === "declined" && params.resolution.notes
      ? { notes: params.resolution.notes }
      : {}),
  };

  const summary =
    params.resolution.kind === "answered"
      ? "Structured clarification answers received."
      : "The user declined the clarification and asked for the safest default.";
  return {
    json: JSON.stringify(payload, null, 2),
    summary,
  };
}

export async function persistPendingClarification(params: {
  storePath: string;
  sessionKey: string;
  pending: SessionClarificationPending;
}): Promise<void> {
  const telemetryBase = extractQuestionMetadata(params.pending.questions);
  await updateSessionStoreEntry({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: async (entry) => ({
      pendingClarification: params.pending,
      clarificationTelemetry: [
        ...(entry.clarificationTelemetry ?? []),
        {
          promptId: params.pending.promptId,
          status: "asked",
          recordedAt: Date.now(),
          ...telemetryBase,
          channel: params.pending.delivery.channel,
          transport: params.pending.delivery.transport,
          interactiveUi: params.pending.delivery.interactiveUi,
          fallbackUsed: params.pending.delivery.fallbackUsed,
        } satisfies SessionClarificationTelemetry,
      ],
    }),
  });
}

export async function persistClarificationAssumption(params: {
  storePath: string;
  sessionKey: string;
  promptId: string;
  questions: SessionClarificationQuestion[];
  delivery: SessionClarificationDelivery;
  changedExecutionPath: boolean;
}): Promise<void> {
  const telemetryBase = extractQuestionMetadata(params.questions);
  await updateSessionStoreEntry({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: async (entry) => ({
      clarificationTelemetry: [
        ...(entry.clarificationTelemetry ?? []),
        {
          promptId: params.promptId,
          status: "assumed",
          recordedAt: Date.now(),
          ...telemetryBase,
          channel: params.delivery.channel,
          transport: params.delivery.transport,
          interactiveUi: params.delivery.interactiveUi,
          fallbackUsed: params.delivery.fallbackUsed,
          changedExecutionPath: params.changedExecutionPath,
        } satisfies SessionClarificationTelemetry,
      ],
    }),
  });
}

export async function resolvePendingClarification(params: {
  storePath: string;
  sessionKey: string;
  pending: SessionClarificationPending;
  resolution: ClarificationResolution;
}): Promise<void> {
  const telemetryBase = extractQuestionMetadata(params.pending.questions);
  await updateSessionStoreEntry({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: async (entry) => ({
      pendingClarification: undefined,
      clarificationTelemetry: [
        ...(entry.clarificationTelemetry ?? []),
        {
          promptId: params.pending.promptId,
          status: params.resolution.kind === "declined" ? "declined" : "answered",
          recordedAt: Date.now(),
          ...telemetryBase,
          channel: params.pending.delivery.channel,
          transport: params.pending.delivery.transport,
          interactiveUi: params.pending.delivery.interactiveUi,
          fallbackUsed: params.pending.delivery.fallbackUsed,
          timeToAnswerMs: Math.max(0, Date.now() - params.pending.askedAt),
          changedExecutionPath:
            params.resolution.kind === "answered"
              ? computeChangedExecutionPath({
                  questions: params.pending.questions,
                  answers: params.resolution.answers,
                })
              : false,
        } satisfies SessionClarificationTelemetry,
      ],
    }),
  });
}
