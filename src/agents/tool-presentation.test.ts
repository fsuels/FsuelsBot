import { describe, expect, it } from "vitest";
import {
  renderToolProgressText,
  renderToolResultText,
  summarizeToolArgs,
} from "./tool-presentation.js";

describe("tool-presentation", () => {
  describe("summarizeToolArgs", () => {
    it("truncates long values in compact mode", () => {
      const summary = summarizeToolArgs({
        path: "/tmp/example.txt",
        query: "x".repeat(120),
      });

      expect(summary).toContain('path: "/tmp/example.txt"');
      expect(summary).toContain('query: "');
      expect(summary?.includes("…")).toBe(true);
    });
  });

  describe("renderToolProgressText", () => {
    it("renders ratio and percentage when progress data is present", () => {
      expect(renderToolProgressText({ details: { progress: 2, total: 5 } })).toBe(
        "Processing… 2/5 (40%)",
      );
    });

    it("falls back to progressMessage and running status", () => {
      expect(renderToolProgressText({ details: { progressMessage: "Indexing…" } })).toBe(
        "Indexing…",
      );
      expect(renderToolProgressText({ details: { status: "running" } })).toBe("Running…");
      expect(renderToolProgressText({ details: { status: "awaiting_input" } })).toBe(
        "Awaiting input…",
      );
    });
  });

  describe("renderToolResultText", () => {
    it("unwraps a dominant text payload and keeps sibling metadata", () => {
      const rendered = renderToolResultText(
        `{"status":"ok","path":"https://example.com/report","text":"Line one\\nLine two\\nLine three\\nLine four\\nLine five\\nLine six"}`,
      );

      expect(rendered).toContain("status");
      expect(rendered).toContain("ok");
      expect(rendered).toContain("<https://example.com/report>");
      expect(rendered).toContain("Line one");
      expect(rendered).not.toContain('{\n  "status"');
    });

    it("flattens small JSON objects into aligned rows", () => {
      const rendered = renderToolResultText(
        `{"status":"ok","path":"/tmp/a.txt","lines":12,"meta":{"kind":"note"}}`,
      );

      expect(rendered).toContain("status");
      expect(rendered).toContain("ok");
      expect(rendered).toContain("path");
      expect(rendered).toContain("/tmp/a.txt");
      expect(rendered).toContain('{"kind":"note"}');
      expect(rendered).not.toContain("{\n");
    });

    it("fails closed for malformed JSON", () => {
      const text = "{not valid json";
      expect(renderToolResultText(text)).toBe(text);
    });

    it("fails closed when two dominant string fields compete", () => {
      const rendered = renderToolResultText(
        JSON.stringify(
          {
            stdout: "A".repeat(240),
            stderr: "B".repeat(240),
            status: "error",
          },
          null,
          0,
        ),
      );

      expect(rendered).toContain('{\n  "stdout"');
      expect(rendered).toContain('"stderr"');
    });

    it("skips JSON parsing when the payload exceeds the guard", () => {
      const oversized = `{"text":"${"x".repeat(200_100)}"}`;
      expect(renderToolResultText(oversized)).toBe(oversized);
    });

    it("renders block arrays with image placeholders", () => {
      const rendered = renderToolResultText({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "abc", mimeType: "image/png" },
        ],
      });

      expect(rendered).toBe("hello\n[Image]");
    });

    it("renders compact success summaries for message-like tools", () => {
      const rendered = renderToolResultText(
        {
          details: {
            status: "sent",
            to: "channel:C1",
            channel: "discord",
            messageId: "m1",
          },
        },
        { toolName: "message" },
      );

      expect(rendered).toBe("Sent to channel:C1 via discord (m1)");
    });

    it("summarizes read results without leaking file contents", () => {
      const rendered = renderToolResultText(
        {
          content: [{ type: "text", text: "API_KEY=super-secret\nsecond line" }],
          details: {
            kind: "text",
            path: "/tmp/secrets.env",
            startLine: 1,
            endLine: 2,
            numLines: 2,
            totalLines: 2,
            requestedOffset: 1,
            truncated: false,
          },
        },
        { toolName: "read" },
      );

      expect(rendered).toBe("Read 2 lines from /tmp/secrets.env (1-2 of 2)");
      expect(rendered).not.toContain("super-secret");
    });
  });
});
