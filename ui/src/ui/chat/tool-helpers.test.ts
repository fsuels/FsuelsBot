import { describe, it, expect } from "vitest";
import {
  formatToolOutputForSidebar,
  getTruncatedPreview,
  renderToolOutputValue,
} from "./tool-helpers.ts";

describe("tool-helpers", () => {
  describe("formatToolOutputForSidebar", () => {
    it("flattens small JSON objects into readable rows", () => {
      const input = '{"name":"test","value":123}';
      const result = formatToolOutputForSidebar(input);

      expect(result).toContain("name");
      expect(result).toContain("test");
      expect(result).toContain("value");
      expect(result).not.toContain("```json");
    });

    it("formats valid JSON array as code block", () => {
      const input = "[1, 2, 3]";
      const result = formatToolOutputForSidebar(input);

      expect(result).toBe(`\`\`\`json
[
  1,
  2,
  3
]
\`\`\``);
    });

    it("unwraps dominant text payloads and linkifies urls", () => {
      const input =
        '{"status":"ok","url":"https://example.com","text":"Line one\\nLine two\\nLine three\\nLine four\\nLine five\\nLine six"}';
      const result = formatToolOutputForSidebar(input);

      expect(result).toContain("status");
      expect(result).toContain("ok");
      expect(result).toContain("<https://example.com>");
      expect(result).toContain("Line one");
      expect(result).not.toContain("```json");
    });

    it("handles nested JSON objects", () => {
      const input = '{"outer":{"inner":"value"}}';
      const result = formatToolOutputForSidebar(input);

      expect(result).toContain("outer");
      expect(result).toContain('"inner"');
    });

    it("returns plain text for non-JSON content", () => {
      const input = "This is plain text output";
      const result = formatToolOutputForSidebar(input);

      expect(result).toBe("This is plain text output");
    });

    it("returns as-is for invalid JSON starting with {", () => {
      const input = "{not valid json";
      const result = formatToolOutputForSidebar(input);

      expect(result).toBe("{not valid json");
    });

    it("returns as-is for invalid JSON starting with [", () => {
      const input = "[not valid json";
      const result = formatToolOutputForSidebar(input);

      expect(result).toBe("[not valid json");
    });

    it("trims whitespace before detecting JSON", () => {
      const input = '   {"trimmed": true}   ';
      const result = formatToolOutputForSidebar(input);

      expect(result).toContain("trimmed");
      expect(result).toContain("true");
    });

    it("uses structured details instead of the compact machine payload when available", () => {
      const input = '{"count":2,"sessions":[{"key":"main"}],"truncated":true}';
      const details = {
        count: 2,
        sessions: [
          { key: "main", kind: "main" },
          { key: "cron:job-1", kind: "cron", channel: "cron" },
        ],
      };
      const result = formatToolOutputForSidebar(input, details, "sessions_list");

      expect(result).not.toBe(input);
      expect(result).toContain("```json");
      expect(result).toContain('"cron:job-1"');
      expect(result).not.toContain('"truncated": true');
    });

    it("fails closed on ambiguous two-dominant-field JSON", () => {
      const input = JSON.stringify({
        stdout: "a".repeat(240),
        stderr: "b".repeat(240),
        status: "error",
      });
      const result = formatToolOutputForSidebar(input);

      expect(result).toContain("```json");
      expect(result).toContain('"stdout"');
      expect(result).toContain('"stderr"');
    });

    it("skips JSON parsing once the guard threshold is exceeded", () => {
      const input = `{"text":"${"x".repeat(200_100)}"}`;
      const result = formatToolOutputForSidebar(input);

      expect(result).toBe(input);
    });

    it("handles empty string", () => {
      const result = formatToolOutputForSidebar("");
      expect(result).toBe("");
    });

    it("handles whitespace-only string", () => {
      const result = formatToolOutputForSidebar("   ");
      expect(result).toBe("   ");
    });
  });

  describe("renderToolOutputValue", () => {
    it("renders block arrays with image placeholders", () => {
      const result = renderToolOutputValue(
        {
          content: [
            { type: "text", text: "hello" },
            { type: "image", data: "abc", mimeType: "image/png" },
          ],
        },
        { markdown: false },
      );

      expect(result).toBe("hello\n[Image]");
    });

    it("renders progress updates and compact success summaries", () => {
      expect(
        renderToolOutputValue({ details: { progress: 3, total: 5 } }, { markdown: false }),
      ).toBe("Processing… 3/5 (60%)");
      expect(
        renderToolOutputValue(
          {
            details: {
              status: "sent",
              to: "channel:C1",
              channel: "discord",
              messageId: "m1",
            },
          },
          { markdown: false, toolName: "message" },
        ),
      ).toBe("Sent to channel:C1 via discord (m1)");
    });
  });

  describe("getTruncatedPreview", () => {
    it("returns short text unchanged", () => {
      const input = "Short text";
      const result = getTruncatedPreview(input);

      expect(result).toBe("Short text");
    });

    it("truncates text longer than max chars", () => {
      const input = "a".repeat(150);
      const result = getTruncatedPreview(input);

      expect(result.length).toBe(100); // 99 chars + ellipsis keeps the preview within the width budget
      expect(result.endsWith("…")).toBe(true);
    });

    it("truncates to max lines", () => {
      const input = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      const result = getTruncatedPreview(input);

      // Should only show first 2 lines (PREVIEW_MAX_LINES = 2)
      expect(result).toBe("Line 1\nLine 2…");
    });

    it("adds ellipsis when lines are truncated", () => {
      const input = "Line 1\nLine 2\nLine 3";
      const result = getTruncatedPreview(input);

      expect(result.endsWith("…")).toBe(true);
    });

    it("does not add ellipsis when all lines fit", () => {
      const input = "Line 1\nLine 2";
      const result = getTruncatedPreview(input);

      expect(result).toBe("Line 1\nLine 2");
      expect(result.endsWith("…")).toBe(false);
    });

    it("handles single line within limits", () => {
      const input = "Single line";
      const result = getTruncatedPreview(input);

      expect(result).toBe("Single line");
    });

    it("handles empty string", () => {
      const result = getTruncatedPreview("");
      expect(result).toBe("");
    });

    it("truncates by chars even within line limit", () => {
      // Two lines but very long content
      const longLine = "x".repeat(80);
      const input = `${longLine}\n${longLine}`;
      const result = getTruncatedPreview(input);

      expect(result.length).toBe(101); // 100 + ellipsis
      expect(result.endsWith("…")).toBe(true);
    });

    it("truncates by display width for wide characters", () => {
      const input = "界".repeat(60);
      const result = getTruncatedPreview(input);

      expect(result.endsWith("…")).toBe(true);
      expect(result.length).toBeLessThan(input.length);
    });
  });
});
