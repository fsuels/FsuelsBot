import { describe, expect, it, vi } from "vitest";

import type { SessionsListResult } from "../types";
import { loadSessions, patchSession, type SessionsState } from "./sessions";

function createSessionsResult(): SessionsListResult {
  return {
    ts: 0,
    path: "sessions.json",
    count: 0,
    defaults: { model: "openai-codex/gpt-5.2", contextTokens: 200_000 },
    sessions: [],
  };
}

function createState(request: (method: string, params: unknown) => Promise<unknown>): SessionsState {
  return {
    client: { request } as unknown as SessionsState["client"],
    connected: true,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsModels: [],
    sessionsError: null,
    sessionsFilterActive: "",
    sessionsFilterLimit: "120",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: false,
  };
}

describe("sessions controller", () => {
  it("loads sessions and model catalog together", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.list") return createSessionsResult();
      if (method === "models.list") {
        return {
          models: [
            { provider: "openai-codex", id: "gpt-5.2", name: "GPT-5.2" },
          ],
        };
      }
      return {};
    });
    const state = createState(request);

    await loadSessions(state);

    expect(request).toHaveBeenCalledWith("sessions.list", {
      includeGlobal: true,
      includeUnknown: false,
      limit: 120,
    });
    expect(request).toHaveBeenCalledWith("models.list", {});
    expect(state.sessionsResult?.defaults.model).toBe("openai-codex/gpt-5.2");
    expect(state.sessionsModels).toEqual([
      { provider: "openai-codex", id: "gpt-5.2", name: "GPT-5.2" },
    ]);
  });

  it("sends model updates through sessions.patch", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.list") return createSessionsResult();
      if (method === "models.list") return { models: [] };
      return {};
    });
    const state = createState(request);

    await patchSession(state, "main", { model: "openai-codex/gpt-5.2" });

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "openai-codex/gpt-5.2",
    });
  });
});
