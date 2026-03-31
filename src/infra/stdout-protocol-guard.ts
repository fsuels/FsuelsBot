import { Writable } from "node:stream";

type WritableLike = {
  write: (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ) => boolean;
};

export type StdoutProtocolGuard = {
  protocolWritable: Writable;
  restore: () => void;
};

export function installStdoutProtocolGuard(params?: {
  stdout?: WritableLike;
  stderr?: WritableLike;
}): StdoutProtocolGuard {
  const stdout = params?.stdout ?? process.stdout;
  const stderr = params?.stderr ?? process.stderr;
  const originalWrite = stdout.write.bind(stdout);
  const originalStdoutWrite = stdout.write;
  const stderrWrite = stderr.write.bind(stderr);

  stdout.write = ((chunk, encoding, cb) => {
    if (typeof encoding === "function") {
      return stderrWrite(chunk, encoding);
    }
    return stderrWrite(chunk, encoding, cb);
  }) as typeof stdout.write;

  const protocolWritable = new Writable({
    write(chunk, encoding, callback) {
      try {
        if (typeof chunk === "string") {
          originalWrite(chunk, encoding === "buffer" ? "utf8" : encoding, callback);
          return;
        }
        originalWrite(chunk, callback);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  return {
    protocolWritable,
    restore: () => {
      stdout.write = originalStdoutWrite;
    },
  };
}
