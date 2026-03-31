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
import { createAskUserQuestionTool } from "./ask-user-question-tool.js";

function createConfig(storePath: string) {
  return {
    session: {
      store: storePath,
    },
  };
}

describe("ask_user_question tool", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    clearSessionStoreCacheForTest();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists pending clarification for interactive tool-result flows", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-user-question-"));
    tempDirs.push(tempDir);
    const storePath = path.join(tempDir, "sessions.json");
    const sessionKey = "agent:main:main";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: "session-1",
        updatedAt: Date.now(),
      } satisfies SessionEntry,
    });

    const tool = createAskUserQuestionTool({
      agentSessionKey: sessionKey,
      config: createConfig(storePath),
    });

    const result = await tool.execute("call-1", {
      questions: [
        {
          id: "layout",
          header: "Layout",
          question: "Which layout should I use?",
          options: [
            { id: "cards", label: "Cards", description: "Compact cards." },
            { id: "table", label: "Table", description: "Dense table." },
          ],
        },
      ],
    });

    expect((result.details as { status?: string }).status).toBe("asked");
    const store = loadSessionStore(storePath);
    expect(store[sessionKey]?.pendingClarification?.questions[0]?.id).toBe("layout");
    expect(store[sessionKey]?.clarificationTelemetry?.at(-1)?.status).toBe("asked");
  });

  it("falls back to assumptions for non-interactive sessions", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-user-question-"));
    tempDirs.push(tempDir);
    const storePath = path.join(tempDir, "sessions.json");
    const sessionKey = "agent:main:cron:job-1";
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: "session-1",
        updatedAt: Date.now(),
      } satisfies SessionEntry,
    });

    const tool = createAskUserQuestionTool({
      agentSessionKey: sessionKey,
      config: createConfig(storePath),
    });

    const result = await tool.execute("call-1", {
      questions: [
        {
          id: "layout",
          header: "Layout",
          question: "Which layout should I use?",
          recommendedOptionId: "table",
          options: [
            { id: "cards", label: "Cards", description: "Compact cards." },
            { id: "table", label: "Table", description: "Dense table." },
          ],
        },
      ],
    });

    const details = result.details as {
      status?: string;
      answers?: Array<{ questionId: string; selectedOptionIds: string[] }>;
    };
    expect(details.status).toBe("assumed");
    expect(details.answers).toEqual([
      {
        questionId: "layout",
        selectedOptionIds: ["table"],
      },
    ]);

    const store = loadSessionStore(storePath);
    expect(store[sessionKey]?.pendingClarification).toBeUndefined();
    expect(store[sessionKey]?.clarificationTelemetry?.at(-1)?.status).toBe("assumed");
  });
});
