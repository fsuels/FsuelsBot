import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: { list: [{ id: "main", default: true }] },
    session: {},
  })),
}));

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    readSessionPreviewItemsFromTranscript: vi.fn(() => [
      { role: "user", text: "Recovered preview" },
    ]),
  };
});

import { readSessionPreviewItemsFromTranscript } from "../session-utils.js";
import { sessionsHandlers } from "./sessions.js";

describe("sessions.preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports transcript-only synthetic session keys", async () => {
    const respond = vi.fn();

    await sessionsHandlers["sessions.preview"]({
      respond,
      params: { keys: ["agent:main:sess-recovered"], limit: 3, maxChars: 120 },
    } as unknown as Parameters<(typeof sessionsHandlers)["sessions.preview"]>[0]);

    expect(vi.mocked(readSessionPreviewItemsFromTranscript)).toHaveBeenCalledWith(
      "sess-recovered",
      expect.any(String),
      undefined,
      "main",
      3,
      120,
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        previews: [
          expect.objectContaining({
            key: "agent:main:sess-recovered",
            status: "ok",
            items: [{ role: "user", text: "Recovered preview" }],
          }),
        ],
      }),
      undefined,
    );
  });
});
