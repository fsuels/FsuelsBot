import { describe, expect, it } from "vitest";
import { createAbortControllerWithParents } from "./abort-tree.js";

describe("abort tree helpers", () => {
  it("aborts the child when the parent aborts", () => {
    const parent = new AbortController();
    const linked = createAbortControllerWithParents([parent.signal]);

    parent.abort(new Error("parent-abort"));

    expect(linked.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(true);
  });

  it("does not abort the parent when the child aborts", () => {
    const parent = new AbortController();
    const linked = createAbortControllerWithParents([parent.signal]);

    linked.controller.abort(new Error("child-abort"));

    expect(linked.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  it("removes parent listeners when disposed", () => {
    const parent = new AbortController();
    const linked = createAbortControllerWithParents([parent.signal]);

    linked.dispose();
    parent.abort(new Error("late-parent-abort"));

    expect(linked.signal.aborted).toBe(false);
  });
});
