import { formatOsc52Clipboard, wrapTmuxPassthrough } from "./codec.js";

export type ClipboardMethod = "native" | "tmux-buffer" | "osc52";

export type ClipboardPlan = {
  methods: ClipboardMethod[];
  isRemoteSession: boolean;
  isTmuxSession: boolean;
  isTTY: boolean;
};

type ClipboardPlanOptions = {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
};

function readSshFlag(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

export function resolveClipboardPlan(options: ClipboardPlanOptions = {}): ClipboardPlan {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const isRemoteSession = readSshFlag(env);
  const isTmuxSession = Boolean(env.TMUX);
  const methods: ClipboardMethod[] = [];

  if (!isRemoteSession) {
    methods.push("native");
  }
  if (isTmuxSession) {
    methods.push("tmux-buffer");
  }
  if (isTTY) {
    methods.push("osc52");
  }

  return {
    methods,
    isRemoteSession,
    isTmuxSession,
    isTTY,
  };
}

export function formatClipboardOsc52(
  value: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): string {
  const env = options.env ?? process.env;
  const sequence = formatOsc52Clipboard(value);
  return env.TMUX ? wrapTmuxPassthrough(sequence) : sequence;
}
