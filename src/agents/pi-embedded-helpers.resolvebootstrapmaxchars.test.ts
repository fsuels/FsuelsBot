import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { DEFAULT_BOOTSTRAP_MAX_CHARS, resolveBootstrapMaxChars } from "./pi-embedded-helpers.js";
import { DEFAULT_AGENTS_FILENAME } from "./workspace.js";

const _makeFile = (overrides: Partial<WorkspaceBootstrapFile>): WorkspaceBootstrapFile => ({
  name: DEFAULT_AGENTS_FILENAME,
  path: "/tmp/AGENTS.md",
  content: "",
  missing: false,
  ...overrides,
});
describe("resolveBootstrapMaxChars", () => {
  it("returns default when unset", () => {
    expect(resolveBootstrapMaxChars()).toBe(DEFAULT_BOOTSTRAP_MAX_CHARS);
  });
  it("uses configured value when valid", () => {
    const cfg = {
      agents: { defaults: { bootstrapMaxChars: 12345 } },
    } as OpenClawConfig;
    expect(resolveBootstrapMaxChars(cfg)).toBe(12345);
  });
  it("falls back when invalid", () => {
    const cfg = {
      agents: { defaults: { bootstrapMaxChars: -1 } },
    } as OpenClawConfig;
    expect(resolveBootstrapMaxChars(cfg)).toBe(DEFAULT_BOOTSTRAP_MAX_CHARS);
  });
  it("uses per-provider override when set", () => {
    const cfg = {
      agents: { defaults: { bootstrapMaxChars: 20000 } },
      models: {
        providers: {
          lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", models: [], bootstrapMaxChars: 4000 },
        },
      },
    } as MoltbotConfig;
    expect(resolveBootstrapMaxChars(cfg, "lmstudio")).toBe(4000);
  });
  it("falls back to global when provider has no override", () => {
    const cfg = {
      agents: { defaults: { bootstrapMaxChars: 15000 } },
      models: { providers: { lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", models: [] } } },
    } as MoltbotConfig;
    expect(resolveBootstrapMaxChars(cfg, "lmstudio")).toBe(15000);
  });
  it("falls back to global when provider not found", () => {
    const cfg = {
      agents: { defaults: { bootstrapMaxChars: 15000 } },
    } as MoltbotConfig;
    expect(resolveBootstrapMaxChars(cfg, "unknown")).toBe(15000);
  });
});
