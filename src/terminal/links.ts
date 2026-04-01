import { formatTerminalLink } from "../utils.js";
import { resolveTerminalCapabilities } from "./capabilities.js";

export const DOCS_ROOT = "https://docs.openclaw.ai";

export function formatDocsLink(
  path: string,
  label?: string,
  opts?: { fallback?: string; force?: boolean },
): string {
  const trimmed = path.trim();
  const url = trimmed.startsWith("http")
    ? trimmed
    : `${DOCS_ROOT}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
  const supportsOsc8 = resolveTerminalCapabilities().supportsHyperlinks;
  return formatTerminalLink(label ?? url, url, {
    fallback: opts?.fallback ?? url,
    force: opts?.force ?? supportsOsc8,
  });
}

export function formatDocsRootLink(label?: string): string {
  const supportsOsc8 = resolveTerminalCapabilities().supportsHyperlinks;
  return formatTerminalLink(label ?? DOCS_ROOT, DOCS_ROOT, {
    fallback: DOCS_ROOT,
    force: supportsOsc8,
  });
}
