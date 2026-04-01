import type { CommandOptions, SpawnResult } from "../process/exec.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { formatClipboardOsc52, resolveClipboardPlan } from "../terminal/clipboard.js";

type ClipboardStream = Pick<NodeJS.WriteStream, "isTTY" | "write">;
type ClipboardCommandRunner = (
  argv: string[],
  options: number | CommandOptions,
) => Promise<SpawnResult>;

export type CopyToClipboardOptions = {
  env?: NodeJS.ProcessEnv;
  stdout?: ClipboardStream;
  runCommand?: ClipboardCommandRunner;
};

const NATIVE_CLIPBOARD_ATTEMPTS: Array<{ argv: string[] }> = [
  { argv: ["pbcopy"] },
  { argv: ["xclip", "-selection", "clipboard"] },
  { argv: ["wl-copy"] },
  { argv: ["clip.exe"] }, // WSL / Windows
  { argv: ["powershell", "-NoProfile", "-Command", "Set-Clipboard"] },
];

const TMUX_CLIPBOARD_ATTEMPTS: Array<{ argv: string[] }> = [
  { argv: ["tmux", "load-buffer", "-"] },
  { argv: ["tmux", "set-buffer", "--"] },
];

async function tryClipboardCommands(
  attempts: Array<{ argv: string[] }>,
  value: string,
  options: {
    env: NodeJS.ProcessEnv;
    runCommand: ClipboardCommandRunner;
  },
): Promise<boolean> {
  for (const attempt of attempts) {
    try {
      const result = await options.runCommand(attempt.argv, {
        timeoutMs: 3_000,
        input: value,
        env: options.env,
      });
      if (result.code === 0 && !result.killed) {
        return true;
      }
    } catch {
      // Best-effort fallback chain.
    }
  }
  return false;
}

function writeOsc52ToStream(
  value: string,
  options: {
    env: NodeJS.ProcessEnv;
    stdout: ClipboardStream;
  },
): boolean {
  if (!options.stdout.isTTY) {
    return false;
  }
  try {
    options.stdout.write(formatClipboardOsc52(value, { env: options.env }));
    return true;
  } catch {
    return false;
  }
}

export async function copyToClipboard(
  value: string,
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const runCommand = options.runCommand ?? runCommandWithTimeout;
  const plan = resolveClipboardPlan({ env, isTTY: Boolean(stdout.isTTY) });

  for (const method of plan.methods) {
    if (method === "native") {
      if (
        await tryClipboardCommands(NATIVE_CLIPBOARD_ATTEMPTS, value, {
          env,
          runCommand,
        })
      ) {
        return true;
      }
      continue;
    }
    if (method === "tmux-buffer") {
      if (
        await tryClipboardCommands(TMUX_CLIPBOARD_ATTEMPTS, value, {
          env,
          runCommand,
        })
      ) {
        return true;
      }
      continue;
    }
    if (method === "osc52" && writeOsc52ToStream(value, { env, stdout })) {
      return true;
    }
  }

  return false;
}
