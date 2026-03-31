import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { __setMaxChatHistoryMessagesBytesForTest } from "../server-constants.js";

describe("gateway chat.history pagination", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    __setMaxChatHistoryMessagesBytesForTest();
    vi.resetModules();
    vi.doUnmock("../session-utils.js");
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("returns latest-first pages via beforeCursor while keeping page order chronological", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-chat-history-page-"));
    const transcriptPath = path.join(tmpDir, "sess-main.jsonl");
    const lines = Array.from({ length: 8 }, (_, index) =>
      JSON.stringify({
        type: "message",
        id: `m-${index}`,
        message: {
          role: "user",
          content: [{ type: "text", text: `m${index}` }],
          timestamp: index,
        },
      }),
    );
    fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");

    vi.doMock("../session-utils.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../session-utils.js")>();
      return {
        ...original,
        loadSessionEntry: () => ({
          cfg: {},
          storePath: path.join(tmpDir as string, "sessions.json"),
          entry: {
            sessionId: "sess-main",
            sessionFile: transcriptPath,
            thinkingLevel: "off",
          },
        }),
      };
    });

    const { chatHandlers } = await import("./chat.js");
    const respond = vi.fn();
    const context = {} as GatewayRequestContext;

    await chatHandlers["chat.history"]({
      params: { sessionKey: "main", limit: 3 },
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    const latestPayload = respond.mock.calls[0]?.[1] as {
      messages?: Array<{ content?: Array<{ text?: string }> }>;
      firstCursor?: number | null;
      hasMore?: boolean;
    };
    expect(latestPayload.messages?.map((message) => message.content?.[0]?.text)).toEqual([
      "m5",
      "m6",
      "m7",
    ]);
    expect(typeof latestPayload.firstCursor).toBe("number");
    expect(latestPayload.hasMore).toBe(true);

    await chatHandlers["chat.history"]({
      params: {
        sessionKey: "main",
        limit: 3,
        beforeCursor: latestPayload.firstCursor,
      },
      respond,
      context,
    });

    const olderPayload = respond.mock.calls[1]?.[1] as {
      messages?: Array<{ content?: Array<{ text?: string }> }>;
      hasMore?: boolean;
    };
    expect(olderPayload.messages?.map((message) => message.content?.[0]?.text)).toEqual([
      "m2",
      "m3",
      "m4",
    ]);
    expect(olderPayload.hasMore).toBe(true);
  });

  it("marks hasMore when the byte cap trims older messages from the fetched page", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-chat-history-cap-"));
    const transcriptPath = path.join(tmpDir, "sess-main.jsonl");
    const lines = Array.from({ length: 5 }, (_, index) =>
      JSON.stringify({
        type: "message",
        id: `m-${index}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `${index}:${"x".repeat(1500)}` }],
          timestamp: index,
        },
      }),
    );
    fs.writeFileSync(transcriptPath, lines.join("\n"), "utf-8");
    vi.doMock("../session-utils.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../session-utils.js")>();
      return {
        ...original,
        loadSessionEntry: () => ({
          cfg: {},
          storePath: path.join(tmpDir as string, "sessions.json"),
          entry: {
            sessionId: "sess-main",
            sessionFile: transcriptPath,
            thinkingLevel: "off",
          },
        }),
      };
    });

    const constants = await import("../server-constants.js");
    constants.__setMaxChatHistoryMessagesBytesForTest(1000);
    const { chatHandlers } = await import("./chat.js");
    const respond = vi.fn();

    await chatHandlers["chat.history"]({
      params: { sessionKey: "main", limit: 5 },
      respond,
      context: {} as GatewayRequestContext,
    });

    const payload = respond.mock.calls[0]?.[1] as {
      messages?: Array<{ content?: Array<{ text?: string }> }>;
      firstCursor?: number | null;
      hasMore?: boolean;
    };
    const texts = payload.messages?.map((message) => message.content?.[0]?.text) ?? [];
    expect(texts.length).toBeLessThan(5);
    expect(payload.hasMore).toBe(true);
    expect(typeof payload.firstCursor).toBe("number");
  });
});
