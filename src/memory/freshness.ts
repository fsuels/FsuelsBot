const DAY_MS = 24 * 60 * 60 * 1000;

export function memoryAgeDays(mtimeMs: number, now = Date.now()): number {
  if (!Number.isFinite(mtimeMs)) {
    return 0;
  }
  const ageMs = Math.max(0, now - mtimeMs);
  return Math.floor(ageMs / DAY_MS);
}

export function memoryAge(mtimeMs: number, now = Date.now()): string {
  const days = memoryAgeDays(mtimeMs, now);
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "yesterday";
  }
  return `${days} days ago`;
}

export function memoryFreshnessText(mtimeMs: number, now = Date.now()): string {
  return `Recorded ${memoryAge(mtimeMs, now)}.`;
}

export function memoryFreshnessNote(mtimeMs: number, now = Date.now()): string | undefined {
  if (memoryAgeDays(mtimeMs, now) <= 1) {
    return undefined;
  }
  return "Point-in-time observation; verify against current code or state before relying on it.";
}
