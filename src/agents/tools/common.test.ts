import { describe, expect, it } from "vitest";
import {
  assertKnownParams,
  createActionGate,
  formatStructuredResultForModel,
  readAliasedStringParam,
  readNumberParam,
  readReactionParams,
  readStringOrNumberParam,
} from "./common.js";

type TestActions = {
  reactions?: boolean;
  messages?: boolean;
};

describe("createActionGate", () => {
  it("defaults to enabled when unset", () => {
    const gate = createActionGate<TestActions>(undefined);
    expect(gate("reactions")).toBe(true);
    expect(gate("messages", false)).toBe(false);
  });

  it("respects explicit false", () => {
    const gate = createActionGate<TestActions>({ reactions: false });
    expect(gate("reactions")).toBe(false);
    expect(gate("messages")).toBe(true);
  });
});

describe("readStringOrNumberParam", () => {
  it("returns numeric strings for numbers", () => {
    const params = { chatId: 123 };
    expect(readStringOrNumberParam(params, "chatId")).toBe("123");
  });

  it("trims strings", () => {
    const params = { chatId: "  abc  " };
    expect(readStringOrNumberParam(params, "chatId")).toBe("abc");
  });

  it("throws when required and missing", () => {
    expect(() => readStringOrNumberParam({}, "chatId", { required: true })).toThrow(
      /chatId required/,
    );
  });
});

describe("readNumberParam", () => {
  it("parses numeric strings", () => {
    const params = { messageId: "42" };
    expect(readNumberParam(params, "messageId")).toBe(42);
  });

  it("truncates when integer is true", () => {
    const params = { messageId: "42.9" };
    expect(readNumberParam(params, "messageId", { integer: true })).toBe(42);
  });

  it("throws when required and missing", () => {
    expect(() => readNumberParam({}, "messageId", { required: true })).toThrow(
      /messageId required/,
    );
  });
});

describe("readAliasedStringParam", () => {
  it("prefers the primary key when both forms match", () => {
    const result = readAliasedStringParam(
      {
        sessionId: "new-id",
        shell_id: "new-id",
      },
      {
        primaryKey: "sessionId",
        aliasKeys: ["shell_id"],
        required: true,
        label: "sessionId",
      },
    );

    expect(result).toEqual({
      value: "new-id",
      sourceKey: "sessionId",
      usedAlias: false,
    });
  });

  it("falls back to a deprecated alias", () => {
    const result = readAliasedStringParam(
      {
        shell_id: "legacy-id",
      },
      {
        primaryKey: "sessionId",
        aliasKeys: ["shell_id"],
        required: true,
        label: "sessionId",
      },
    );

    expect(result).toEqual({
      value: "legacy-id",
      sourceKey: "shell_id",
      usedAlias: true,
    });
  });

  it("rejects conflicting alias values", () => {
    expect(() =>
      readAliasedStringParam(
        {
          sessionId: "new-id",
          shell_id: "old-id",
        },
        {
          primaryKey: "sessionId",
          aliasKeys: ["shell_id"],
          required: true,
          label: "sessionId",
        },
      ),
    ).toThrow(/conflicts with deprecated alias shell_id/);
  });
});

describe("assertKnownParams", () => {
  it("accepts known keys", () => {
    expect(() =>
      assertKnownParams({ action: "list", limit: 2 }, ["action", "limit"]),
    ).not.toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() =>
      assertKnownParams({ action: "list", bogus: true }, ["action"], { label: "tool" }),
    ).toThrow(/Unknown tool parameter: bogus/);
  });
});

describe("readReactionParams", () => {
  it("allows empty emoji for removal semantics", () => {
    const params = { emoji: "" };
    const result = readReactionParams(params, {
      removeErrorMessage: "Emoji is required",
    });
    expect(result.isEmpty).toBe(true);
    expect(result.remove).toBe(false);
  });

  it("throws when remove true but emoji empty", () => {
    const params = { emoji: "", remove: true };
    expect(() =>
      readReactionParams(params, {
        removeErrorMessage: "Emoji is required",
      }),
    ).toThrow(/Emoji is required/);
  });

  it("passes through remove flag", () => {
    const params = { emoji: "✅", remove: true };
    const result = readReactionParams(params, {
      removeErrorMessage: "Emoji is required",
    });
    expect(result.remove).toBe(true);
    expect(result.emoji).toBe("✅");
  });
});

describe("formatStructuredResultForModel", () => {
  it("returns a concise empty-state message when configured", () => {
    const text = formatStructuredResultForModel(
      { count: 0, items: [] },
      {
        isEmpty: (payload) => payload.count === 0,
        emptyMessage: "No sessions matched the current filters.",
      },
    );

    expect(text).toBe("No sessions matched the current filters.");
  });

  it("returns compact JSON when the payload fits", () => {
    const text = formatStructuredResultForModel({
      requester: "main",
      agents: [{ id: "main" }],
    });

    expect(text).toBe('{"requester":"main","agents":[{"id":"main"}]}');
  });

  it("uses a summary payload when the full result is too large", () => {
    const text = formatStructuredResultForModel(
      {
        count: 20,
        sessions: Array.from({ length: 20 }, (_, index) => ({
          key: `session-${index}`,
          text: "x".repeat(400),
        })),
      },
      {
        maxChars: 120,
        summarize: (payload) => ({
          count: payload.count,
          truncated: true,
          sessions: payload.sessions.slice(0, 2).map((session) => session.key),
        }),
      },
    );

    expect(JSON.parse(text)).toEqual({
      count: 20,
      truncated: true,
      sessions: ["session-0", "session-1"],
    });
  });
});
