import { Writable } from "node:stream";

type WritableCallback = (error?: Error | null) => void;

type WritableLike = {
  write: (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | WritableCallback,
    cb?: WritableCallback,
  ) => boolean;
};

type GuardState = {
  buffer: string;
  installCount: number;
  originalWrite: WritableLike["write"];
  protocolWritable: Writable;
  stderr: WritableLike;
  stdout: GuardedWritable;
};

type GuardedWritable = WritableLike & {
  [STDOUT_PROTOCOL_GUARD_SYMBOL]?: GuardState;
};

const STDOUT_PROTOCOL_GUARD_SYMBOL = Symbol.for("openclaw.stdout-protocol-guard");

export const STDOUT_PROTOCOL_GUARD_SENTINEL = "[openclaw-stdout-guard] ";

export type StdoutProtocolGuard = {
  protocolWritable: Writable;
  restore: () => void;
};

function toChunkString(chunk: string | Uint8Array, encoding?: BufferEncoding): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  const resolvedEncoding = encoding && encoding !== "buffer" ? encoding : "utf8";
  return Buffer.from(chunk).toString(resolvedEncoding);
}

function isStructuredLine(line: string): boolean {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!normalized.trim()) {
    return false;
  }
  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
}

function writeRaw(target: WritableLike["write"], chunk: string, cb?: WritableCallback): boolean {
  return cb ? target(chunk, "utf8", cb) : target(chunk, "utf8");
}

function routeLine(state: GuardState, line: string, includeNewline: boolean): void {
  const payload = includeNewline ? `${line}\n` : line;
  const structured = isStructuredLine(line);
  const targetWrite = structured
    ? state.originalWrite.bind(state.stdout)
    : state.stderr.write.bind(state.stderr);
  const nextChunk = structured ? payload : `${STDOUT_PROTOCOL_GUARD_SENTINEL}${payload}`;
  writeRaw(targetWrite, nextChunk);
}

function flushCompleteLines(state: GuardState): void {
  let newlineIndex = state.buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = state.buffer.slice(0, newlineIndex);
    state.buffer = state.buffer.slice(newlineIndex + 1);
    routeLine(state, line, true);
    newlineIndex = state.buffer.indexOf("\n");
  }
}

function handleChunk(
  state: GuardState,
  chunk: string | Uint8Array,
  encoding?: BufferEncoding,
): void {
  state.buffer += toChunkString(chunk, encoding);
  flushCompleteLines(state);
}

function flushPartialLine(state: GuardState): void {
  if (!state.buffer) {
    return;
  }
  const pending = state.buffer;
  state.buffer = "";
  routeLine(state, pending, false);
}

function createGuardState(stdout: GuardedWritable, stderr: WritableLike): GuardState {
  const state: GuardState = {
    buffer: "",
    installCount: 0,
    originalWrite: stdout.write,
    stderr,
    stdout,
    protocolWritable: new Writable({
      write(chunk, encoding, callback) {
        try {
          handleChunk(state, chunk, encoding === "buffer" ? undefined : encoding);
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
      final(callback) {
        try {
          flushPartialLine(state);
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    }),
  };

  stdout.write = ((chunk, encoding, cb) => {
    try {
      if (typeof encoding === "function") {
        handleChunk(state, chunk);
        encoding(null);
        return true;
      }
      handleChunk(state, chunk, encoding);
      cb?.(null);
      return true;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (typeof encoding === "function") {
        encoding(normalizedError);
      } else {
        cb?.(normalizedError);
      }
      return false;
    }
  }) as typeof stdout.write;

  return state;
}

function installGuardOnStdout(stdout: GuardedWritable, stderr: WritableLike): GuardState {
  const existing = stdout[STDOUT_PROTOCOL_GUARD_SYMBOL];
  if (existing) {
    existing.stderr = stderr;
    existing.installCount += 1;
    return existing;
  }
  const state = createGuardState(stdout, stderr);
  state.installCount = 1;
  stdout[STDOUT_PROTOCOL_GUARD_SYMBOL] = state;
  return state;
}

function releaseGuard(state: GuardState): void {
  if (state.installCount > 1) {
    state.installCount -= 1;
    return;
  }
  flushPartialLine(state);
  state.stdout.write = state.originalWrite;
  delete state.stdout[STDOUT_PROTOCOL_GUARD_SYMBOL];
  state.installCount = 0;
}

export function installStdoutProtocolGuard(params?: {
  stdout?: WritableLike;
  stderr?: WritableLike;
}): StdoutProtocolGuard {
  const stdout = (params?.stdout ?? process.stdout) as GuardedWritable;
  const stderr = params?.stderr ?? process.stderr;
  const state = installGuardOnStdout(stdout, stderr);
  let restored = false;
  return {
    protocolWritable: state.protocolWritable,
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      releaseGuard(state);
    },
  };
}

export function resetStdoutProtocolGuardForTests(params?: { stdout?: WritableLike }): void {
  const stdout = (params?.stdout ?? process.stdout) as GuardedWritable;
  const state = stdout[STDOUT_PROTOCOL_GUARD_SYMBOL];
  if (!state) {
    return;
  }
  state.installCount = 1;
  releaseGuard(state);
}
