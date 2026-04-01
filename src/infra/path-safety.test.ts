import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoNullBytes,
  containsPathTraversal,
  expandPath,
  isWindowsUncPath,
  normalizePathForConfigKey,
  resolvePathAgainstBase,
} from "./path-safety.js";

describe("path-safety", () => {
  it("expands home-relative POSIX paths", () => {
    expect(expandPath("~/project/file.txt", { homeDir: "/Users/test", platform: "darwin" })).toBe(
      "/Users/test/project/file.txt",
    );
  });

  it("resolves relative paths against a base directory", () => {
    expect(
      resolvePathAgainstBase("src/index.ts", "/repo", {
        platform: "darwin",
      }),
    ).toBe(path.resolve("/repo", "src/index.ts"));
  });

  it("preserves Windows absolute paths", () => {
    expect(
      resolvePathAgainstBase("C:\\Users\\test\\file.txt", "D:\\workspace", {
        platform: "win32",
      }),
    ).toBe(path.win32.normalize("C:\\Users\\test\\file.txt"));
  });

  it("converts MinGW paths on Windows", () => {
    expect(
      resolvePathAgainstBase("/c/Users/test/file.txt", "D:\\workspace", {
        platform: "win32",
      }),
    ).toBe(path.win32.normalize("C:\\Users\\test\\file.txt"));
  });

  it("detects traversal attempts across separators", () => {
    expect(containsPathTraversal("../secret.txt")).toBe(true);
    expect(containsPathTraversal("notes\\..\\secret.txt")).toBe(true);
    expect(containsPathTraversal("notes/final.txt")).toBe(false);
  });

  it("detects UNC/network share paths", () => {
    expect(isWindowsUncPath("\\\\server\\share\\file.txt")).toBe(true);
    expect(isWindowsUncPath("//server/share/file.txt")).toBe(true);
    expect(isWindowsUncPath("C:\\Users\\test\\file.txt")).toBe(false);
  });

  it("normalizes config keys consistently across platforms", () => {
    expect(normalizePathForConfigKey("C:\\Temp\\File.txt\\", { platform: "win32" })).toBe(
      "c:/Temp/File.txt",
    );
    expect(normalizePathForConfigKey("/tmp/example/", { platform: "darwin" })).toBe("/tmp/example");
  });

  it("rejects null bytes in paths", () => {
    expect(() => assertNoNullBytes("bad\0path")).toThrow(/null byte/i);
  });

  it("supports @-prefixed edit paths via stripAtPrefix", () => {
    expect(
      resolvePathAgainstBase("@README.md", path.join(os.tmpdir(), "repo"), {
        platform: "darwin",
        stripAtPrefix: true,
      }),
    ).toBe(path.join(os.tmpdir(), "repo", "README.md"));
  });
});
