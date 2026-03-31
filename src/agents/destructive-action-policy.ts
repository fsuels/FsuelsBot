export type DestroyVerification = {
  status: "safe" | "unsafe" | "unknown";
  pending_changes?: number;
  pending_commits?: number;
  blockers?: string[];
};

export function buildDestroyRefusalMessage(params: {
  actionLabel: string;
  targetLabel: string;
  verification: DestroyVerification;
  overrideFlag: string;
  safeNextStep: string;
}) {
  const lines: string[] = [];
  if (params.verification.status === "unsafe") {
    lines.push(
      `Refused to ${params.actionLabel} ${params.targetLabel} without ${params.overrideFlag}=true.`,
    );
  } else {
    lines.push(
      `Refused to ${params.actionLabel} ${params.targetLabel} because its state could not be verified safely.`,
    );
  }
  if (typeof params.verification.pending_changes === "number") {
    lines.push(`Known pending changes: ${params.verification.pending_changes}.`);
  }
  if (typeof params.verification.pending_commits === "number") {
    lines.push(`Known pending commits: ${params.verification.pending_commits}.`);
  }
  for (const blocker of params.verification.blockers ?? []) {
    lines.push(`- ${blocker}`);
  }
  lines.push(`Safe next step: ${params.safeNextStep}`);
  return lines.join("\n");
}
