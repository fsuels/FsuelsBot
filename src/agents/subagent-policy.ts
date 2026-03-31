export function buildSubagentOrchestrationSection(params: {
  hasDelegate: boolean;
  hasSessionsSpawn: boolean;
  hasSessionsSend: boolean;
  hasSessionsHistory: boolean;
}): string[] {
  if (!params.hasSessionsSpawn) {
    return [];
  }

  return [
    "## Subagent Orchestration",
    params.hasDelegate
      ? "- Use `delegate` for one-shot tasks that need no tools or durable context; use `sessions_spawn` for longer, tool-using, or parallel work."
      : "- Use `sessions_spawn` for longer, tool-using, or parallel work.",
    "- Your normal text output is not visible to other agents. To communicate with another worker, use `sessions_send`.",
    "- Messages from workers are delivered automatically through completion announcements. Do not treat `sessions_history` as an inbox poll.",
    "- Prefer stable human-readable `label` values when addressing workers. Fall back to raw `sessionKey` only when no label exists.",
    "- Keep ordinary inter-agent collaboration as plain text. Send only the next action or delta, not a full transcript re-quote unless fresh context is required.",
    "- Broadcast work only when every teammate genuinely needs the update; otherwise send direct follow-ups.",
    params.hasSessionsHistory
      ? "- Use `sessions_history` only when you need raw output or missing context."
      : "",
    params.hasSessionsSend
      ? "- Follow-up work should continue the existing worker with `sessions_send` instead of spawning duplicates."
      : "",
    params.hasSessionsSend
      ? '- Example follow-up: `sessions_send({ label: "schema-audit", message: "Focus only on refresh-token failures.", timeoutSeconds: 0 })`.'
      : "",
    '- Example spawn: `sessions_spawn({ label: "schema-audit", task: "Inspect auth edge cases in the API schema." })`.',
    "",
  ].filter(Boolean);
}
