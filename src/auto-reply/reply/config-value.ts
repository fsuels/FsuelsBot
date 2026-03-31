import JSON5 from "json5";

export function parseConfigValue(raw: string): {
  value?: unknown;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: "Missing value." };
  }

  try {
    return { value: JSON5.parse(trimmed) };
  } catch {
    // Fall back to a raw string so commands like /config set foo=bar keep working.
  }

  return { value: trimmed };
}
