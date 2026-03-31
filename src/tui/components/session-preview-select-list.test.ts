import { describe, expect, it, vi } from "vitest";
import {
  SessionPreviewSelectList,
  classifySessionPreviewError,
  type SessionPreviewEntry,
  type SessionPreviewSelectListTheme,
} from "./session-preview-select-list.js";

const mockTheme: SessionPreviewSelectListTheme = {
  selectedPrefix: (text) => `[${text}]`,
  selectedText: (text) => `**${text}**`,
  description: (text) => `(${text})`,
  scrollInfo: (text) => `~${text}~`,
  noMatch: (text) => `!${text}!`,
  filterLabel: (text) => text,
  previewLabel: (text) => text,
  previewMeta: (text) => text,
  previewRole: (text) => text,
  previewText: (text) => text,
  hint: (text) => text,
  loading: (text) => text,
  error: (text) => text,
};

const items = [
  { value: "alpha", label: "Alpha", description: "First session" },
  { value: "beta", label: "Beta", description: "Second session" },
];

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SessionPreviewSelectList", () => {
  it("suppresses stale preview responses when focus changes quickly", async () => {
    const alpha = createDeferred<SessionPreviewEntry>();
    const beta = createDeferred<SessionPreviewEntry>();
    const requestRender = vi.fn();
    const loadPreview = vi.fn((key: string) => (key === "alpha" ? alpha.promise : beta.promise));

    const list = new SessionPreviewSelectList({
      items,
      maxVisible: 4,
      theme: mockTheme,
      loadPreview,
      requestRender,
    });

    expect(loadPreview).toHaveBeenCalledWith("alpha");

    list.handleInput("\x1b[B");
    expect(loadPreview).toHaveBeenCalledWith("beta");

    beta.resolve({
      key: "beta",
      status: "ok",
      items: [{ role: "assistant", text: "beta preview wins" }],
    });
    await Promise.resolve();

    expect(list.render(80).join("\n")).toContain("beta preview wins");

    alpha.resolve({
      key: "alpha",
      status: "ok",
      items: [{ role: "assistant", text: "stale alpha preview" }],
    });
    await Promise.resolve();

    const output = list.render(80).join("\n");
    expect(output).toContain("beta preview wins");
    expect(output).not.toContain("stale alpha preview");
  });

  it("keeps the previous preview visible while a new selection is still loading", async () => {
    const alpha = createDeferred<SessionPreviewEntry>();
    const beta = createDeferred<SessionPreviewEntry>();
    const list = new SessionPreviewSelectList({
      items,
      maxVisible: 4,
      theme: mockTheme,
      loadPreview: (key) => (key === "alpha" ? alpha.promise : beta.promise),
      requestRender: vi.fn(),
    });

    alpha.resolve({
      key: "alpha",
      status: "ok",
      items: [{ role: "user", text: "alpha transcript" }],
    });
    await Promise.resolve();

    list.handleInput("\x1b[B");

    const output = list.render(80).join("\n");
    expect(output).toContain("Loading preview for the current selection");
    expect(output).toContain("alpha transcript");
    expect(output).toContain("Preview shown for alpha");
  });

  it("retries preview loading with Ctrl+R after an error", async () => {
    const requestRender = vi.fn();
    const loadPreview = vi
      .fn((key: string) =>
        Promise.resolve<SessionPreviewEntry>({ key, status: "empty", items: [] }),
      )
      .mockRejectedValueOnce(new Error("gateway not connected"))
      .mockResolvedValueOnce({
        key: "alpha",
        status: "ok",
        items: [{ role: "assistant", text: "preview recovered" }],
      });

    const list = new SessionPreviewSelectList({
      items,
      maxVisible: 4,
      theme: mockTheme,
      loadPreview,
      requestRender,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(list.render(80).join("\n")).toContain("Gateway connectivity failed");

    list.handleInput("\x12");
    await Promise.resolve();
    await Promise.resolve();

    expect(loadPreview).toHaveBeenCalledTimes(2);
    expect(list.render(80).join("\n")).toContain("preview recovered");
  });

  it("resumes the focused session on confirm", () => {
    let selectedValue: string | undefined;
    const list = new SessionPreviewSelectList({
      items,
      maxVisible: 4,
      theme: mockTheme,
      loadPreview: async (key) => ({ key, status: "empty", items: [] }),
      requestRender: vi.fn(),
    });
    list.onSelect = (item) => {
      selectedValue = item.value;
    };

    list.handleInput("\r");

    expect(selectedValue).toBe("alpha");
  });
});

describe("classifySessionPreviewError", () => {
  it("classifies auth errors", () => {
    expect(classifySessionPreviewError(new Error("unauthorized"))).toMatchObject({
      kind: "auth",
    });
  });

  it("classifies api errors", () => {
    expect(classifySessionPreviewError(new Error("invalid request params"))).toMatchObject({
      kind: "api",
    });
  });
});
