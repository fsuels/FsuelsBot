import type { SessionEntry } from "../../config/sessions/types.js";
import { DEFAULT_SESSION_TASK_ID } from "../../sessions/task-context.js";

export type InferredTaskHint = {
  taskId: string;
  score: number;
};

function tokenizeTaskHintText(value: string): string[] {
  return (
    value
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 3) ?? []
  );
}

export function inferTaskHintFromMessage(params: {
  entry?: SessionEntry;
  message: string;
}): InferredTaskHint | null {
  const taskMap = params.entry?.taskStateById;
  if (!taskMap) return null;
  const messageText = params.message.trim();
  if (!messageText) return null;
  const messageLower = messageText.toLowerCase();
  const messageTokens = new Set(tokenizeTaskHintText(messageText));
  if (messageTokens.size === 0) return null;

  let best: InferredTaskHint | null = null;
  for (const [taskId, state] of Object.entries(taskMap)) {
    if (!taskId || taskId === DEFAULT_SESSION_TASK_ID) continue;
    if (state?.status === "completed" || state?.status === "archived") continue;
    const candidateTokens = tokenizeTaskHintText(`${taskId} ${state?.title ?? ""}`);
    if (candidateTokens.length === 0) continue;
    let matches = 0;
    for (const token of candidateTokens) {
      if (messageTokens.has(token)) matches += 1;
    }
    let score = matches / candidateTokens.length;
    if (messageLower.includes(taskId.toLowerCase())) {
      score += 0.35;
    }
    if (!best || score > best.score) {
      best = { taskId, score };
    }
  }

  if (!best || best.score < 0.6) return null;
  return best;
}
