import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecCommandSegment } from "../infra/exec-approvals.js";
import { resolveSystemRunPermission } from "./system-run-permissions.js";

function makeSegment(raw: string, argv: string[], resolvedPath?: string): ExecCommandSegment {
  return {
    raw,
    argv,
    resolution: resolvedPath
      ? {
          rawExecutable: argv[0] ?? "",
          executableName: path.basename(resolvedPath),
          resolvedPath,
        }
      : null,
  };
}

function makeContext() {
  return {
    argv: ["ls", "-la"],
    rawCommand: null,
    security: "allowlist" as const,
    ask: "on-miss" as const,
    analysisOk: true,
    analysisReason: undefined,
    allowlistSatisfied: true,
    allowlistMatches: [{ pattern: "/bin/ls" }],
    segments: [makeSegment("ls -la", ["ls", "-la"], "/bin/ls")],
    approvalDecision: null,
    approved: null,
    needsScreenRecording: false,
    platform: "darwin",
  };
}

describe("resolveSystemRunPermission", () => {
  it("allows commands that match the allowlist without manual approval", () => {
    const result = resolveSystemRunPermission(makeContext());

    expect(result.state).toBe("allow");
    expect(result.reasonCode).toBe("allowlist-match");
    expect(result.reasonText).toContain("allowlist");
    expect(result.trace.allowlistMatchedPatterns).toEqual(["/bin/ls"]);
    expect(result.trace.approvedByAsk).toBe(false);
    if (result.state !== "allow") {
      throw new Error("expected allow decision");
    }
    expect(result.execArgv).toEqual(["ls", "-la"]);
    expect(result.allowAlwaysPatterns).toEqual([]);
  });

  it("surfaces approval-required as an ask decision", () => {
    const result = resolveSystemRunPermission({
      ...makeContext(),
      analysisOk: false,
      analysisReason: "command chaining requires approval in allowlist mode",
      allowlistSatisfied: false,
      allowlistMatches: [],
      segments: [],
    });

    expect(result).toMatchObject({
      state: "ask",
      reasonCode: "approval-required",
      message: "SYSTEM_RUN_DENIED: approval required",
    });
    expect(result.trace.requiresAsk).toBe(true);
    expect(result.trace.approvedByAsk).toBe(false);
  });

  it("denies allowlist misses immediately when ask is off", () => {
    const result = resolveSystemRunPermission({
      ...makeContext(),
      ask: "off",
      analysisOk: false,
      analysisReason: "cmd.exe requires approval in allowlist mode",
      allowlistSatisfied: false,
      allowlistMatches: [],
      segments: [],
      platform: "win32",
    });

    expect(result).toMatchObject({
      state: "deny",
      reasonCode: "allowlist-miss",
      message: "SYSTEM_RUN_DENIED: cmd.exe requires approval in allowlist mode",
    });
  });

  it("collects allow-always patterns for later persistence", () => {
    const result = resolveSystemRunPermission({
      ...makeContext(),
      approvalDecision: "allow-always",
      allowlistMatches: [],
      segments: [
        makeSegment("python script.py", ["python", "script.py"], "/usr/bin/python3"),
        makeSegment("echo done", ["echo", "done"]),
      ],
    });

    expect(result.state).toBe("allow");
    expect(result.reasonCode).toBe("approved:allow-always");
    if (result.state !== "allow") {
      throw new Error("expected allow decision");
    }
    expect(result.allowAlwaysPatterns).toEqual(["/usr/bin/python3"]);
    expect(result.trace.approvedByAsk).toBe(true);
    expect(result.trace.approvalDecision).toBe("allow-always");
  });

  it("uses parsed argv on Windows allowlist raw commands to avoid shell wrappers", () => {
    const result = resolveSystemRunPermission({
      ...makeContext(),
      argv: ["cmd.exe", "/d", "/s", "/c", "python script.py"],
      rawCommand: "python script.py",
      allowlistMatches: [{ pattern: "C:/Python/python.exe" }],
      segments: [makeSegment("python script.py", ["python", "script.py"], "C:/Python/python.exe")],
      platform: "win32",
    });

    expect(result.state).toBe("allow");
    if (result.state !== "allow") {
      throw new Error("expected allow decision");
    }
    expect(result.execArgv).toEqual(["python", "script.py"]);
  });

  it("denies missing screen-recording permission after command approval checks pass", () => {
    const result = resolveSystemRunPermission({
      ...makeContext(),
      security: "full",
      needsScreenRecording: true,
    });

    expect(result).toMatchObject({
      state: "deny",
      reasonCode: "permission:screenRecording",
      message: "PERMISSION_MISSING: screenRecording",
    });
  });

  it("denies immediately when exec security is disabled", () => {
    const result = resolveSystemRunPermission({
      ...makeContext(),
      security: "deny",
    });

    expect(result).toMatchObject({
      state: "deny",
      reasonCode: "security=deny",
      message: "SYSTEM_RUN_DISABLED: security=deny",
    });
  });
});
