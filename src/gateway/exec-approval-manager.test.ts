import { describe, expect, it } from "vitest";
import { ExecApprovalManager } from "./exec-approval-manager.js";

describe("ExecApprovalManager", () => {
  it("clearAll settles pending approvals and forgets them", async () => {
    const manager = new ExecApprovalManager();
    const record = manager.create({ command: "echo hi" }, 2_000, "approval-pending-1");

    const decisionPromise = manager.waitForDecision(record, 2_000);

    expect(manager.getSnapshot(record.id)).toEqual(record);
    expect(manager.clearAll()).toBe(1);
    await expect(decisionPromise).resolves.toBeNull();
    expect(manager.getSnapshot(record.id)).toBeNull();
    expect(manager.resolve(record.id, "deny").status).toBe("unknown");
  });

  it("clearAll also clears recent terminal approvals", async () => {
    const manager = new ExecApprovalManager();
    const record = manager.create({ command: "echo ok" }, 2_000, "approval-terminal-1");

    const decisionPromise = manager.waitForDecision(record, 2_000);
    expect(manager.resolve(record.id, "allow-once").status).toBe("resolved");
    await expect(decisionPromise).resolves.toBe("allow-once");
    expect(manager.hasRecent(record.id)).toBe(true);

    expect(manager.clearAll()).toBe(0);
    expect(manager.hasRecent(record.id)).toBe(false);
  });
});
