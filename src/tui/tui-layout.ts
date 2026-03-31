import {
  truncateMiddleToDisplayWidth,
  truncateToDisplayWidth,
  visibleWidth,
} from "../terminal/ansi.js";

const DEFAULT_COLUMNS = 120;
const MIN_COLUMNS = 48;
const FULL_LAYOUT_COLUMNS = 96;
const SEGMENT_SEPARATOR = " | ";

type HeaderLayoutParams = {
  columns?: number;
  connectionUrl: string;
  agentLabel: string;
  sessionLabel: string;
};

type FooterLayoutParams = {
  columns?: number;
  sessionLabel: string;
  modelLabel: string;
  tokensLabel: string;
  thinkLabel?: string | null;
  verboseLabel?: string | null;
  reasoningLabel?: string | null;
};

function resolveColumns(columns?: number): number {
  return Math.max(MIN_COLUMNS, columns ?? process.stdout.columns ?? DEFAULT_COLUMNS);
}

function resolveLayoutMode(columns?: number): "compact" | "full" {
  return resolveColumns(columns) < FULL_LAYOUT_COLUMNS ? "compact" : "full";
}

function fitWithinWidth(text: string, width: number): string {
  return visibleWidth(text) <= width ? text : truncateToDisplayWidth(text, width);
}

function joinSegments(segments: string[]): string {
  return segments.filter(Boolean).join(SEGMENT_SEPARATOR);
}

function fitJoinedSegments(segments: string[], width: number): string {
  return fitWithinWidth(joinSegments(segments), width);
}

function summarizeConnectionUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "gateway";
  }
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.replace(/:$/, "");
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return `${protocol}://${parsed.host}${path}`;
  } catch {
    return trimmed;
  }
}

export function formatTuiHeaderLine(params: HeaderLayoutParams): string {
  const columns = resolveColumns(params.columns);
  const connection = summarizeConnectionUrl(params.connectionUrl);
  const agent = truncateMiddleToDisplayWidth(
    params.agentLabel,
    Math.max(12, Math.floor(columns * 0.2)),
  );
  const session = truncateMiddleToDisplayWidth(
    params.sessionLabel,
    Math.max(14, Math.floor(columns * 0.28)),
  );

  if (resolveLayoutMode(columns) === "compact") {
    return fitJoinedSegments(["openclaw tui", connection, `agent ${agent}`], columns);
  }

  const connectionBudget = Math.max(20, Math.floor(columns * 0.34));
  const fittedConnection = truncateMiddleToDisplayWidth(connection, connectionBudget);
  return fitJoinedSegments(
    ["openclaw tui", fittedConnection, `agent ${agent}`, `session ${session}`],
    columns,
  );
}

export function formatTuiFooterLine(params: FooterLayoutParams): string {
  const columns = resolveColumns(params.columns);
  const session = truncateMiddleToDisplayWidth(
    params.sessionLabel,
    Math.max(12, Math.floor(columns * 0.26)),
  );
  const model = truncateToDisplayWidth(params.modelLabel, Math.max(14, Math.floor(columns * 0.28)));
  const tokens = fitWithinWidth(params.tokensLabel, Math.max(10, Math.floor(columns * 0.24)));

  if (resolveLayoutMode(columns) === "compact") {
    const base = [session, model, tokens];
    const optional = [params.thinkLabel, params.verboseLabel, params.reasoningLabel].filter(
      Boolean,
    );
    let text = joinSegments(base);
    for (const label of optional) {
      const next = joinSegments([text, label ?? ""]);
      if (visibleWidth(next) > columns) {
        break;
      }
      text = next;
    }
    return fitWithinWidth(text, columns);
  }

  return fitJoinedSegments(
    [
      `session ${session}`,
      model,
      params.thinkLabel ?? "",
      params.verboseLabel ?? "",
      params.reasoningLabel ?? "",
      tokens,
    ],
    columns,
  );
}
