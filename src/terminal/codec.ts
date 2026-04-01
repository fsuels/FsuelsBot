const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;

export type OscTerminator = "bel" | "st";

function sanitizeOscPayload(value: string): string {
  return value.replaceAll(ESC, "").replaceAll(BEL, "");
}

function resolveOscTerminator(terminator: OscTerminator = "bel"): string {
  return terminator === "st" ? ST : BEL;
}

export function csi(parameters: string, final: string): string {
  return `${ESC}[${parameters}${final}`;
}

export function decSet(mode: number | string): string {
  return csi(`?${mode}`, "h");
}

export function decReset(mode: number | string): string {
  return csi(`?${mode}`, "l");
}

export function osc(
  command: number | string,
  data: string,
  options: { terminator?: OscTerminator } = {},
): string {
  return `${ESC}]${command};${data}${resolveOscTerminator(options.terminator)}`;
}

export function sgrReset(): string {
  return csi("0", "m");
}

export function showCursor(): string {
  return decSet(25);
}

export function hideCursor(): string {
  return decReset(25);
}

export function enableMouseTracking(mode: 1000 | 1002 | 1003): string {
  return decSet(mode);
}

export function disableMouseTracking(mode: 1000 | 1002 | 1003): string {
  return decReset(mode);
}

export function enableFocusEvents(): string {
  return decSet(1004);
}

export function disableFocusEvents(): string {
  return decReset(1004);
}

export function enableSgrMouseMode(): string {
  return decSet(1006);
}

export function disableSgrMouseMode(): string {
  return decReset(1006);
}

export function enableBracketedPaste(): string {
  return decSet(2004);
}

export function disableBracketedPaste(): string {
  return decReset(2004);
}

export function enterAlternateScreen(): string {
  return decSet(1049);
}

export function exitAlternateScreen(): string {
  return decReset(1049);
}

export function disableKittyKeyboardProtocol(): string {
  return csi("<", "u");
}

export function formatOsc8Hyperlink(
  label: string,
  url: string,
  options: { terminator?: OscTerminator } = {},
): string {
  const safeLabel = sanitizeOscPayload(label);
  const safeUrl = sanitizeOscPayload(url);
  return `${osc(8, `;${safeUrl}`, options)}${safeLabel}${osc(8, ";", options)}`;
}

export function formatOsc52Clipboard(
  value: string,
  options: { clipboard?: string; terminator?: OscTerminator } = {},
): string {
  const clipboard = sanitizeOscPayload(options.clipboard ?? "c");
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return osc(52, `${clipboard};${encoded}`, options);
}

export function wrapTmuxPassthrough(sequence: string): string {
  const escaped = sequence.replaceAll(ESC, `${ESC}${ESC}`);
  return `${ESC}Ptmux;${escaped}${ST}`;
}

export function buildTerminalResetSequence(): string {
  return [
    sgrReset(),
    showCursor(),
    disableMouseTracking(1000),
    disableMouseTracking(1002),
    disableMouseTracking(1003),
    disableFocusEvents(),
    disableSgrMouseMode(),
    disableBracketedPaste(),
    disableKittyKeyboardProtocol(),
  ].join("");
}

export const terminalCodec = {
  ESC,
  BEL,
  ST,
  csi,
  decSet,
  decReset,
  osc,
  sgrReset,
  showCursor,
  hideCursor,
  enableMouseTracking,
  disableMouseTracking,
  enableFocusEvents,
  disableFocusEvents,
  enableSgrMouseMode,
  disableSgrMouseMode,
  enableBracketedPaste,
  disableBracketedPaste,
  enterAlternateScreen,
  exitAlternateScreen,
  disableKittyKeyboardProtocol,
  formatOsc8Hyperlink,
  formatOsc52Clipboard,
  wrapTmuxPassthrough,
  buildTerminalResetSequence,
};
