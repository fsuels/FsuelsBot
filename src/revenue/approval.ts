import type {
  RevenueApprovalItem,
  RevenueApprovalKind,
  RevenueApprovalRisk,
  RevenueApprovalStatus,
  RevenueConfig,
} from "./types.js";
import { toSlug } from "./store.js";

export const APPROVAL_REQUIRED_FIELDS_BY_KIND: Record<RevenueApprovalKind, string[]> = {
  outreach_draft: ["targetPersona", "offer", "claimSupport", "optOut"],
  offer_draft: ["offer", "price", "deliverable"],
  deliverable: ["deliverable", "qaChecklist"],
  listing: ["title", "description", "price"],
};

function buildApprovalId(title: string, createdAt: number): string {
  const slug = toSlug(title) || "approval";
  return `${slug}-${createdAt}`;
}

function safeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export function defaultRiskByKind(kind: RevenueApprovalKind): RevenueApprovalRisk {
  if (kind === "outreach_draft" || kind === "offer_draft") {
    return "medium";
  }
  return "low";
}

export function missingRequiredFields(item: RevenueApprovalItem): string[] {
  const required = item.requiredFields;
  const missing: string[] = [];
  for (const field of required) {
    if (safeString(item.draft[field]).length === 0) {
      missing.push(field);
    }
  }
  return missing;
}

export function autoResolveApproval(params: { item: RevenueApprovalItem; config: RevenueConfig }): {
  status: RevenueApprovalStatus;
  reason?: string;
} {
  const missing = missingRequiredFields(params.item);
  if (params.config.ops.autoRejectMissingFields && missing.length > 0) {
    return {
      status: "rejected",
      reason: `Missing required fields: ${missing.join(", ")}`,
    };
  }

  const allowedRisk = params.config.ops.autoApproveRisk;
  if (params.item.risk === "low") {
    return { status: "approved" };
  }
  if (params.item.risk === "medium" && allowedRisk === "medium") {
    return { status: "approved" };
  }

  return { status: "pending" };
}

export function createApprovalItem(params: {
  kind: RevenueApprovalKind;
  title: string;
  projectId: string;
  experimentId?: string;
  opportunityId?: string;
  draft: Record<string, string>;
  requiredFields?: string[];
  risk?: RevenueApprovalRisk;
  tags?: string[];
  createdAt?: number;
}): RevenueApprovalItem {
  const createdAt = params.createdAt ?? Date.now();
  const requiredFields =
    params.requiredFields ?? APPROVAL_REQUIRED_FIELDS_BY_KIND[params.kind] ?? [];
  return {
    id: buildApprovalId(params.title, createdAt),
    createdAt,
    updatedAt: createdAt,
    status: "pending",
    kind: params.kind,
    projectId: params.projectId,
    experimentId: params.experimentId,
    opportunityId: params.opportunityId,
    title: params.title,
    draft: params.draft,
    risk: params.risk ?? defaultRiskByKind(params.kind),
    requiredFields,
    tags: params.tags,
  };
}

export function foldApprovalQueue(entries: RevenueApprovalItem[]): RevenueApprovalItem[] {
  const byId = new Map<string, RevenueApprovalItem>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].toSorted((a, b) => a.createdAt - b.createdAt);
}

export function updateApprovalStatus(params: {
  item: RevenueApprovalItem;
  status: RevenueApprovalStatus;
  reason?: string;
  now?: number;
}): RevenueApprovalItem {
  return {
    ...params.item,
    status: params.status,
    reason: params.reason ?? params.item.reason,
    updatedAt: params.now ?? Date.now(),
  };
}

export function buildApprovalBatchMarkdown(params: {
  date: string;
  items: RevenueApprovalItem[];
  maxApprovalMinutes: number;
}): string {
  const pending = params.items.filter((item) => item.status === "pending");
  const approved = params.items.filter((item) => item.status === "approved");
  const rejected = params.items.filter((item) => item.status === "rejected");

  const lines: string[] = [];
  lines.push(`# Approval Batch ${params.date}`);
  lines.push("");
  lines.push(`- Timebox: ${params.maxApprovalMinutes} minutes`);
  lines.push(`- Pending: ${pending.length}`);
  lines.push(`- Auto-approved: ${approved.length}`);
  lines.push(`- Auto-rejected: ${rejected.length}`);
  lines.push("");

  if (pending.length > 0) {
    lines.push("## Pending");
    for (const item of pending) {
      lines.push(`- [ ] ${item.id} | ${item.kind} | ${item.title} | risk=${item.risk}`);
    }
    lines.push("");
  }

  if (approved.length > 0) {
    lines.push("## Auto-Approved");
    for (const item of approved) {
      lines.push(`- ${item.id} | ${item.title}`);
    }
    lines.push("");
  }

  if (rejected.length > 0) {
    lines.push("## Auto-Rejected");
    for (const item of rejected) {
      lines.push(`- ${item.id} | ${item.title} | ${item.reason ?? "Missing required data"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
