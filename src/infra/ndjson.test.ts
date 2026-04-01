import { afterEach, describe, expect, it } from "vitest";
import { safeNdjsonStringify } from "./ndjson.js";
import {
  installStdoutProtocolGuard,
  resetStdoutProtocolGuardForTests,
  STDOUT_PROTOCOL_GUARD_SENTINEL,
} from "./stdout-protocol-guard.js";

class CaptureStream {
  chunks: string[] = [];

  write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean {
    this.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    if (typeof encoding === "function") {
      encoding(null);
    } else {
      cb?.(null);
    }
    return true;
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("safeNdjsonStringify", () => {
  it("round-trips strings containing U+2028 and U+2029 without introducing line breaks", () => {
    const value = {
      text: `hello\u2028world\u2029done`,
    };

    const serialized = safeNdjsonStringify(value);

    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(serialized.split(/\r?\n/)).toHaveLength(1);
    expect(JSON.parse(serialized)).toEqual(value);
  });
});

describe("installStdoutProtocolGuard", () => {
  let restore: (() => void) | null = null;
  let stdoutLike: { write: CaptureStream["write"] } | undefined;

  afterEach(() => {
    restore?.();
    if (stdoutLike) {
      resetStdoutProtocolGuardForTests({ stdout: stdoutLike });
    }
    restore = null;
    stdoutLike = undefined;
  });

  it("keeps valid structured lines on stdout and diverts stray console output to stderr", async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    stdoutLike = stdout as { write: CaptureStream["write"] };
    const stderrLike = stderr as { write: CaptureStream["write"] };
    const guard = installStdoutProtocolGuard({
      stdout: stdoutLike,
      stderr: stderrLike,
    });
    restore = guard.restore;

    await new Promise<void>((resolve, reject) => {
      guard.protocolWritable.write('{"type":"event"}\n', "utf8", (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    stdoutLike.write("console noise\n");

    expect(stdout.text()).toBe('{"type":"event"}\n');
    expect(stderr.text()).toBe(`${STDOUT_PROTOCOL_GUARD_SENTINEL}console noise\n`);
  });

  it("buffers partial lines until newline before validating them", () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    stdoutLike = stdout as { write: CaptureStream["write"] };
    const stderrLike = stderr as { write: CaptureStream["write"] };
    const guard = installStdoutProtocolGuard({
      stdout: stdoutLike,
      stderr: stderrLike,
    });
    restore = guard.restore;

    stdoutLike.write('{"type":"partial"');

    expect(stdout.text()).toBe("");
    expect(stderr.text()).toBe("");

    stdoutLike.write("}\n");

    expect(stdout.text()).toBe('{"type":"partial"}\n');
    expect(stderr.text()).toBe("");
  });

  it("flushes partial invalid lines to stderr during cleanup", () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    stdoutLike = stdout as { write: CaptureStream["write"] };
    const stderrLike = stderr as { write: CaptureStream["write"] };
    const guard = installStdoutProtocolGuard({
      stdout: stdoutLike,
      stderr: stderrLike,
    });

    stdoutLike.write("banner without newline");
    guard.restore();

    expect(stdout.text()).toBe("");
    expect(stderr.text()).toBe(`${STDOUT_PROTOCOL_GUARD_SENTINEL}banner without newline`);
  });

  it("treats repeated install calls as idempotent and restores only after the last guard releases", async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    stdoutLike = stdout as { write: CaptureStream["write"] };
    const stderrLike = stderr as { write: CaptureStream["write"] };
    const first = installStdoutProtocolGuard({
      stdout: stdoutLike,
      stderr: stderrLike,
    });
    const second = installStdoutProtocolGuard({
      stdout: stdoutLike,
      stderr: stderrLike,
    });
    restore = second.restore;

    expect(first.protocolWritable).toBe(second.protocolWritable);

    await new Promise<void>((resolve, reject) => {
      first.protocolWritable.write('{"type":"event"}\n', "utf8", (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    first.restore();
    stdoutLike.write("still guarded\n");
    second.restore();
    stdoutLike.write("unguarded\n");

    expect(stdout.text()).toBe('{"type":"event"}\nunguarded\n');
    expect(stderr.text()).toBe(`${STDOUT_PROTOCOL_GUARD_SENTINEL}still guarded\n`);
  });
});
