import { describe, expect, it } from "vitest";
import {
  assertTaskOutputArtifact,
  parseTaskTranscriptEntry,
  replayTaskTranscript,
} from "./task-output-protocol.js";

describe("task output protocol", () => {
  it("rejects invalid task output artifacts", () => {
    expect(() =>
      assertTaskOutputArtifact({
        task_id: "",
        task_type: "shell",
        status: "running",
        description: "bad",
      }),
    ).toThrow(/Invalid task output artifact/i);
  });

  it("rejects unknown transcript discriminants", () => {
    expect(
      parseTaskTranscriptEntry({
        type: "mystery",
        task_id: "task-1",
      }),
    ).toBeNull();
  });

  it("accepts legacy shell headers for backward compatibility", () => {
    const entry = parseTaskTranscriptEntry({
      type: "shell_task",
      task_id: "task-1",
      task_type: "shell",
      command: "echo hello",
      started_at: 1,
    });

    expect(entry).toEqual({
      type: "task_header",
      task_id: "task-1",
      task_type: "shell",
      command: "echo hello",
      description: "echo hello",
      started_at: 1,
    });
  });

  it("replays transcripts deterministically", () => {
    const entries = [
      parseTaskTranscriptEntry({
        type: "task_header",
        task_id: "task-1",
        task_type: "shell",
        command: "printf hello",
        started_at: 1,
      }),
      parseTaskTranscriptEntry({
        type: "stdout",
        task_id: "task-1",
        task_type: "shell",
        ts: 2,
        chunk: "hello\n",
      }),
      parseTaskTranscriptEntry({
        type: "exit",
        task_id: "task-1",
        task_type: "shell",
        ts: 3,
        status: "completed",
        terminal_reason: "completed",
        exit_code: 0,
      }),
    ].filter(Boolean);

    const first = replayTaskTranscript(entries);
    const second = replayTaskTranscript(entries);

    expect(first).toEqual(second);
    expect(first).toEqual({
      task_id: "task-1",
      task_type: "shell",
      status: "success",
      description: "printf hello",
      prompt: "printf hello",
      stdout: "hello\n",
      exit_code: 0,
      error: undefined,
    });
  });

  it("lets newer stream and exit entries override older snapshots", () => {
    const entries = [
      parseTaskTranscriptEntry({
        type: "snapshot",
        ts: 10,
        task: {
          task_id: "task-2",
          task_type: "shell",
          status: "running",
          description: "echo test",
          stdout: "before\n",
          prompt: "echo test",
        },
      }),
      parseTaskTranscriptEntry({
        type: "stdout",
        task_id: "task-2",
        task_type: "shell",
        ts: 11,
        chunk: "after\n",
      }),
      parseTaskTranscriptEntry({
        type: "exit",
        task_id: "task-2",
        task_type: "shell",
        ts: 12,
        status: "killed",
        terminal_reason: "cancelled",
        error: "aborted",
        exit_code: null,
      }),
    ].filter(Boolean);

    expect(replayTaskTranscript(entries)).toEqual({
      task_id: "task-2",
      task_type: "shell",
      status: "cancelled",
      description: "echo test",
      prompt: "echo test",
      stdout: "before\nafter\n",
      exit_code: null,
      error: "aborted",
    });
  });
});
