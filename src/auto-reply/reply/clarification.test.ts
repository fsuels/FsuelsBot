import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionStoreCacheForTest,
  loadSessionStore,
  saveSessionStore,
  type SessionEntry,
} from "../../config/sessions.js";
import { resolveInboundClarification } from "./clarification.js";

describe("reply clarification resume", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    clearSessionStoreCacheForTest();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves pending clarification answers and injects structured JSON", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-clarification-"));
    tempDirs.push(tempDir);
    const storePath = path.join(tempDir, "sessions.json");
    const sessionKey = "agent:main:main";
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      pendingClarification: {
        promptId: "abc12345",
        askedAt: Date.now() - 1000,
        promptText: "prompt",
        delivery: {
          transport: "tool_result",
          interactiveUi: true,
          fallbackUsed: true,
        },
        questions: [
          {
            id: "layout",
            header: "Layout",
            question: "Which layout should I use?",
            multiSelect: false,
            allowOther: true,
            recommendedOptionId: "cards",
            options: [
              {
                id: "cards",
                label: "Cards",
                description: "Compact cards.",
              },
              {
                id: "table",
                label: "Table",
                description: "Dense table.",
              },
            ],
          },
        ],
      },
    };
    await saveSessionStore(storePath, { [sessionKey]: entry });

    const sessionStore = loadSessionStore(storePath);
    const result = await resolveInboundClarification({
      sessionEntry: sessionStore[sessionKey],
      sessionStore,
      sessionKey,
      storePath,
      sessionCtx: {
        BodyStripped: "2",
      },
    });

    expect(result.injectedBody).toContain("ask_user_question_result");
    expect(result.injectedBody).toContain('"questionId": "layout"');
    expect(result.injectedBody).toContain('"selectedOptionIds": [');

    const refreshed = loadSessionStore(storePath);
    expect(refreshed[sessionKey]?.pendingClarification).toBeUndefined();
    expect(refreshed[sessionKey]?.clarificationTelemetry?.at(-1)?.status).toBe("answered");
  });

  it("records decline flows cleanly", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-clarification-"));
    tempDirs.push(tempDir);
    const storePath = path.join(tempDir, "sessions.json");
    const sessionKey = "agent:main:main";
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      pendingClarification: {
        promptId: "abc12345",
        askedAt: Date.now() - 1000,
        promptText: "prompt",
        delivery: {
          transport: "tool_result",
          interactiveUi: true,
          fallbackUsed: true,
        },
        questions: [
          {
            id: "layout",
            header: "Layout",
            question: "Which layout should I use?",
            multiSelect: false,
            allowOther: true,
            options: [
              {
                id: "cards",
                label: "Cards",
                description: "Compact cards.",
              },
              {
                id: "table",
                label: "Table",
                description: "Dense table.",
              },
            ],
          },
        ],
      },
    };
    await saveSessionStore(storePath, { [sessionKey]: entry });

    const result = await resolveInboundClarification({
      sessionEntry: entry,
      sessionKey,
      storePath,
      sessionCtx: {
        BodyStripped: "decline",
      },
    });

    expect(result.injectedBody).toContain("safest default");
    const refreshed = loadSessionStore(storePath);
    expect(refreshed[sessionKey]?.pendingClarification).toBeUndefined();
    expect(refreshed[sessionKey]?.clarificationTelemetry?.at(-1)?.status).toBe("declined");
  });
});
