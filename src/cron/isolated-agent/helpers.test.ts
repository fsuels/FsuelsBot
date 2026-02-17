import { describe, expect, it } from "vitest";
import { isNoopCronAnnouncementText } from "./helpers.js";

describe("isNoopCronAnnouncementText", () => {
  it("suppresses NO_REPLY and heartbeat-only texts", () => {
    expect(isNoopCronAnnouncementText("NO_REPLY")).toBe(true);
    expect(isNoopCronAnnouncementText("HEARTBEAT_OK")).toBe(true);
  });

  it("suppresses known internal no-op summaries", () => {
    expect(isNoopCronAnnouncementText("No meaningful facts.")).toBe(true);
    expect(isNoopCronAnnouncementText("Nothing to report.")).toBe(true);
    expect(isNoopCronAnnouncementText("No user-facing updates.")).toBe(true);
  });

  it("keeps user-facing summaries", () => {
    expect(isNoopCronAnnouncementText("Backup completed. 12 files changed.")).toBe(false);
  });
});
