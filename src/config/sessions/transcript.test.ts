import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendAssistantMessageToSessionTranscript,
  resolveMirroredTranscriptText,
} from "./transcript.js";

describe("resolveMirroredTranscriptText", () => {
  it("preserves visible text when media is also present", () => {
    const result = resolveMirroredTranscriptText({
      text: "caption here",
      mediaUrls: ["https://example.com/files/report.pdf?sig=123"],
    });
    expect(result).toBe("caption here");
  });

  it("returns trimmed text when no media", () => {
    const result = resolveMirroredTranscriptText({ text: "  hello  " });
    expect(result).toBe("hello");
  });

  it("falls back to media filenames when text is empty", () => {
    const result = resolveMirroredTranscriptText({
      text: "   ",
      mediaUrls: ["https://example.com/files/report.pdf?sig=123"],
    });
    expect(result).toBe("report.pdf");
  });
});

describe("appendAssistantMessageToSessionTranscript", () => {
  let tempDir: string;
  let storePath: string;
  let sessionsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-test-"));
    sessionsDir = path.join(tempDir, "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    storePath = path.join(sessionsDir, "sessions.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns error for missing sessionKey", async () => {
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "",
      text: "test",
      storePath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing sessionKey");
    }
  });

  it("returns error for empty text", async () => {
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "test-session",
      text: "   ",
      storePath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty text");
    }
  });

  it("returns error for unknown sessionKey", async () => {
    fs.writeFileSync(storePath, JSON.stringify({}), "utf-8");
    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey: "nonexistent",
      text: "test message",
      storePath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("unknown sessionKey");
    }
  });

  it("creates transcript file and appends message for valid session", async () => {
    const sessionId = "test-session-id";
    const sessionKey = "test-session";
    const store = {
      [sessionKey]: {
        sessionId,
        chatType: "direct",
        channel: "discord",
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(store), "utf-8");

    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Hello from delivery mirror!",
      storePath,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fs.existsSync(result.sessionFile)).toBe(true);

      const lines = fs.readFileSync(result.sessionFile, "utf-8").trim().split("\n");
      expect(lines.length).toBe(2); // header + message

      const header = JSON.parse(lines[0]);
      expect(header.type).toBe("session");
      expect(header.id).toBe(sessionId);

      const messageLine = JSON.parse(lines[1]);
      expect(messageLine.type).toBe("message");
      expect(messageLine.message.role).toBe("assistant");
      expect(messageLine.message.content[0].type).toBe("text");
      expect(messageLine.message.content[0].text).toBe("Hello from delivery mirror!");
    }
  });

  it("stores replay-safe visible metadata for proactive attachment replies", async () => {
    const sessionId = "test-session-visible";
    const sessionKey = "test-visible";
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId,
          chatType: "direct",
          channel: "telegram",
        },
      }),
      "utf-8",
    );

    const result = await appendAssistantMessageToSessionTranscript({
      sessionKey,
      text: "Here is the report",
      mediaUrls: [
        "https://example.com/files/report.pdf?sig=123",
        "https://example.com/files/photo.png?sig=456",
      ],
      status: "proactive",
      sentAt: "2026-03-31T12:34:56.000Z",
      storePath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const lines = fs.readFileSync(result.sessionFile, "utf-8").trim().split("\n");
    const messageLine = JSON.parse(lines[1]);
    expect(messageLine.message.content[0].text).toBe("Here is the report");
    expect(messageLine.message.openclawVisible).toEqual({
      status: "proactive",
      sentAt: "2026-03-31T12:34:56.000Z",
      attachments: [
        {
          kind: "file",
          name: "report.pdf",
          source: "https://example.com/files/report.pdf?sig=123",
        },
        {
          kind: "image",
          name: "photo.png",
          source: "https://example.com/files/photo.png?sig=456",
        },
      ],
    });
  });
});
