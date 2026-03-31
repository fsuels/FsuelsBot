import { describe, expect, it } from "vitest";
import { formatToolExecutionMeta, resolveToolExecutionState } from "./tool-execution.js";

describe("tool execution progress helpers", () => {
  it("treats running partial results as pending", () => {
    expect(
      resolveToolExecutionState({
        isPartial: true,
        isError: false,
      }),
    ).toEqual({
      tone: "pending",
      titleSuffix: "running",
    });
  });

  it("keeps background task statuses visible after the tool returns", () => {
    expect(
      resolveToolExecutionState({
        isPartial: false,
        isError: false,
        status: "awaiting_input",
      }),
    ).toEqual({
      tone: "pending",
      titleSuffix: "backgrounded",
      statusLabel: "awaiting input",
    });
  });

  it("renders timeout as an explicit failure state", () => {
    expect(
      resolveToolExecutionState({
        isPartial: false,
        isError: false,
        status: "timeout",
      }),
    ).toEqual({
      tone: "error",
      titleSuffix: "timed out",
      statusLabel: "timeout",
    });
  });

  it("preserves non-terminal success metadata like accepted", () => {
    expect(
      resolveToolExecutionState({
        isPartial: false,
        isError: false,
        status: "accepted",
      }),
    ).toEqual({
      tone: "success",
      statusLabel: "accepted",
    });
  });

  it("formats compact status metadata with elapsed time and error summary", () => {
    expect(
      formatToolExecutionMeta({
        statusLabel: "awaiting input",
        elapsedMs: 65_000,
        errorSummary: "Need explicit user confirmation before continuing.\nignored second line",
      }),
    ).toBe("awaiting input · 1m 5s · Need explicit user confirmation before continuing.");
  });
});
