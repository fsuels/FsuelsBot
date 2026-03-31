import fs from "node:fs/promises";
import path from "node:path";
import type { SessionEntry } from "../config/sessions.js";
import { resolveSessionFilePath } from "../config/sessions.js";

const SESSION_PLAN_METADATA_PREFIX = "<!-- openclaw-session-plan:";
const SESSION_PLAN_METADATA_SUFFIX = "-->";
const SESSION_PLAN_SCHEMA_VERSION = 1;

type SessionPlanDocumentMeta = {
  schemaVersion: 1;
  sessionId: string;
  sessionKey?: string;
  updatedAt?: string;
};

export type SessionPlanArtifact = {
  sessionId: string;
  sessionKey?: string;
  filePath: string;
  exists: boolean;
  plan: string;
  updatedAt?: string;
};

function normalizePlanText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function parseSessionPlanDocument(
  raw: string,
  sessionId: string,
): {
  meta: SessionPlanDocumentMeta;
  plan: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const hasMetadata =
    firstLine.startsWith(SESSION_PLAN_METADATA_PREFIX) &&
    firstLine.endsWith(SESSION_PLAN_METADATA_SUFFIX);

  if (!hasMetadata) {
    return {
      meta: {
        schemaVersion: SESSION_PLAN_SCHEMA_VERSION,
        sessionId,
      },
      plan: normalizePlanText(normalized),
    };
  }

  const jsonText = firstLine
    .slice(
      SESSION_PLAN_METADATA_PREFIX.length,
      firstLine.length - SESSION_PLAN_METADATA_SUFFIX.length,
    )
    .trim();

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const meta: SessionPlanDocumentMeta = {
      schemaVersion: SESSION_PLAN_SCHEMA_VERSION,
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.trim()
          ? parsed.sessionId.trim()
          : sessionId,
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? parsed.sessionKey.trim()
          : undefined,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt.trim()
          : undefined,
    };
    return {
      meta,
      plan: normalizePlanText(lines.slice(1).join("\n")),
    };
  } catch {
    return {
      meta: {
        schemaVersion: SESSION_PLAN_SCHEMA_VERSION,
        sessionId,
      },
      plan: normalizePlanText(lines.slice(1).join("\n")),
    };
  }
}

function serializeSessionPlanDocument(meta: SessionPlanDocumentMeta, plan: string): string {
  return [
    `${SESSION_PLAN_METADATA_PREFIX} ${JSON.stringify(meta)} ${SESSION_PLAN_METADATA_SUFFIX}`,
    "",
    normalizePlanText(plan),
    "",
  ].join("\n");
}

export function resolveSessionPlanArtifactPath(params: {
  sessionId: string;
  sessionEntry?: Pick<SessionEntry, "sessionFile"> | null;
  agentId?: string;
}): string {
  const transcriptPath = resolveSessionFilePath(
    params.sessionId,
    params.sessionEntry ?? undefined,
    params.agentId ? { agentId: params.agentId } : undefined,
  );
  const extension = path.extname(transcriptPath);
  const baseName = path.basename(transcriptPath, extension);
  return path.join(path.dirname(transcriptPath), `${baseName}.plan.md`);
}

export async function loadSessionPlanArtifact(params: {
  sessionId: string;
  sessionEntry?: Pick<SessionEntry, "sessionFile"> | null;
  sessionKey?: string;
  agentId?: string;
}): Promise<SessionPlanArtifact> {
  const filePath = resolveSessionPlanArtifactPath(params);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = parseSessionPlanDocument(raw, params.sessionId);
    return {
      sessionId: parsed.meta.sessionId,
      sessionKey: parsed.meta.sessionKey ?? params.sessionKey,
      filePath,
      exists: true,
      plan: parsed.plan,
      updatedAt: parsed.meta.updatedAt,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
    return {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      filePath,
      exists: false,
      plan: "",
    };
  }
}

export async function saveSessionPlanArtifact(params: {
  sessionId: string;
  sessionEntry?: Pick<SessionEntry, "sessionFile"> | null;
  sessionKey?: string;
  agentId?: string;
  plan: string;
  updatedAt?: number | Date;
}): Promise<SessionPlanArtifact> {
  const filePath = resolveSessionPlanArtifactPath(params);
  const updatedAt =
    params.updatedAt instanceof Date
      ? params.updatedAt.toISOString()
      : typeof params.updatedAt === "number"
        ? new Date(params.updatedAt).toISOString()
        : new Date().toISOString();
  const meta: SessionPlanDocumentMeta = {
    schemaVersion: SESSION_PLAN_SCHEMA_VERSION,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey?.trim() || undefined,
    updatedAt,
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeSessionPlanDocument(meta, params.plan), "utf-8");
  return {
    sessionId: params.sessionId,
    sessionKey: meta.sessionKey,
    filePath,
    exists: true,
    plan: normalizePlanText(params.plan),
    updatedAt,
  };
}
