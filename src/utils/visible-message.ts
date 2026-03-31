const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

export type VisibleMessageStatus = "normal" | "proactive";

export type VisibleAttachmentKind = "image" | "file";

export type VisibleAttachment = {
  kind: VisibleAttachmentKind;
  name: string;
  source: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type VisibleMessageMeta = {
  status?: VisibleMessageStatus;
  sentAt?: string;
  attachments?: VisibleAttachment[];
};

function stripQueryAndHash(value: string): string {
  const noHash = value.split("#")[0] ?? value;
  return noHash.split("?")[0] ?? noHash;
}

export function extractVisibleAttachmentName(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = stripQueryAndHash(trimmed);
  try {
    const parsed = new URL(cleaned);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const base = parts.at(-1) ?? "";
    if (!base) {
      return null;
    }
    try {
      return decodeURIComponent(base);
    } catch {
      return base;
    }
  } catch {
    const normalized = cleaned.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.at(-1) ?? null;
  }
}

export function inferVisibleAttachmentKind(params: {
  source?: string;
  name?: string;
  mimeType?: string;
}): VisibleAttachmentKind {
  const mimeType = params.mimeType?.trim().toLowerCase();
  if (mimeType?.startsWith("image/")) {
    return "image";
  }

  const probe = (params.name ?? params.source ?? "").trim().toLowerCase();
  const cleaned = stripQueryAndHash(probe);
  const lastDot = cleaned.lastIndexOf(".");
  const ext = lastDot >= 0 ? cleaned.slice(lastDot + 1) : "";
  return IMAGE_EXTENSIONS.has(ext) ? "image" : "file";
}

export function buildVisibleAttachmentsFromMediaUrls(mediaUrls?: string[]): VisibleAttachment[] {
  const seen = new Set<string>();
  const attachments: VisibleAttachment[] = [];
  for (const raw of mediaUrls ?? []) {
    const source = raw?.trim();
    if (!source || seen.has(source)) {
      continue;
    }
    seen.add(source);
    const name = extractVisibleAttachmentName(source);
    const kind = inferVisibleAttachmentKind({ source, name: name ?? undefined });
    attachments.push({
      kind,
      name: name ?? (kind === "image" ? "image" : "file"),
      source,
    });
  }
  return attachments;
}

export function formatVisibleAttachmentSize(sizeBytes?: number): string | null {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return null;
  }
  if (sizeBytes < 1024) {
    return `${Math.round(sizeBytes)} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(sizeBytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(sizeBytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatVisibleAttachmentLabel(attachment: VisibleAttachment): string {
  const prefix = attachment.kind === "image" ? "[image]" : "[file]";
  const size = formatVisibleAttachmentSize(attachment.sizeBytes);
  return size ? `${prefix} ${attachment.name} (${size})` : `${prefix} ${attachment.name}`;
}

export function extractVisibleMessageMeta(message: unknown): VisibleMessageMeta | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const raw = (message as { openclawVisible?: unknown }).openclawVisible;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
            return null;
          }
          const value = attachment as Record<string, unknown>;
          const name = typeof value.name === "string" ? value.name.trim() : "";
          const source = typeof value.source === "string" ? value.source.trim() : "";
          const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim() : undefined;
          const kind =
            value.kind === "image" || value.kind === "file"
              ? value.kind
              : inferVisibleAttachmentKind({ source, name, mimeType });
          if (!name || !source) {
            return null;
          }
          return {
            kind,
            name,
            source,
            mimeType,
            sizeBytes:
              typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)
                ? value.sizeBytes
                : undefined,
          } satisfies VisibleAttachment;
        })
        .filter((value): value is VisibleAttachment => value !== null)
    : undefined;
  const status =
    record.status === "normal" || record.status === "proactive" ? record.status : undefined;
  const rawSentAt =
    typeof record.sentAt === "string"
      ? record.sentAt
      : typeof record.sent_at === "string"
        ? record.sent_at
        : "";
  const sentAt = rawSentAt.trim();
  if (!status && !sentAt && (!attachments || attachments.length === 0)) {
    return null;
  }
  return {
    status,
    sentAt: sentAt || undefined,
    attachments: attachments?.length ? attachments : undefined,
  };
}
