/**
 * Auto-switch LM Studio models when the user changes model via /model directive.
 *
 * LM Studio can only run one large model at a time due to RAM constraints.
 * This module fires a background unload-then-load sequence so the user doesn't
 * have to manually switch models in the LM Studio UI or CLI.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const LMS_CLI = join(homedir(), ".lmstudio", "bin", "lms");

const logger = createSubsystemLogger("lmstudio-switch");

/**
 * Fire-and-forget: unload all LM Studio models, then load the specified one.
 * Runs entirely in the background — does not block the caller.
 */
export function switchLmStudioModelIfNeeded(modelId: string): void {
  if (!modelId || !existsSync(LMS_CLI)) return;

  logger.info(`switching LM Studio model to ${modelId}`);

  // Step 1: unload all
  const unload = spawn(LMS_CLI, ["unload", "--all"], {
    stdio: "ignore",
    detached: true,
  });
  unload.unref();

  // Step 2: after unload finishes, load the new model
  unload.on("close", () => {
    const load = spawn(LMS_CLI, ["load", modelId, "-y", "--context-length", "32768"], {
      stdio: "ignore",
      detached: true,
    });
    load.unref();
    load.on("close", (code) => {
      if (code === 0) {
        logger.info(`loaded ${modelId} in LM Studio`);
      } else {
        logger.warn(`lms load ${modelId} exited with code ${code}`);
      }
    });
    load.on("error", (err) => {
      logger.warn(`lms load error: ${err.message}`);
    });
  });
  unload.on("error", (err) => {
    logger.warn(`lms unload error: ${err.message}`);
  });
}
