import { describe, expect, it } from "vitest";

import {
  classifyMemoryPath,
  resolveTaskMemoryDirPath,
  resolveTaskMemoryFilePath,
} from "./namespaces.js";

describe("memory namespaces", () => {
  it("classifies task and global memory paths", () => {
    expect(classifyMemoryPath("memory/tasks/task-a.md")).toEqual({
      namespace: "task",
      taskId: "task-a",
    });
    expect(classifyMemoryPath("memory/tasks/task-a/notes.md")).toEqual({
      namespace: "task",
      taskId: "task-a",
    });
    expect(classifyMemoryPath("memory/global/decisions.md")).toEqual({ namespace: "global" });
    expect(classifyMemoryPath("MEMORY.md")).toEqual({ namespace: "global" });
    expect(classifyMemoryPath("memory/2026-02-02.md")).toEqual({ namespace: "legacy" });
  });

  it("resolves task memory namespace paths", () => {
    expect(resolveTaskMemoryFilePath("task-a")).toBe("memory/tasks/task-a.md");
    expect(resolveTaskMemoryDirPath("task-a")).toBe("memory/tasks/task-a");
    expect(resolveTaskMemoryFilePath("../task/a")).toBe("memory/tasks/-task-a.md");
    expect(resolveTaskMemoryDirPath("task%a")).toBe("memory/tasks/task-a");
  });
});
