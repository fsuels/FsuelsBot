import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

import type { GatewayModelChoice, SessionsListResult } from "../types";
import { renderSessions, type SessionsProps } from "./sessions";

function createResult(model?: string): SessionsListResult {
  return {
    ts: 0,
    path: "sessions.json",
    count: 1,
    defaults: { model: "anthropic/claude-opus-4-5", contextTokens: 200_000 },
    sessions: [
      {
        key: "main",
        kind: "direct",
        updatedAt: Date.now(),
        model,
      },
    ],
  };
}

function createProps(overrides: Partial<SessionsProps> = {}): SessionsProps {
  const models: GatewayModelChoice[] = [
    { provider: "anthropic", id: "claude-opus-4-5", name: "Opus" },
    { provider: "openai-codex", id: "gpt-5.2", name: "GPT-5.2" },
  ];
  return {
    loading: false,
    result: createResult(),
    models,
    error: null,
    activeMinutes: "",
    limit: "120",
    includeGlobal: true,
    includeUnknown: false,
    basePath: "",
    onFiltersChange: () => undefined,
    onRefresh: () => undefined,
    onPatch: () => undefined,
    onDelete: () => undefined,
    ...overrides,
  };
}

describe("sessions view", () => {
  it("renders when sessions.list response omits defaults", () => {
    const container = document.createElement("div");
    const resultWithoutDefaults = {
      ts: 0,
      path: "sessions.json",
      count: 1,
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: Date.now(),
        },
      ],
    } as unknown as SessionsListResult;

    render(
      renderSessions(
        createProps({
          result: resultWithoutDefaults,
        }),
      ),
      container,
    );

    expect(container.querySelector(".table-head")).not.toBeNull();
    expect(container.querySelector('select[data-session-model="main"]')).not.toBeNull();
  });

  it("sends model override from dropdown", () => {
    const container = document.createElement("div");
    const onPatch = vi.fn();
    render(renderSessions(createProps({ onPatch })), container);

    const modelSelect = container.querySelector(
      'select[data-session-model="main"]',
    ) as HTMLSelectElement | null;
    expect(modelSelect).not.toBeNull();
    modelSelect!.value = "openai-codex/gpt-5.2";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onPatch).toHaveBeenCalledWith("main", { model: "openai-codex/gpt-5.2" });
  });

  it("sends null model when returning to inherit", () => {
    const container = document.createElement("div");
    const onPatch = vi.fn();
    render(
      renderSessions(
        createProps({
          onPatch,
          result: createResult("openai-codex/gpt-5.2"),
        }),
      ),
      container,
    );

    const modelSelect = container.querySelector(
      'select[data-session-model="main"]',
    ) as HTMLSelectElement | null;
    expect(modelSelect).not.toBeNull();
    modelSelect!.value = "";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onPatch).toHaveBeenCalledWith("main", { model: null });
  });
});
