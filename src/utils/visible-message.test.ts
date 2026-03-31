import { describe, expect, it } from "vitest";
import {
  buildVisibleAttachmentsFromMediaUrls,
  extractVisibleAttachmentName,
  extractVisibleMessageMeta,
  formatVisibleAttachmentLabel,
  formatVisibleAttachmentSize,
  inferVisibleAttachmentKind,
} from "./visible-message.js";

describe("extractVisibleAttachmentName", () => {
  it("extracts decoded names from URLs", () => {
    expect(
      extractVisibleAttachmentName("https://example.com/files/report%20final.pdf?sig=1#x"),
    ).toBe("report final.pdf");
  });

  it("extracts names from local paths", () => {
    expect(extractVisibleAttachmentName("./tmp/screenshots/chart.png")).toBe("chart.png");
  });
});

describe("inferVisibleAttachmentKind", () => {
  it("prefers mime type when present", () => {
    expect(inferVisibleAttachmentKind({ mimeType: "image/jpeg" })).toBe("image");
  });

  it("falls back to filename extension", () => {
    expect(inferVisibleAttachmentKind({ source: "https://example.com/report.pdf" })).toBe("file");
    expect(inferVisibleAttachmentKind({ source: "https://example.com/photo.webp?x=1" })).toBe(
      "image",
    );
  });
});

describe("buildVisibleAttachmentsFromMediaUrls", () => {
  it("builds deduplicated visible attachment metadata", () => {
    expect(
      buildVisibleAttachmentsFromMediaUrls([
        "https://example.com/photo.png",
        "https://example.com/photo.png",
        "./files/report.pdf",
      ]),
    ).toEqual([
      {
        kind: "image",
        name: "photo.png",
        source: "https://example.com/photo.png",
      },
      {
        kind: "file",
        name: "report.pdf",
        source: "./files/report.pdf",
      },
    ]);
  });
});

describe("formatVisibleAttachmentSize", () => {
  it("formats common byte ranges", () => {
    expect(formatVisibleAttachmentSize(999)).toBe("999 B");
    expect(formatVisibleAttachmentSize(1536)).toBe("1.5 KB");
    expect(formatVisibleAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatVisibleAttachmentLabel", () => {
  it("formats compact attachment labels", () => {
    expect(
      formatVisibleAttachmentLabel({
        kind: "image",
        name: "chart.png",
        source: "https://example.com/chart.png",
      }),
    ).toBe("[image] chart.png");
  });
});

describe("extractVisibleMessageMeta", () => {
  it("reads valid metadata and ignores malformed entries", () => {
    expect(
      extractVisibleMessageMeta({
        openclawVisible: {
          status: "proactive",
          sentAt: "2026-03-31T12:34:56.000Z",
          attachments: [
            {
              kind: "image",
              name: "chart.png",
              source: "https://example.com/chart.png",
            },
            {
              kind: "file",
              name: "",
              source: "https://example.com/bad",
            },
          ],
        },
      }),
    ).toEqual({
      status: "proactive",
      sentAt: "2026-03-31T12:34:56.000Z",
      attachments: [
        {
          kind: "image",
          name: "chart.png",
          source: "https://example.com/chart.png",
          mimeType: undefined,
          sizeBytes: undefined,
        },
      ],
    });
  });
});
