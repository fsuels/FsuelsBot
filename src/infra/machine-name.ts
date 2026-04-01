import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { createSingleflightCache } from "./singleflight.js";

const execFileAsync = promisify(execFile);
const machineDisplayNameGate = createSingleflightCache<string, string>({
  cacheSuccessMs: Number.POSITIVE_INFINITY,
  classifyError: () => "transient",
});

async function tryScutil(key: "ComputerName" | "LocalHostName") {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/scutil", ["--get", key], {
      timeout: 1000,
      windowsHide: true,
    });
    const value = String(stdout ?? "").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function fallbackHostName() {
  return (
    os
      .hostname()
      .replace(/\.local$/i, "")
      .trim() || "openclaw"
  );
}

export async function getMachineDisplayName(): Promise<string> {
  return await machineDisplayNameGate.run("machine-display-name", async () => {
    if (process.env.VITEST || process.env.NODE_ENV === "test") {
      return fallbackHostName();
    }
    if (process.platform === "darwin") {
      const computerName = await tryScutil("ComputerName");
      if (computerName) {
        return computerName;
      }
      const localHostName = await tryScutil("LocalHostName");
      if (localHostName) {
        return localHostName;
      }
    }
    return fallbackHostName();
  });
}
