import path from "node:path";

const WRITE_MARK_TTL_MS = 5_000;
const SELF_UNLINK_ADD_GRACE_MS = 1_500;

const recentWrites = new Map<string, number[]>();
const suppressedAdds = new Map<string, number>();

function resolveKey(filePath: string): string {
  return path.resolve(filePath);
}

function pruneExpired(now: number): void {
  for (const [filePath, timestamps] of recentWrites.entries()) {
    const next = timestamps.filter((expiresAt) => expiresAt > now);
    if (next.length === 0) {
      recentWrites.delete(filePath);
    } else if (next.length !== timestamps.length) {
      recentWrites.set(filePath, next);
    }
  }
  for (const [filePath, expiresAt] of suppressedAdds.entries()) {
    if (expiresAt <= now) {
      suppressedAdds.delete(filePath);
    }
  }
}

export function markConfigPathWrite(filePath: string): void {
  const now = Date.now();
  pruneExpired(now);
  const key = resolveKey(filePath);
  const entries = recentWrites.get(key) ?? [];
  entries.push(now + WRITE_MARK_TTL_MS);
  recentWrites.set(key, entries);
}

export function shouldSuppressConfigWatchEvent(
  filePath: string,
  eventName: "add" | "change" | "unlink",
): boolean {
  const now = Date.now();
  pruneExpired(now);
  const key = resolveKey(filePath);

  const suppressedAddUntil = suppressedAdds.get(key);
  if (eventName === "add" && suppressedAddUntil && suppressedAddUntil > now) {
    suppressedAdds.delete(key);
    return true;
  }

  const entries = recentWrites.get(key);
  if (!entries || entries.length === 0) {
    return false;
  }

  entries.shift();
  if (entries.length === 0) {
    recentWrites.delete(key);
  } else {
    recentWrites.set(key, entries);
  }

  if (eventName === "unlink") {
    suppressedAdds.set(key, now + SELF_UNLINK_ADD_GRACE_MS);
  }
  return true;
}

export function __resetConfigWatchEventStateForTests(): void {
  recentWrites.clear();
  suppressedAdds.clear();
}
