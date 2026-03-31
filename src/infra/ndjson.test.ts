import { afterEach, describe, expect, it } from "vitest";
import { safeNdjsonStringify } from "./ndjson.js";
import { installStdoutProtocolGuard } from "./stdout-protocol-guard.js";

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

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("keeps protocol writes on stdout and reroutes stray writes to stderr", async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const stdoutLike = stdout as { write: CaptureStream["write"] };
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
    expect(stderr.text()).toBe("console noise\n");
  });
});
