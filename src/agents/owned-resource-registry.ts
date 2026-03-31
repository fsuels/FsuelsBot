import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";

export type OwnedResourceType = "process_session" | "subagent_session";

export type OwnedResourceOriginalContext = {
  cwd?: string;
  projectRoot?: string;
  taskId?: string;
};

export type OwnedResourceRecord = {
  resourceId: string;
  resourceType: OwnedResourceType;
  createdByTool: string;
  sessionKey: string;
  originalContext?: OwnedResourceOriginalContext;
  cleanupStrategy?: string;
  linkedSidecars?: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
};

type PersistedOwnedResourceRegistry = {
  version: 1;
  resources: Record<string, OwnedResourceRecord>;
};

const REGISTRY_VERSION = 1 as const;

const ownedResources = new Map<string, OwnedResourceRecord>();
let loaded = false;

function buildOwnedResourceKey(resourceType: OwnedResourceType, resourceId: string) {
  return `${resourceType}:${resourceId}`;
}

export function resolveOwnedResourceRegistryPath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStateDir(env), "agents", "owned-resources.json");
}

function ensureLoaded() {
  if (loaded) {
    return;
  }
  loaded = true;
  const pathname = resolveOwnedResourceRegistryPath();
  const raw = loadJsonFile(pathname);
  if (!raw || typeof raw !== "object") {
    return;
  }
  const typed = raw as Partial<PersistedOwnedResourceRegistry>;
  if (typed.version !== REGISTRY_VERSION || !typed.resources || typeof typed.resources !== "object") {
    return;
  }
  for (const entry of Object.values(typed.resources)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const resourceId = typeof entry.resourceId === "string" ? entry.resourceId.trim() : "";
    const resourceType =
      entry.resourceType === "process_session" || entry.resourceType === "subagent_session"
        ? entry.resourceType
        : undefined;
    const sessionKey = typeof entry.sessionKey === "string" ? entry.sessionKey.trim() : "";
    const createdByTool = typeof entry.createdByTool === "string" ? entry.createdByTool.trim() : "";
    if (!resourceId || !resourceType || !sessionKey || !createdByTool) {
      continue;
    }
    ownedResources.set(buildOwnedResourceKey(resourceType, resourceId), {
      ...entry,
      resourceId,
      resourceType,
      sessionKey,
      createdByTool,
      linkedSidecars: Array.isArray(entry.linkedSidecars)
        ? entry.linkedSidecars.filter((value): value is string => typeof value === "string" && value.trim())
        : undefined,
      createdAt:
        typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
          ? entry.createdAt
          : Date.now(),
    });
  }
}

function persistOwnedResources() {
  const resources: Record<string, OwnedResourceRecord> = {};
  for (const [key, entry] of ownedResources.entries()) {
    resources[key] = entry;
  }
  saveJsonFile(resolveOwnedResourceRegistryPath(), {
    version: REGISTRY_VERSION,
    resources,
  } satisfies PersistedOwnedResourceRegistry);
}

export function registerOwnedResource(entry: OwnedResourceRecord) {
  const resourceId = entry.resourceId.trim();
  const sessionKey = entry.sessionKey.trim();
  const createdByTool = entry.createdByTool.trim();
  if (!resourceId || !sessionKey || !createdByTool) {
    return undefined;
  }
  ensureLoaded();
  const normalized: OwnedResourceRecord = {
    ...entry,
    resourceId,
    sessionKey,
    createdByTool,
    linkedSidecars: entry.linkedSidecars?.filter((value) => value.trim()),
    createdAt:
      typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
        ? entry.createdAt
        : Date.now(),
  };
  ownedResources.set(buildOwnedResourceKey(normalized.resourceType, normalized.resourceId), normalized);
  persistOwnedResources();
  return normalized;
}

export function removeOwnedResource(params: {
  resourceType: OwnedResourceType;
  resourceId: string;
}) {
  const resourceId = params.resourceId.trim();
  if (!resourceId) {
    return false;
  }
  ensureLoaded();
  const deleted = ownedResources.delete(buildOwnedResourceKey(params.resourceType, resourceId));
  if (deleted) {
    persistOwnedResources();
  }
  return deleted;
}

export function getOwnedResourceForCurrentSession(params: {
  sessionKey: string;
  resourceType: OwnedResourceType;
  resourceId?: string;
}) {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return undefined;
  }
  ensureLoaded();
  if (params.resourceId) {
    const resourceId = params.resourceId.trim();
    if (!resourceId) {
      return undefined;
    }
    const entry = ownedResources.get(buildOwnedResourceKey(params.resourceType, resourceId));
    return entry?.sessionKey === sessionKey ? entry : undefined;
  }
  return Array.from(ownedResources.values()).find(
    (entry) => entry.resourceType === params.resourceType && entry.sessionKey === sessionKey,
  );
}

export function listOwnedResourcesForCurrentSession(params: {
  sessionKey: string;
  resourceType?: OwnedResourceType;
}) {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return [];
  }
  ensureLoaded();
  return Array.from(ownedResources.values()).filter(
    (entry) =>
      entry.sessionKey === sessionKey &&
      (params.resourceType === undefined || entry.resourceType === params.resourceType),
  );
}

export function clearOwnedResourcesForTests(resourceType?: OwnedResourceType) {
  ensureLoaded();
  if (!resourceType) {
    ownedResources.clear();
    persistOwnedResources();
    return;
  }
  for (const [key, entry] of ownedResources.entries()) {
    if (entry.resourceType === resourceType) {
      ownedResources.delete(key);
    }
  }
  persistOwnedResources();
}
